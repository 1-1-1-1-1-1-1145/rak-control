import Taro from '@tarojs/taro'
import { BACKEND, CLOUD_ENV, ROUTES, STORAGE_PREFIX } from '@/constants'
import { ensureCloudReady } from '@/services/backend'
import { cloudBootstrap } from '@/services/cloud/auth'
import { cloudMemberUpdateMyProfile } from '@/services/cloud/member'
import { cloudJoinMine, cloudTeamEnter, cloudTeamListMine } from '@/services/cloud/team'
import type { JoinMineItem, MemberView, TeamListItemView, TeamSessionView } from '@/services/cloud/dto'
import { toast } from '@/utils/toast'
import { createMutationId } from '@/utils/mutation-id'
import { PendingIntentStore } from '@/utils/pending-intent'
import { AccountSession } from './account'
import { TeamSessionStore, type ActiveTeam, type TeamState } from './team-session'
import { SwitchCoordinator, type EnterOutcome, type EnterRequest, type SwitchResult } from './switch-coordinator'

/**
 * 云端账户↔团队流程（多团队 DESIGN §9.1/§9.2、PLAN M7）。
 *
 * 只服务 cloud 后端；**不给 demo/http 伪造多队能力**（非 cloud 直接抛错）。
 * 这里不 import `./index`，清业务 Store / reLaunch / 脏编辑判定由 `configureCloudTeam` 注入，
 * 避免与 store/index 形成循环依赖。
 */

export interface CloudTeamHandlers {
  /** 清受保护展示/业务 Store/页面局部/QR/URL/分页/弹窗/表单 */
  clearProtected: () => void
  reLaunch?: (clubId: string) => void
  isDirty?: () => boolean
}

let handlers: CloudTeamHandlers = { clearProtected: () => {} }

export function configureCloudTeam(next: CloudTeamHandlers): void {
  handlers = { ...handlers, ...next }
}

function requireCloud(): void {
  if (BACKEND !== 'cloud') throw new Error('多团队能力仅在 cloud 后端可用')
}

let cachedAppId = ''
/** 运行时真实小程序 AppID（不写死构建常量；失败返回空串，由服务端 app_mismatch 兜底）。 */
export function cloudAppId(): string {
  if (cachedAppId) return cachedAppId
  try {
    cachedAppId = Taro.getAccountInfoSync().miniProgram.appId || ''
  } catch {
    cachedAppId = ''
  }
  return cachedAppId
}

export interface CloudTeamRuntime {
  account: AccountSession
  team: TeamSessionStore
  intents: PendingIntentStore
  coordinator: SwitchCoordinator
  teams: TeamListItemView[]
  teamCursor: string | null
  teamsHasMore: boolean
  teamListError: string | null
  joins: JoinMineItem[]
  joinCursor: string | null
  joinsHasMore: boolean
  joinListError: string | null
}

function toActiveTeam(view: TeamSessionView): ActiveTeam {
  return {
    clubId: view.club.id,
    clubName: view.club.name,
    displayCode: view.club.displayCode,
    memberId: view.member.id,
    displayName: view.member.displayName,
    duty: view.member.duty,
    role: view.member.role,
    membershipRevision: view.member.revision,
    permissions: view.permissions ?? [],
  }
}

function enterTeamAdapter(request: EnterRequest): Promise<EnterOutcome> {
  return (async () => {
    await ensureCloudReady()
    const view = await cloudTeamEnter(request.clubId, request.switchAttemptId)
    return {
      clubId: view.club.id,
      attemptId: request.switchAttemptId,
      accountKey: request.accountKey,
      accountEpoch: request.accountEpoch,
      env: request.env,
      appId: request.appId,
      team: toActiveTeam(view),
    }
  })()
}

let runtime: CloudTeamRuntime | null = null

export function cloudTeamRuntime(): CloudTeamRuntime {
  requireCloud()
  if (runtime) return runtime
  const account = new AccountSession({ backend: 'cloud', env: CLOUD_ENV, appId: cloudAppId() })
  const team = new TeamSessionStore()
  const intents = new PendingIntentStore()
  const coordinator = new SwitchCoordinator({
    account,
    session: team,
    enterTeam: enterTeamAdapter,
    clearProtected: () => handlers.clearProtected(),
    isDirty: () => handlers.isDirty?.() === true,
    reLaunch: (clubId) => {
      localStorageLastClubId(account, clubId)
      if (handlers.reLaunch) handlers.reLaunch(clubId)
      else void Taro.reLaunch({ url: ROUTES.profile })
    },
    toast: (message) => toast(message),
  })
  runtime = {
    account,
    team,
    intents,
    coordinator,
    teams: [],
    teamCursor: null,
    teamsHasMore: false,
    teamListError: null,
    joins: [],
    joinCursor: null,
    joinsHasMore: false,
    joinListError: null,
  }
  return runtime
}

