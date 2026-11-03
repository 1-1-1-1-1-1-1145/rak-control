/**
 * 暂存清理后台任务（多团队 DESIGN §11.2/§11.3、PLAN §M5）。
 *
 * fail-closed 骨架：GC 须先事务不可逆抢占本队 attachment/attempt=GC_PENDING 再**精确**删除
 * 预登记对象，且至少晚于最晚凭证实际到期 +5 分钟；不按「当前队」前缀批量清桶。
 * 该能力依赖 M0 已裁决的删除/期限能力，当前一律返回未实现，不删除任何对象。
 */

export const JOB_TYPE = 'storage-cleanup' as const

export interface StorageCleanupOutcome {
  ok: true
  handled: false
  reason: 'not_implemented'
  job: typeof JOB_TYPE
}

export async function run(): Promise<StorageCleanupOutcome> {
  return { ok: true, handled: false, reason: 'not_implemented', job: JOB_TYPE }
}
