/**
 * 文件校验后台任务（多团队 DESIGN §11.2、PLAN §M5）。
 *
 * fail-closed 骨架：worker 只信平台系统调用身份，须从持久化 job 读取 clubId 并校验
 * session/attempt 全链，且依赖 M0 已裁决的真实读取/hash 能力。当前一律返回未实现，
 * 不产生任何校验/发布副作用（与 entrypoints/rak-maintenance.ts 的骨架语义一致）。
 */

export const JOB_TYPE = 'file-verification' as const

export interface FileVerificationOutcome {
  ok: true
  handled: false
  reason: 'not_implemented'
  job: typeof JOB_TYPE
}

export async function run(): Promise<FileVerificationOutcome> {
  return { ok: true, handled: false, reason: 'not_implemented', job: JOB_TYPE }
}