export interface CloudTeamSnapshot {
  accountIdentified: boolean
  teamState: TeamState
  active: ActiveTeam | null
  switchError: string | null
}

/** 供 authStore/PageShell 派生状态（不返回权限缓存，切队后必须重新 enter）。 */
export function cloudSnapshot(): CloudTeamSnapshot {
  if (BACKEND !== 'cloud') {
    return { accountIdentified: false, teamState: 'ACCOUNT_LOADING', active: null, switchError: null }
  }
  const rt = cloudTeamRuntime()
  return {
    accountIdentified: rt.account.isIdentified,
    teamState: rt.team.state,
    active: rt.team.active,
    switchError: rt.team.switchError,
  }
}

function lastClubKey(accountKey: string): string {
  // 上次选队只是**本设备建议**，不是授权；按 account 隔离，不同步为服务端 currentClub。
  return `${STORAGE_PREFIX}last_club:${accountKey}`
}

function localStorageLastClubId(account: AccountSession, clubId: string): void {
  const ctx = account.capture()
  if (!ctx.accountKey) return
  try {
    Taro.setStorageSync(lastClubKey(ctx.accountKey), clubId)
  } catch {
    /* 存储失败不影响进入 */
  }
}

export function cloudLastSelectedClubId(): string | null {
  if (BACKEND !== 'cloud') return null
  const ctx = cloudTeamRuntime().account.capture()
  if (!ctx.accountKey) return null
  try {
    return (Taro.getStorageSync(lastClubKey(ctx.accountKey)) as string) || null
  } catch {
    return null
  }
}

export function cloudForgetSelectedClubId(): void {
  if (BACKEND !== 'cloud') return
  const ctx = cloudTeamRuntime().account.capture()
  if (!ctx.accountKey) return
  try {
    Taro.removeStorageSync(lastClubKey(ctx.accountKey))
  } catch {
    /* 忽略 */
  }
}

