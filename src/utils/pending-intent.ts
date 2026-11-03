/**
 * 业务深链与待消费意图（多团队 DESIGN §9.2、PLAN M7）。
 *
 * - 新业务深链必须带 `apiVersion=2` + `clubId` + `resourceKind`（可带 resourceId）。
 * - 异队深链不直接进入：先记录 pendingIntent，走同一切换流程；取消则不消费 intent。
 * - 仅 `id` 的旧链接**不查找归属**，只允许在当前 READY 队内解释。
 * - intent 绑定 accountEpoch 与目标 clubId，**一次消费**（成功后清空）。
 *
 * 计划（planDeepLink/resolveDeepLinkRoute）与解析（parse*）同模块：本文件**无相对值导入**，
 * 故可被 Node 的 type-stripping 测试直接加载（tsc 禁止 `.ts` 后缀值导入，Node 不支持无后缀解析）。
 */

export const DEEP_LINK_KINDS = [
  'task',
  'announcement',
  'roi',
  'club',
  'member',
  'invite',
  'performance',
] as const

export type DeepLinkKind = (typeof DEEP_LINK_KINDS)[number]

export interface DeepLinkTarget {
  clubId: string
  resourceKind: DeepLinkKind
  resourceId: string | null
}

export interface PendingIntent {
  accountEpoch: number
  /** 切换尝试编号；未开始切换时为 null */
  switchAttemptId: string | null
  target: DeepLinkTarget
}

function isKind(value: unknown): value is DeepLinkKind {
  return typeof value === 'string' && (DEEP_LINK_KINDS as readonly string[]).includes(value)
}

/** 解析 cloud 业务深链；缺少/不合法 apiVersion、clubId、resourceKind 一律返回 null。 */
export function parseCloudDeepLink(query: Record<string, unknown> | null | undefined): DeepLinkTarget | null {
  if (!query) return null
  if (String(query.apiVersion ?? '') !== '2') return null
  const clubId = typeof query.clubId === 'string' ? query.clubId : ''
  if (!clubId) return null
  if (!isKind(query.resourceKind)) return null
  const rawId = query.resourceId
  const resourceId = typeof rawId === 'string' && rawId.length > 0 ? rawId : null
  return { clubId, resourceKind: query.resourceKind, resourceId }
}

/** 旧链接：仅 `id`，不查找归属，只在当前 READY 队内解释。 */
export function parseLegacyDeepLink(query: Record<string, unknown> | null | undefined): { resourceId: string } | null {
  if (!query) return null
  if (query.apiVersion !== undefined || query.clubId !== undefined) return null
  const id = query.id
  return typeof id === 'string' && id.length > 0 ? { resourceId: id } : null
}

export class PendingIntentStore {
  private intent: PendingIntent | null = null

  set(intent: PendingIntent): void {
    this.intent = { accountEpoch: intent.accountEpoch, switchAttemptId: intent.switchAttemptId, target: { ...intent.target } }
  }

  /** 绑定本次切换尝试编号（不改变目标与账户代次）。 */
  bindSwitchAttempt(switchAttemptId: string): void {
    if (!this.intent) return
    this.intent.switchAttemptId = switchAttemptId
  }

  peek(): PendingIntent | null {
    if (!this.intent) return null
    return { ...this.intent, target: { ...this.intent.target } }
  }

  matches(accountEpoch: number, clubId: string): boolean {
    return (
      this.intent !== null &&
      this.intent.accountEpoch === accountEpoch &&
      this.intent.target.clubId === clubId
    )
  }

  /** 一次消费：账户代次与目标队都匹配才返回并清空，否则保持原样（不误消费）。 */
  consume(accountEpoch: number, clubId: string): DeepLinkTarget | null {
    if (!this.matches(accountEpoch, clubId)) return null
    const target = { ...(this.intent as PendingIntent).target }
    this.intent = null
    return target
  }

  clear(): void {
    this.intent = null
  }
}

/** 目标页路径（字面量与 `src/constants` 的 `ROUTES` 一致；该模块含构建期全局量，不可在此引入）。 */
const ROUTE_PATHS: Record<DeepLinkKind, { withId: string | null; list: string }> = {
  task: { withId: '/pages/task/detail', list: '/pages/task/pool' },
  announcement: { withId: '/pages/club/announcement-detail', list: '/pages/club/announcement-list' },
  roi: { withId: '/pages/roi/detail', list: '/pages/roi/overview' },
  club: { withId: null, list: '/pages/club/home' },
  member: { withId: null, list: '/pages/club/members' },
  invite: { withId: null, list: '/subpackage-admin/pages/admin/invites' },
  performance: { withId: null, list: '/pages/me/performance' },
}

/** 目标页 URL：保留 `apiVersion=2` 深链参数，便于目标页在同队内二次校验。 */
export function resolveDeepLinkRoute(target: DeepLinkTarget): string | null {
  const entry = ROUTE_PATHS[target.resourceKind]
  if (!entry) return null
  const query = [
    'apiVersion=2',
    `clubId=${encodeURIComponent(target.clubId)}`,
    `resourceKind=${target.resourceKind}`,
  ]
  if (target.resourceId) query.push(`resourceId=${encodeURIComponent(target.resourceId)}`)
  if (target.resourceId && entry.withId) {
    return `${entry.withId}?id=${encodeURIComponent(target.resourceId)}&${query.join('&')}`
  }
  return `${entry.list}?${query.join('&')}`
}

export interface DeepLinkPlanInput {
  query?: Record<string, unknown> | null
  /** 当前账户代次（intent 与一次消费都绑定它） */
  accountEpoch: number
  /** 当前 READY 队的 clubId；无可用队为 null */
  activeClubId: string | null
  /** 当前团队状态（ENTERING/SWITCHING 期间不处理） */
  teamState: string
}

export type DeepLinkPlan =
  | { action: 'consumed'; route: string }
  | { action: 'switch'; clubId: string; intent: PendingIntent }
  | { action: 'ignored'; reason: string }

/**
 * 深链计划：
 * - `apiVersion=2` + 同队 → 直接进入目标路由（consumed）。
 * - `apiVersion=2` + 异队 → 记录 pendingIntent 并走同一切换（switch）。
 * - 仅 `id` 的旧链接 → **不做归属查找、不重定向**：由目标页在**当前 READY 队**scope 内解释
 *   （服务端异队一律 resource_not_found）。
 * - 其他（缺 apiVersion/clubId/resourceKind）一律 ignored。
 */
export function planDeepLink(input: DeepLinkPlanInput): DeepLinkPlan {
  const target = parseCloudDeepLink(input.query)
  if (!target) {
    if (parseLegacyDeepLink(input.query)) {
      return { action: 'ignored', reason: '旧链接仅由目标页在当前 READY 队内解释' }
    }
    return { action: 'ignored', reason: '不是 cloud 业务深链' }
  }

  if (target.clubId === input.activeClubId) {
    const route = resolveDeepLinkRoute(target)
    return route ? { action: 'consumed', route } : { action: 'ignored', reason: '未知 resourceKind' }
  }

  return {
    action: 'switch',
    clubId: target.clubId,
    intent: { accountEpoch: input.accountEpoch, switchAttemptId: null, target },
  }
}
