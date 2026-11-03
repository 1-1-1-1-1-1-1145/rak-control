/**
 * 对账/恢复后台任务（多团队 DESIGN §11.3、PLAN §M5）。
 *
 * fail-closed 骨架：恢复须能从**预登记 path** 恢复 SDK 规范 fileID，并与 GC 写同
 * attempt 互斥；不得手拼 cloud:// 或虚构 listFiles。该能力依赖 M0 已裁决的
 * recoverByPath/期限能力，当前一律返回未实现，不做任何对账或写回。
 */

export const JOB_TYPE = 'reconcile' as const

export interface ReconcileOutcome {
  ok: true
  handled: false
  reason: 'not_implemented'
  job: typeof JOB_TYPE
}

export async function run(): Promise<ReconcileOutcome> {
  return { ok: true, handled: false, reason: 'not_implemented', job: JOB_TYPE }
}