/** 冷启动第一步：安装账户身份并绑定账户层。返回错误文案或 null。 */
export async function cloudBootAccount(): Promise<string | null> {
  requireCloud()
  await ensureCloudReady()
  const rt = cloudTeamRuntime()
  const attemptId = `attempt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  rt.account.beginBootstrapAttempt(attemptId)
  let accountKey = ''
  try {
    const account = await cloudBootstrap()
    accountKey = account.accountKey
  } catch (error) {
    return error instanceof Error ? error.message : '云端身份初始化失败'
  }
  if (!rt.account.install(accountKey, attemptId)) {
    return '身份安装失败：登录尝试已过期'
  }
  rt.team.bindAccount({
    backend: 'cloud',
    env: CLOUD_ENV,
    appId: cloudAppId(),
    accountKey,
    accountEpoch: rt.account.epoch,
  })
  return null
}

/** 读取本人关联团队（分页）；失败时记录 teamListError 供选择页展示确定性错误 UI。 */
export async function cloudLoadTeamPage(
  opts: { cursor?: string } = {}
): Promise<{ items: TeamListItemView[]; nextCursor: string | null; hasMore: boolean } | null> {
  requireCloud()
  const rt = cloudTeamRuntime()
  const before = rt.account.capture()
  if (!before.accountKey) return null
  try {
    await ensureCloudReady()
    const page = await cloudTeamListMine(opts)
    const current = rt.account.capture()
    if (!current.accountKey || current.accountKey !== before.accountKey || current.accountEpoch !== before.accountEpoch) {
      return null
    }
    rt.teams = opts.cursor ? [...rt.teams, ...page.items] : page.items
    rt.teamCursor = page.nextCursor
    rt.teamsHasMore = page.hasMore
    rt.teamListError = null
    return { items: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore }
  } catch (error) {
    const current = rt.account.capture()
    if (!current.accountKey || current.accountKey !== before.accountKey || current.accountEpoch !== before.accountEpoch) {
      return null
    }
    rt.teamListError = error instanceof Error ? error.message : '加载团队列表失败'
    return null
  }
}

export function cloudTeamListState(): {
  teams: TeamListItemView[]
  hasMore: boolean
  cursor: string | null
  error: string | null
} {
  if (BACKEND !== 'cloud') return { teams: [], hasMore: false, cursor: null, error: null }
  const rt = cloudTeamRuntime()
  return { teams: rt.teams, hasMore: rt.teamsHasMore, cursor: rt.teamCursor, error: rt.teamListError }
}

/** 读取本人入队申请（分页）；失败记录 joinListError 供页面展示确定错误。 */
export async function cloudLoadMyJoins(
  opts: { cursor?: string } = {}
): Promise<{ items: JoinMineItem[]; nextCursor: string | null; hasMore: boolean } | null> {
  requireCloud()
  const rt = cloudTeamRuntime()
  const before = rt.account.capture()
  if (!before.accountKey) return null
  try {
    await ensureCloudReady()
    const page = await cloudJoinMine(opts)
    const current = rt.account.capture()
    if (!current.accountKey || current.accountKey !== before.accountKey || current.accountEpoch !== before.accountEpoch) {
      return null
    }
    rt.joins = opts.cursor ? [...rt.joins, ...page.items] : page.items
    rt.joinCursor = page.nextCursor
    rt.joinsHasMore = page.hasMore
    rt.joinListError = null
    return { items: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore }
  } catch (error) {
    const current = rt.account.capture()
    if (!current.accountKey || current.accountKey !== before.accountKey || current.accountEpoch !== before.accountEpoch) {
      return null
    }
    rt.joinListError = error instanceof Error ? error.message : '加载入队申请失败'
    return null
  }
}

export function cloudMyJoinState(): {
  items: JoinMineItem[]
  hasMore: boolean
  cursor: string | null
  error: string | null
} {
  if (BACKEND !== 'cloud') return { items: [], hasMore: false, cursor: null, error: null }
  const rt = cloudTeamRuntime()
  return { items: rt.joins, hasMore: rt.joinsHasMore, cursor: rt.joinCursor, error: rt.joinListError }
}

/**
 * 冷启动自动进入：**仅当完整列表恰有一队**（无 hasMore）才自动 enter；
 * 有 hasMore 不能假定唯一，0 队/多队一律停在选择页（由 UI 决定）。
 */
export async function cloudColdStartAutoEnter(): Promise<SwitchResult | null> {
  requireCloud()
  const page = await cloudLoadTeamPage()
  if (!page || page.hasMore) return null
  if (page.items.length !== 1) return null
  return cloudEnter(page.items[0].clubId)
}

/** 进入/切换团队（含脏编辑确认与迟到结果栅栏）。 */
export async function cloudEnter(clubId: string, opts: { discardLocal?: boolean } = {}): Promise<SwitchResult> {
  requireCloud()
  return cloudTeamRuntime().coordinator.switchTo(clubId, opts)
}

/** 本人本队资料（姓名/职务）：成功后**就地**更新会话，不改变团队 epoch。 */
export async function cloudUpdateMyProfile(input: {
  displayName: string
  duty?: string | null
}): Promise<MemberView> {
  requireCloud()
  await ensureCloudReady()
  const rt = cloudTeamRuntime()
  const ctx = rt.team.captureReadyContext()
  const view = await cloudMemberUpdateMyProfile(ctx.clubId, {
    displayName: input.displayName,
    duty: input.duty,
    expectedRevision: ctx.membershipRevision,
    mutationId: createMutationId(),
  })
  rt.team.applyProfile(ctx, { displayName: view.displayName, duty: view.duty, revision: view.revision })
  return view
}

/** 换微信/登出/全局身份失效：清账户与团队两层。 */
export function cloudResetSessions(): void {
  if (BACKEND !== 'cloud') return
  const rt = cloudTeamRuntime()
  rt.account.invalidate()
  rt.team.reset()
  rt.intents.clear()
  rt.teams = []
  rt.teamCursor = null
  rt.teamsHasMore = false
  rt.teamListError = null
  rt.joins = []
  rt.joinCursor = null
  rt.joinsHasMore = false
  rt.joinListError = null
}
