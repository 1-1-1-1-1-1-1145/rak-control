import type { Tx } from '../repositories/store.ts'
import { COLLECTIONS } from '../repositories/collections.ts'
import { sha256Hex } from '../repositories/ids.ts'

/**
 * 审计事件（多团队 DESIGN §7.2）。
 * 追加写；不记录原文件/临时URL/邀请码明文/完整联系方式。
 */
export interface AuditInput {
  scope: string
  actorMemberId: string | null
  action: string
  resourceType: string
  resourceId: string
  seed: string
  now: number
  reason?: string
}

export async function writeAudit(tx: Tx, input: AuditInput): Promise<void> {
  const id = sha256Hex(
    JSON.stringify([input.scope, input.actorMemberId ?? '-', input.action, input.resourceId, input.seed])
  )
  await tx.set(COLLECTIONS.audit, {
    _id: id,
    scope: input.scope,
    actorMemberId: input.actorMemberId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    reason: input.reason ?? null,
    createdAt: input.now,
  })
}
