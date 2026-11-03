import { AppError } from '../contracts/errors.ts'
import type { Database, Tx } from '../repositories/store.ts'
import { COLLECTIONS } from '../repositories/collections.ts'
import { commandId, memberId } from '../repositories/ids.ts'
import type { RequestScope } from '../contracts/request-v2.ts'
import {
  IDEMPOTENCY_RETAIN_MS,
  RESULT_WINDOW_MS,
  assertMutationFresh,
  inputHash as computeInputHash,
  scopeCanonical,
} from '../shared/command.ts'

/**
 * 命令幂等（多团队 DESIGN §10.2、M3/M4）。
 *
 * 成功写与命令结果在**同一事务**提交；同键不同 inputHash → idempotency_conflict；
 * 重放只返回既有的已授权最小结果，不重复业务写。
 */

export interface CommandInput {
  scope: RequestScope
  actorIdentityId: string
  action: string
  mutationId: string
  expectedRevision?: number
  data: unknown
}

interface CommandActorState {
  actorRole: string | null
  actorIsPrimaryOwner: boolean
}

/**
 * Re-read the account and current team membership before returning a cached
 * result. A command key is scoped to an identity, but authorization can change
 * between the original write and a retry.
 */
async function readActorState(tx: Tx, input: CommandInput): Promise<CommandActorState> {
  const identity = await tx.get(COLLECTIONS.identities, input.actorIdentityId)
  if (!identity || typeof identity.userId !== 'string') throw new AppError('identity_required')
  const user = await tx.get(COLLECTIONS.users, identity.userId)
  if (!user) throw new AppError('identity_required')
  if (user.securityState === 'BLOCKED') throw new AppError('account_blocked')

  if (input.scope.kind === 'GLOBAL') {
    return { actorRole: null, actorIsPrimaryOwner: false }
  }

  const clubId = input.scope.clubId
  const club = await tx.get(COLLECTIONS.clubs, clubId)
  if (!club || club.status === 'DISSOLVED') throw new AppError('resource_not_found')
  if (club.status === 'MAINTENANCE') throw new AppError('team_maintenance')

  const member = await tx.get(COLLECTIONS.members, memberId(clubId, identity.userId))
  if (!member) throw new AppError('membership_required')
  if (member.status === 'DISABLED') throw new AppError('membership_disabled')
  if (member.status === 'LEFT') throw new AppError('membership_left')
  if (member.status !== 'ACTIVE') throw new AppError('membership_required')

  return {
    actorRole: typeof member.role === 'string' ? member.role : null,
    actorIsPrimaryOwner: club.ownerMemberId === member._id,
  }
}

function assertSameActorState(existing: Record<string, unknown>, current: CommandActorState): void {
  if (
    existing.actorRole !== current.actorRole ||
    existing.actorIsPrimaryOwner !== current.actorIsPrimaryOwner
  ) {
    throw new AppError('permission_denied', '命令结果不可在当前授权状态下读取')
  }
}

async function readExisting<T>(
  tx: Tx,
  id: string,
  inputHashValue: string,
  input: CommandInput
): Promise<{ result: T; replayed: true } | null> {
  const existing = await tx.get(COLLECTIONS.commands, id)
  if (!existing) return null
  if (existing.inputHash !== inputHashValue) throw new AppError('idempotency_conflict')
  assertSameActorState(existing, await readActorState(tx, input))
  if (existing.status !== 'SUCCEEDED') throw new AppError('result_unknown')
  return { result: JSON.parse(existing.resultSummary as string) as T, replayed: true }
}

/** Read an existing idempotent result without creating a command record. */
export async function getIdempotentReplay<T>(
  db: Database,
  now: number,
  input: CommandInput
): Promise<T | null> {
  const scope = scopeCanonical(input.scope)
  const id = commandId(scope, input.actorIdentityId, input.action, input.mutationId)
  assertMutationFresh(input.mutationId, now)
  const inputHash = computeInputHash({
    apiVersion: 2,
    action: input.action,
    scope: input.scope,
    data: input.data,
    expectedRevision: input.expectedRevision,
  })
  return db.tx(async (tx) => {
    const existing = await readExisting<T>(tx, id, inputHash, input)
    return existing?.result ?? null
  })
}

export async function runIdempotent<T>(
  db: Database,
  now: number,
  input: CommandInput,
  body: (tx: Tx) => Promise<T>
): Promise<{ result: T; replayed: boolean }> {
  const scope = scopeCanonical(input.scope)
  const id = commandId(scope, input.actorIdentityId, input.action, input.mutationId)
  // UUIDv7 年龄门禁：未来偏差 ≤5 分钟，年龄 ≤24 小时（首次与重放同规则）。
  assertMutationFresh(input.mutationId, now)
  const inputHash = computeInputHash({
    apiVersion: 2,
    action: input.action,
    scope: input.scope,
    data: input.data,
    expectedRevision: input.expectedRevision,
  })

  return db.tx(async (tx) => {
    const existing = await readExisting<T>(tx, id, inputHash, input)
    if (existing) return existing

    const actorState = await readActorState(tx, input)
    const result = await body(tx)
    await tx.set(COLLECTIONS.commands, {
      _id: id,
      scope,
      actorIdentityId: input.actorIdentityId,
      ...actorState,
      action: input.action,
      inputHash,
      status: 'SUCCEEDED',
      resultSummary: JSON.stringify(result),
      createdAt: now,
      completedAt: now,
      resultUntil: now + RESULT_WINDOW_MS,
      retainUntil: now + IDEMPOTENCY_RETAIN_MS,
    })
    return { result, replayed: false }
  })
}
