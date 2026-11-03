import type { ClubRole, TeamState } from '../store/team-session.ts'

/**
 * 路由守卫判定（多团队 DESIGN §9.2/§9.3、PLAN M7）。
 *
 * 纯函数：由"账户是否识别 / 团队状态 / 页面要求"推导唯一动作，避免各页面各写一套。
 * - 先完成 bootstrap/enter 再 load：未完成一律 WAIT（不展示缓存权限）。
 * - 需要本队业务但无 activeTeam → 去选队页。
 * - 选队页自身不被 requiresTeam 守卫循环拦截。
 * - 登录/入会这类账户页自行处理未识别态，不被强制重定向（否则新加入页会被旧 login 覆盖）。
 */

export type GuardRedirect = 'login' | 'select' | 'me'

export type GuardDecision =
  | { kind: 'LOAD' }
  | { kind: 'WAIT' }
  | { kind: 'REDIRECT'; to: GuardRedirect; reason: string }

export interface GuardInput {
  state: TeamState
  isAccountIdentified: boolean
  hasActiveTeam: boolean
  /** 页面是否需要本队业务数据 */
  requiresTeam: boolean
  requiresRole?: 'manage' | 'super' | null
  role?: ClubRole | null
  /** 选队页：不被 requiresTeam/ACTIVE 守卫循环拦截 */
  isTeamSelectionPage?: boolean
  /** 账户页（登录/入会/入队结果）：自行处理未识别态与"已在别的队"情形 */
  isAccountPage?: boolean
}

function roleAllows(required: 'manage' | 'super', role?: ClubRole | null): boolean {
  if (required === 'super') return role === 'super_admin'
  return role === 'manager' || role === 'super_admin'
}

export function decideGuard(input: GuardInput): GuardDecision {
  if (input.isAccountPage) {
    // 账户页（登录/入会/入队结果）自行处理未识别态与"已在别的队"，不被强制重定向
    return { kind: 'LOAD' }
  }

  if (input.isTeamSelectionPage) {
    if (!input.isAccountIdentified) return { kind: 'REDIRECT', to: 'login', reason: '账户尚未识别' }
    if (input.state === 'ACCOUNT_LOADING') return { kind: 'WAIT' }
    // 已有可用团队时**不**弹回「我的」：用户是主动来切换/加入团队的；
    // 若在此重定向，会与入口页的 navigateTo 竞争（实测 navigateTo:fail timeout）。
    return { kind: 'LOAD' }
  }

  if (!input.isAccountIdentified) {
    return { kind: 'REDIRECT', to: 'login', reason: '账户尚未识别' }
  }
  if (input.state === 'ACCOUNT_LOADING' || input.state === 'ENTERING' || input.state === 'SWITCHING') {
    return { kind: 'WAIT' }
  }
  if (input.requiresTeam && !input.hasActiveTeam) {
    return { kind: 'REDIRECT', to: 'select', reason: '需要选择团队' }
  }
  if (input.requiresRole && !roleAllows(input.requiresRole, input.role)) {
    return { kind: 'REDIRECT', to: 'me', reason: '权限不足' }
  }
  return { kind: 'LOAD' }
}

/**
 * 登录页在账户 bootstrap 之后的落点（cloud 专用）。
 *
 * 背景：cloud 模式下登录页**只渲染 loading**（legacy 表单被 `isCloud` 排除），
 * 一旦"账户已识别但没有 activeTeam"（含 **0 队**）就没有任何可点入口 → 永久卡住。
 * 因此这种情形必须离开登录页，由**选队页**接管 0 队空态与"加入其他团队"入口。
 *
 * - 非 cloud / 账户未识别 / 正在进入或切换 / 已进入本队：留在登录页
 *   （已进入本队的情形由既有 `AUTHED → reLaunch 首页` 处理）。
 * - 已识别且未进入任何本队 → 去选队页。
 */
export function decideLoginLanding(input: {
  isCloud: boolean
  accountIdentified: boolean
  hasActiveTeam: boolean
  state: TeamState
}): 'STAY' | 'TEAM_SELECT' {
  if (!input.isCloud) return 'STAY'
  if (!input.accountIdentified) return 'STAY'
  if (input.hasActiveTeam) return 'STAY'
  if (input.state === 'ENTERING' || input.state === 'SWITCHING') return 'STAY'
  return 'TEAM_SELECT'
}
