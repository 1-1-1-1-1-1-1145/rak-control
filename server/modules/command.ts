import { AppError } from '../contracts/errors.ts'
import type { Database, Tx } from '../repositories/store.ts'
import { COLLECTIONS } from '../repositories/collections.ts'
import { commandId } from '../repositories/ids.ts'
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
    const existing = await tx.get(COLLECTIONS.commands, id)
    if (existing) {
      if (existing.inputHash !== inputHash) throw new AppError('idempotency_conflict')
      if (existing.status !== 'SUCCEEDED') throw new AppError('result_unknown')
      return { result: JSON.parse(existing.resultSummary as string) as T, replayed: true }
    }
    const result = await body(tx)
    await tx.set(COLLECTIONS.commands, {
      _id: id,
      scope,
      actorIdentityId: input.actorIdentityId,
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
