/**
 * 启动/恢复策略（多团队 DESIGN §9.1、PLAN M7）。
 *
 * 背景（体验版实测缺陷，2026-10-18）：
 * 1. `App.useLaunch` **只在进程冷启动**触发；退出登录 / 后台驻留后重进 / reLaunch 都不触发，
 *    导致 `status=LOADING` 且账户失效时**无人发起 bootstrap**，永久停在 loading。
 * 2. 团队列表状态（teams/error/cursor/hasMore）原本是非可观察的模块级变量，
 *    UI 更新依赖别的 observable 恰好变化；一旦时序错过就永久显示空态。
 * 3. 选队页只在 `useDidShow` 拉一次列表，且账户未识别时直接 return；若那一次早于
 *    bootstrap 完成，**永不重试**。
 *
 * 本模块只放**纯判定**，便于单测；副作用（bootstrap/请求）在调用方执行。
 */

export type StartupAuthStatus = 'LOADING' | 'AUTHED' | 'UNBOUND' | 'JOIN_PENDING' | 'ERROR'

export type StartupTeamState =
  | 'ACCOUNT_LOADING'
  | 'TEAM_SELECTION'
  | 'ENTERING'
  | 'READY'
  | 'SWITCHING'

export interface BootstrapPolicyInput {
  isCloud: boolean
  status: StartupAuthStatus
  accountIdentified: boolean
  teamState: StartupTeamState
}

/**
 * 是否需要执行一次引导（bootstrap）。
 *
 * - 失败态（ERROR）**不自动重试**：避免热启动/切前后台时无限重试，由 UI 的"重试"按钮触发。
 * - cloud 已识别且已离开 ACCOUNT_LOADING（TEAM_SELECTION/ENTERING/READY/SWITCHING）→ 已就绪，
 *   **不得重跑**（重跑会重置团队状态、打断用户正在进行的选队/切队）。
 * - legacy：仅在 LOADING（尚未完成静默登录）时引导。
 */
export function shouldBootstrap(input: BootstrapPolicyInput): boolean {
  if (input.status === 'ERROR') return false
  if (!input.isCloud) return input.status === 'LOADING'
  if (input.accountIdentified && input.teamState !== 'ACCOUNT_LOADING') return false
  return true
}

export interface TeamListLoadPolicyInput {
  isCloud: boolean
  accountIdentified: boolean
  /** 已有请求在途（单飞，避免 useDidShow 与识别回调重复请求） */
  inFlight: boolean
}

/**
 * 是否允许拉取团队列表。
 *
 * 账户未识别时**不得发请求**（服务端会返回 identity_required，且会把"未识别"误导为"加载失败"）。
 * 识别完成后必须由调用方补一次拉取，不能依赖一次性的 onShow。
 */
export function shouldLoadTeamList(input: TeamListLoadPolicyInput): boolean {
  return input.isCloud && input.accountIdentified && !input.inFlight
}
