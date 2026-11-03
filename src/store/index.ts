import Taro from '@tarojs/taro'
import { makeAutoObservable, runInAction } from 'mobx'
import { BACKEND, ROUTES, STORAGE_KEYS } from '@/constants'
import * as authService from '@/services/auth'
import * as taskService from '@/services/task'
import * as memberService from '@/services/member'
import * as clubService from '@/services/club'
import * as roiService from '@/services/roi'
import { setClubId } from '@/services/context'
import { ApiError, setToken } from '@/utils/request'
import { TaskListRequestGate, type TaskListRequest } from '@/utils/task-list-request-gate'
import { toast } from '@/utils/toast'
import {
  cloudBootAccount,
  cloudColdStartAutoEnter,
  cloudEnter,
  cloudForgetSelectedClubId,
  cloudLastSelectedClubId,
  cloudLoadMyJoins,
  cloudLoadTeamPage,
  cloudResetSessions,
  cloudSnapshot,
  cloudTeamListState,
  cloudUpdateMyProfile,
  configureCloudTeam,
} from './cloud-team'
import type { ActiveTeam, TeamState } from './team-session'
import type { JoinMineItem, TeamListItemView } from '@/services/cloud/dto'
import {
  cloudRoiCreate,
  cloudRoiDelete,
  cloudRoiGet,
  cloudRoiList,
  cloudRoiOverview,
  cloudRoiUpdate,
} from '@/services/cloud/roi'
import {
  cloudAnnouncementArchive,
  cloudAnnouncementCreate,
  cloudAnnouncementList,
  cloudAnnouncementPublish,
  cloudAnnouncementUpdate,
  cloudClubGet,
  cloudClubUpdate,
} from '@/services/cloud/club'
import { cloudMemberList, cloudMemberSetRole, cloudMemberSetStatus } from '@/services/cloud/member'
import {
  cloudCommandStatus,
  cloudSubmissionList,
  cloudTaskApprove,
  cloudTaskArchive,
  cloudTaskClaim,
  cloudTaskCreate,
  cloudTaskGet,
  cloudTaskList,
  cloudTaskReject,
  cloudTaskSubmit,
} from '@/services/cloud/task'
import { commandTracker, scopeKeyOf } from './command-tracker'
import {
  clearPendingCommands,
  persistPendingCommands,
  restorePendingCommands,
} from './command-tracker-persist'
import { resetDeepLinkEntry } from '@/utils/deep-link-entry'
import type { RequestScope } from '@/services/cloud/client'
import { cloudPerformanceList } from '@/services/cloud/performance'
import { cloudInviteCreate, cloudInviteList, cloudInviteRevoke } from '@/services/cloud/team'
import { cloudJoinApprove, cloudJoinList, cloudJoinReject } from '@/services/cloud/join'
import {
  toCloudRoiWrite,
  toLegacyAnnouncement,
  toLegacyInvite,
  toLegacyJoinRequest,
  toLegacyMember,
  toLegacyPerformance,
  toLegacyRoiItem,
  toLegacyRoiOverview,
  toLegacyTask,
} from '@/services/cloud/legacy-view'
import { createMutationId } from '@/utils/mutation-id'
import type {
  Announcement,
  ClubBrief,
  ClubInfo,
  ClubMember,
  ClubRole,
  InviteCode,
  JoinRequest,
  JoinStatusView,
  LoginOutcome,
  MemberPerformance,
  Paged,
  QualityGrade,
  RoiInput,
  RoiItem,
  RoiOverview,
  RoiPeriod,
  Task,
  TaskSubmissionAttachment,
  TaskQuery,
  ThemeMode,
  UserInfo,
} from '@/types/domain'
import { AuthContractError } from '../utils/auth-contract.js'

/** 统一错误提示（契约 code → 文案） */
function fail(e: unknown, fallbackMsg: string) {
  if (e instanceof ApiError) toast(e.userMessage)
  else toast((e as Error)?.message || fallbackMsg)
}

export type AuthStatus =
  | 'LOADING'
  | 'AUTHED'
  | 'UNBOUND'
  | 'JOIN_PENDING'
  | 'ERROR'

function loadTheme(): ThemeMode {
  return (Taro.getStorageSync(STORAGE_KEYS.theme) as ThemeMode) || 'light'
}

class AuthStore {
  status: AuthStatus = 'LOADING'
  /** legacy（demo/http）身份字段；cloud 模式不使用 */
  private legacyUser: UserInfo | null = null
  private legacyClub: ClubBrief | null = null
  private legacyClubRole: ClubRole | null = null
  private legacyPermissions: string[] = []
  joinStatus: JoinStatusView | null = null
  bootError: string | null = null

  /** cloud 模式镜像字段（MobX 可观察；由 syncFromCloudSession 一次安装） */
  cloudAccountIdentified = false
  cloudTeamState: TeamState = 'ACCOUNT_LOADING'
  cloudActiveTeam: ActiveTeam | null = null
  cloudSwitchError: string | null = null
  /**
   * 本人团队列表（**必须**是可观察字段）。
   *
   * 缺陷修复（2026-10-18 体验版）：此前 getter 直读 `cloud-team` 的模块级普通变量，
   * 列表更新不会触发 MobX 重渲染；只要列表在首屏渲染之后才到达（冷启动/常规入口常见），
   * 选队页就会永久停在空态。现由 `syncFromCloudSession()` 一次性安装为可观察值。
   */
  cloudTeams: TeamListItemView[] = []
  cloudTeamsHasMore = false
  cloudTeamsCursor: string | null = null
  cloudTeamsError: string | null = null
  /** 本人入队申请（账户级；用于"仅待审"落点与进度） */
  myJoins: JoinMineItem[] = []
  myJoinsHasMore = false
  myJoinsCursor: string | null = null
  myJoinsError: string | null = null
  myJoinsLoading = false

  constructor() {
    makeAutoObservable<AuthStore, 'legacyUser' | 'legacyClub' | 'legacyClubRole' | 'legacyPermissions'>(this, {
      legacyUser: false,
      legacyClub: false,
      legacyClubRole: false,
      legacyPermissions: false,
    })
  }

  get isCloud(): boolean {
    return BACKEND === 'cloud'
  }

  /** cloud：本队资料来自 activeTeam；legacy：来自全局 user（不使用跨队回退） */
  get user(): UserInfo | null {
    if (this.isCloud) {
      const team = this.cloudActiveTeam
      if (!team) return null
      return { id: team.memberId, displayName: team.displayName, email: null, status: 'ACTIVE', duty: team.duty }
    }
    return this.legacyUser
  }

  get club(): ClubBrief | null {
    if (this.isCloud) {
      const team = this.cloudActiveTeam
      if (!team) return null
      return { id: team.clubId, slug: '', name: team.clubName, clubRole: team.role }
    }
    return this.legacyClub
  }

  get clubRole(): ClubRole | null {
    return this.isCloud ? (this.cloudActiveTeam?.role ?? null) : this.legacyClubRole
  }

  get permissions(): string[] {
    return this.isCloud ? (this.cloudActiveTeam?.permissions ?? []) : this.legacyPermissions
  }

  get isLoggedIn() {
    if (this.isCloud) return this.status === 'AUTHED' && !!this.cloudActiveTeam
    return this.status === 'AUTHED' && !!this.legacyUser
  }

  get isManager() {
    return this.clubRole === 'manager' || this.clubRole === 'super_admin'
  }

  get isSuper() {
    return this.clubRole === 'super_admin'
  }

  /** 我的团队列表（cloud；读**可观察**镜像，列表晚到也会触发重渲染） */
  get myTeams() {
    return this.isCloud ? this.cloudTeams : []
  }

  get myTeamsHasMore() {
    return this.isCloud ? this.cloudTeamsHasMore : false
  }

  get myTeamsError() {
    return this.isCloud ? this.cloudTeamsError : null
  }

  get myTeamsCursor(): string | null {
    return this.isCloud ? this.cloudTeamsCursor : null
  }

  get lastSelectedClubId(): string | null {
    return cloudLastSelectedClubId()
  }

  /** 把云端两层状态一次安装进可观察字段（切队成功/失败后调用）。 */
  syncFromCloudSession() {
    if (!this.isCloud) return
    const snap = cloudSnapshot()
    const list = cloudTeamListState()
    runInAction(() => {
      this.cloudAccountIdentified = snap.accountIdentified
      this.cloudTeamState = snap.teamState
      this.cloudActiveTeam = snap.active
      this.cloudSwitchError = snap.switchError
      this.cloudTeams = list.teams.slice()
      this.cloudTeamsHasMore = list.hasMore
      this.cloudTeamsCursor = list.cursor
      this.cloudTeamsError = list.error
      if (!snap.accountIdentified) this.status = 'LOADING'
      else if (snap.teamState === 'READY' && snap.active) this.status = 'AUTHED'
      else this.status = 'LOADING'
    })
    // 会话变化后对账未决命令（按原 scope + 原键查询，不重放）
    void reconcilePendingCommands()
  }

  /** 冷启动：cloud 走账户→团队链；legacy 走静默登录（设计 §3） */
  async bootstrap() {
    if (this.isCloud) return this.bootstrapCloud()
    runInAction(() => {
      this.status = 'LOADING'
      this.bootError = null
    })
    try {
      const out = await authService.wxLogin()
      if (out.bound) {
        await this.refreshMe()
        return
      }
      // 未绑定：看是否有待审批申请（403/失败按 UNBOUND 处理）
      try {
        const js = await authService.fetchJoinStatus()
        runInAction(() => {
          this.joinStatus = js
          this.status = js.status === 'PENDING' || js.status === 'APPROVED'
            ? 'JOIN_PENDING'
            : 'UNBOUND'
        })
      } catch {
        runInAction(() => {
          this.status = 'UNBOUND'
        })
      }
    } catch (e) {
      runInAction(() => {
        this.bootError =
          e instanceof ApiError ? e.userMessage : '无法连接服务器，请检查网络'
        this.status = 'ERROR'
      })
    }
  }

  /** cloud 冷启动/恢复：先账户，再 team.listMine；仅"完整列表恰一队"才自动 enter。 */
  private async bootstrapCloud() {
    runInAction(() => {
      this.status = 'LOADING'
      this.bootError = null
    })
    try {
      const error = await cloudBootAccount()
      this.syncFromCloudSession()
      if (error) {
        runInAction(() => {
          this.bootError = error
          this.status = 'ERROR'
        })
        return
      }
      // 冷启动载入最小命令指针：重启无原 payload，只保留可按原键查询的 UNKNOWN
      restorePendingCommands()
      try {
        await cloudColdStartAutoEnter()
      } catch {
        /* 自动进入失败即停在 TEAM_SELECTION；文案在 cloudSwitchError */
      }
      this.syncFromCloudSession()
    } catch (e) {
      // 云初始化/网络异常（`cloudBootAccount` 内的 ensureCloudReady 会直接抛）：进入可重试错误态，
      // **不**进入样例身份，也不让异常冒泡成未处理的 Promise 拒绝。
      this.setBootFailure(e instanceof Error ? e.message : '云端初始化失败，请检查网络后重试')
    }
  }

  /** 选队页：拉取本人关联团队（分页）。 */
  async loadMyTeams(opts: { cursor?: string } = {}) {
    if (!this.isCloud) return null
    const page = await cloudLoadTeamPage(opts)
    this.syncFromCloudSession()
    return page
  }

  /** 进入/切换团队；结果供 UI 区分 NEEDS_CONFIRM 与失败。 */
  async switchTeam(clubId: string, opts: { discardLocal?: boolean } = {}) {
    if (!this.isCloud) throw new Error('多团队能力仅在 cloud 后端可用')
    const result = await cloudEnter(clubId, opts)
    this.syncFromCloudSession()
    return result
  }

  /** 本人入队申请（账户级分页）：用于"仅待审"落点与入队进度。 */
  async loadMyJoins(opts: { cursor?: string } = {}) {
    if (!this.isCloud) return null
    runInAction(() => {
      this.myJoinsLoading = true
    })
    try {
      const page = await cloudLoadMyJoins(opts)
      if (!page) {
        runInAction(() => {
          this.myJoinsError = '加载入队申请失败'
        })
        return null
      }
      runInAction(() => {
        this.myJoins = opts.cursor ? [...this.myJoins, ...page.items] : page.items
        this.myJoinsCursor = page.nextCursor
        this.myJoinsHasMore = page.hasMore
        this.myJoinsError = null
      })
      return page
    } finally {
      runInAction(() => {
        this.myJoinsLoading = false
      })
    }
  }

  /** 本队资料：改本人姓名/职务（cloud）；成功后就地更新会话。 */
  async updateMyProfile(input: { displayName: string; duty?: string | null }) {
    if (!this.isCloud) throw new Error('多团队能力仅在 cloud 后端可用')
    const view = await cloudUpdateMyProfile(input)
    this.syncFromCloudSession()
    return view
  }

  /** 登录/绑定成功后统一落状态（仅 legacy 后端；cloud 由 syncFromCloudSession 安装） */
  applyLoginOutcome(out: LoginOutcome) {
    if (this.isCloud) return
    if (out.bound && out.user && out.club) {
      runInAction(() => {
        this.legacyUser = out.user || null
        this.legacyClub = out.club || null
        this.legacyClubRole = out.club?.clubRole || null
        this.status = 'AUTHED'
      })
      setClubId(out.club?.id || null)
      void this.refreshMe()
    }
  }

  async refreshMe() {
    if (this.isCloud) {
      this.syncFromCloudSession()
      return
    }
    try {
      const me = await authService.fetchMe()
      runInAction(() => {
        this.legacyUser = me.user
        this.legacyClub = me.club
        this.legacyClubRole = me.club.clubRole
        this.legacyPermissions = me.permissions
        this.status = 'AUTHED'
      })
      setClubId(me.club.id)
    } catch (e) {
      if (e instanceof AuthContractError) {
        runInAction(() => {
          this.clear()
          this.bootError = '服务端身份信息无效，请重新登录或联系管理员'
          this.status = 'ERROR'
        })
        return
      }
      if (e instanceof ApiError && e.status === 401) {
        runInAction(() => {
          this.clear()
        })
        return
      }
      runInAction(() => {
        this.bootError = e instanceof ApiError ? e.userMessage : '加载身份失败'
      })
    }
  }

  setJoinStatus(view: JoinStatusView) {
    this.joinStatus = view
    this.status = view.status === 'PENDING' ? 'JOIN_PENDING' : this.status
  }

  /** 云初始化/冷启动失败：进入可重试错误态，不进入样例身份。 */
  setBootFailure(message: string) {
    runInAction(() => {
      this.bootError = message
      this.status = 'ERROR'
    })
  }

  clear() {
    if (this.isCloud) {
      // 账户失效/换微信：清账户与团队两层 + 业务 Store；旧账号的未决命令指针不得带入新账号
      cloudForgetSelectedClubId()
      cloudResetSessions()
      resetBusinessStores()
      clearPendingCommands()
      resetDeepLinkEntry()
      runInAction(() => {
        this.cloudAccountIdentified = false
        this.cloudActiveTeam = null
        this.cloudTeamState = 'ACCOUNT_LOADING'
        this.cloudSwitchError = null
        // 团队列表必须与账户层一起清空：否则退出登录后重进会残留上一个账户的选项
        this.cloudTeams = []
        this.cloudTeamsHasMore = false
        this.cloudTeamsCursor = null
        this.cloudTeamsError = null
        this.myJoins = []
        this.myJoinsHasMore = false
        this.myJoinsCursor = null
        this.myJoinsError = null
        this.myJoinsLoading = false
        this.status = 'LOADING'
      })
      return
    }
    this.legacyUser = null
    this.legacyClub = null
    this.legacyClubRole = null
    this.legacyPermissions = []
    this.status = 'UNBOUND'
    setClubId(null)
    setToken('')
  }

  async logout() {
    if (this.isCloud) {
      runInAction(() => this.clear())
      await Taro.reLaunch({ url: ROUTES.login })
      return
    }
    await authService.logout()
    runInAction(() => this.clear())
    await Taro.reLaunch({ url: ROUTES.login })
  }
}

const TAB_BAR_ICONS = ['home', 'task', 'roi', 'club', 'me'] as const

class UiStore {
  theme: ThemeMode = 'light'

  constructor() {
    makeAutoObservable(this)
    this.theme = loadTheme()
  }

  setTheme(mode: ThemeMode) {
    this.theme = mode
    Taro.setStorageSync(STORAGE_KEYS.theme, mode)
    this.syncTabBarStyle()
  }

  toggleTheme() {
    this.setTheme(this.theme === 'light' ? 'dark' : 'light')
  }

  /** 原生 TabBar 不吃 CSS 变量，主题切换时同步配色（设计 §4） */
  syncTabBarStyle() {
    const dark = this.theme === 'dark'
    Taro.setTabBarStyle({
      color: dark ? '#A3A3AD' : '#6B6B76',
      selectedColor: dark ? '#22D3EE' : '#4752A8',
      backgroundColor: dark ? '#101014' : '#FFFFFF',
      borderStyle: dark ? 'black' : 'white',
    }).catch(() => {
      /* 非 tab 页调用会失败，忽略 */
    })
    TAB_BAR_ICONS.forEach((name, index) => {
      const suffix = dark ? '-dark' : ''
      Taro.setTabBarItem({
        index,
        iconPath: `/assets/tabbar/${name}${suffix}.png`,
        selectedIconPath: `/assets/tabbar/${name}${suffix}-active.png`,
      }).catch(() => {
        /* 非 tab 页调用会失败，忽略 */
      })
    })
  }
}

class TaskStore {
  tasks: Task[] = []
  page = 0
  total = 0
  hasMore = true
  loading = false
  loadingMore = false
  filters: Pick<TaskQuery, 'status' | 'category' | 'keyword' | 'assigneeId'> = {}
  submitting = false
  error: string | null = null
  moreError: string | null = null
  private requestGate = new TaskListRequestGate()
  /** cloud：page 序号 → 该页 cursor（适配层维护，不把 cursor 填进旧 page 数字字段） */
  private pageCursors = new Map<string, (string | undefined)[]>()

  constructor() {
    makeAutoObservable<TaskStore, 'requestGate' | 'pageCursors'>(this, { requestGate: false, pageCursors: false })
  }

  setFilters(f: Partial<TaskStore['filters']>) {
    this.filters = { ...this.filters, ...f }
    // cloud：筛选变化即失效既有 cursor 链
    if (authStore.isCloud) this.pageCursors.clear()
    void this.load({ reset: true, clear: true })
  }

  async load(opts: { reset?: boolean; clear?: boolean; request?: TaskListRequest } = {}) {
    if (authStore.isCloud) return this.loadCloud(opts)
    const request = opts.reset
      ? this.requestGate.beginRefresh()
      : opts.request
    if (!request || !this.requestGate.isCurrent(request)) return

    const filters = { ...this.filters }
    runInAction(() => {
      if (opts.reset) {
        this.page = 0
        this.hasMore = true
        this.error = null
        this.moreError = null
        this.loadingMore = false
        if (opts.clear) {
          this.tasks = []
          this.total = 0
        }
      }
      if (request.page === 0) this.loading = true
      else {
        this.loadingMore = true
        this.moreError = null
      }
    })
    try {
      const p: Paged<Task> = await taskService.fetchTasks({
        ...filters,
        page: request.page,
        size: 20,
      })
      if (!this.requestGate.commit(request)) return
      runInAction(() => {
        this.tasks = request.page === 0 ? p.items : [...this.tasks, ...p.items]
        this.page = request.page
        this.total = p.total
        this.hasMore = this.tasks.length < p.total
        this.error = null
        this.moreError = null
      })
    } catch (e) {
      if (this.requestGate.isCurrent(request)) {
        runInAction(() => {
          const message = e instanceof ApiError ? e.userMessage : (e as Error)?.message || '加载任务失败'
          if (request.page === 0) this.error = message
          else this.moreError = message
        })
        fail(e, '加载任务失败')
      }
    } finally {
      if (this.requestGate.isCurrent(request)) {
        runInAction(() => {
          if (request.page === 0) this.loading = false
          else this.loadingMore = false
        })
      }
    }
  }

  /**
   * cloud：cursor 分页（服务端 `task.list`）。
   * - `status` 逗号串 → 数组；`assigneeId`（页面字段）→ `assigneeMemberId`。
   * - 每个 await 后二次校验捕获的 clubId：A 队结果不回填 B 队。
   * - 云列表契约不返回 total：`total` 只记录**已加载条数**，数量须用 `club.dashboard` 摘要。
   */
  private async loadCloud(opts: { reset?: boolean; clear?: boolean; request?: TaskListRequest }) {
    const team = authStore.cloudActiveTeam
    if (!team || authStore.cloudTeamState !== 'READY') return
    const clubId = team.clubId
    const request = opts.reset ? this.requestGate.beginRefresh() : opts.request
    if (!request || !this.requestGate.isCurrent(request)) return

    const filters = { ...this.filters }
    const key = JSON.stringify([clubId, filters])
    if (opts.reset) this.pageCursors.delete(key)
    const cursors = cursorPages(this.pageCursors, key)
    const cursor = cursors[request.page]

    runInAction(() => {
      if (opts.reset) {
        this.page = 0
        this.hasMore = true
        this.error = null
        this.moreError = null
        this.loadingMore = false
        if (opts.clear) {
          this.tasks = []
          this.total = 0
        }
      }
      if (request.page === 0) this.loading = true
      else {
        this.loadingMore = true
        this.moreError = null
      }
    })
    try {
      const statusList = (filters.status ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const raw = await cloudTaskList(clubId, {
        status: statusList.length > 0 ? statusList : undefined,
        category: filters.category || undefined,
        keyword: filters.keyword || undefined,
        assigneeMemberId: filters.assigneeId || undefined,
        cursor,
        pageSize: 20,
      })
      if (!this.requestGate.commit(request)) return
      if (authStore.cloudActiveTeam?.clubId !== clubId) return
      const mapped = raw.items.map(toLegacyTask)
      runInAction(() => {
        this.tasks = request.page === 0 ? mapped : [...this.tasks, ...mapped]
        this.page = request.page
        this.hasMore = raw.hasMore
        if (raw.nextCursor) cursors[request.page + 1] = raw.nextCursor
        this.total = this.tasks.length
        this.error = null
        this.moreError = null
      })
    } catch (e) {
      if (this.requestGate.isCurrent(request)) {
        runInAction(() => {
          const message = e instanceof ApiError ? e.userMessage : (e as Error)?.message || '加载任务失败'
          if (request.page === 0) this.error = message
          else this.moreError = message
        })
        fail(e, '加载任务失败')
      }
    } finally {
      if (this.requestGate.isCurrent(request)) {
        runInAction(() => {
          if (request.page === 0) this.loading = false
          else this.loadingMore = false
        })
      }
    }
  }

  private cloudClubOrThrow(): string {
    const team = authStore.cloudActiveTeam
    if (!team || authStore.cloudTeamState !== 'READY') throw new Error('尚未进入团队')
    return team.clubId
  }

  /** cloud 写动作前置读取：服务端以 expectedRevision 做乐观并发栅栏。 */
  private async currentRevision(clubId: string, taskId: string): Promise<number> {
    const view = await cloudTaskGet(clubId, taskId)
    return view.revision
  }

  /** 审核只作用当前待验收轮次：取 round 最大且仍为 SUBMITTED 的交付。 */
  private async pendingSubmissionId(clubId: string, taskId: string): Promise<string> {
    const subs = await cloudSubmissionList(clubId, taskId)
    const pending = subs
      .filter((sub) => sub.status === 'SUBMITTED')
      .sort((a, b) => b.round - a.round)[0]
    if (!pending) throw new Error('当前没有待验收的交付')
    return pending.submissionId
  }

  async loadMore() {
    if (!this.hasMore || this.loading || this.loadingMore) return
    const request = this.requestGate.beginNextPage()
    if (!request) return
    await this.load({ request })
  }

  async refresh() {
    await this.load({ reset: true })
  }

  /** 切队/登出：清列表/分页/筛选，并作废在途请求（旧 A 结果不得回填新队）。 */
  resetState() {
    this.pageCursors.clear()
    runInAction(() => {
      this.tasks = []
      this.page = 0
      this.total = 0
      this.hasMore = true
      this.loading = false
      this.loadingMore = false
      this.filters = {}
      this.submitting = false
      this.error = null
      this.moreError = null
    })
    this.requestGate = new TaskListRequestGate()
  }

  /** 动作统一模式：执行 → 刷新列表；失败回滚由服务端真源保证（设计 §5.2-6） */
  private async action(fn: () => Promise<unknown>, okMsg?: string) {
    if (this.submitting) throw new Error('操作进行中')
    runInAction(() => {
      this.submitting = true
    })
    try {
      await fn()
      if (okMsg) toast(okMsg, 'success')
      await this.refresh()
    } catch (e) {
      fail(e, '操作失败')
      throw e
    } finally {
      runInAction(() => {
        this.submitting = false
      })
    }
  }

  claim(id: string) {
    if (authStore.isCloud) {
      return this.action(async () => {
        const clubId = this.cloudClubOrThrow()
        await cloudTaskClaim(clubId, {
          taskId: id,
          expectedRevision: await this.currentRevision(clubId, id),
          mutationId: createMutationId(),
        })
      }, '已认领')
    }
    return this.action(() => taskService.claimTask(id), '已认领')
  }

  submit(
    id: string,
    note: string,
    attachments?: TaskSubmissionAttachment[],
    cloudAttachmentIds?: string[]
  ) {
    if (authStore.isCloud) {
      return this.action(async () => {
        const ids = cloudAttachmentIds ?? []
        if (ids.length > 3) throw new Error('附件最多 3 个')
        if ((attachments?.length ?? 0) !== ids.length) {
          throw new Error('附件尚未上传完成，请稍候或移除失败项')
        }
        const clubId = this.cloudClubOrThrow()
        await cloudTaskSubmit(clubId, {
          taskId: id,
          note,
          attachmentIds: ids,
          expectedRevision: await this.currentRevision(clubId, id),
          mutationId: createMutationId(),
        })
      }, '已提交，等待验收')
    }
    return this.action(
      () => taskService.submitTask(id, note, attachments),
      '已提交，等待验收'
    )
  }

  approve(id: string, grade: QualityGrade, note: string) {
    if (authStore.isCloud) {
      return this.action(async () => {
        const clubId = this.cloudClubOrThrow()
        await cloudTaskApprove(clubId, {
          taskId: id,
          submissionId: await this.pendingSubmissionId(clubId, id),
          grade,
          note,
          expectedRevision: await this.currentRevision(clubId, id),
          mutationId: createMutationId(),
        })
      }, '验收通过')
    }
    return this.action(() => taskService.approveTask(id, grade, note), '验收通过')
  }

  reject(id: string, reason: string) {
    if (authStore.isCloud) {
      return this.action(async () => {
        const clubId = this.cloudClubOrThrow()
        await cloudTaskReject(clubId, {
          taskId: id,
          submissionId: await this.pendingSubmissionId(clubId, id),
          reason,
          expectedRevision: await this.currentRevision(clubId, id),
          mutationId: createMutationId(),
        })
      }, '已驳回')
    }
    return this.action(() => taskService.rejectTask(id, reason), '已驳回')
  }

  archive(id: string) {
    if (authStore.isCloud) {
      return this.action(async () => {
        const clubId = this.cloudClubOrThrow()
        await cloudTaskArchive(clubId, {
          taskId: id,
          expectedRevision: await this.currentRevision(clubId, id),
          mutationId: createMutationId(),
        })
      }, '已归档')
    }
    return this.action(() => taskService.archiveTask(id), '已归档')
  }

  /**
   * 发布任务。cloud：捕获 clubId，返回后仅在**仍是同队**时才 toast/refresh
   * （旧 A 的发布不得刷新/提示到 B）。
   */
  publish(input: taskService.PublishTaskInput) {
    if (!authStore.isCloud) {
      return this.action(() => taskService.publishTask(input), '任务已发布')
    }
    if (this.submitting) return Promise.reject(new Error('操作进行中'))
    runInAction(() => {
      this.submitting = true
    })
    return (async () => {
      try {
        const clubId = this.cloudClubOrThrow()
        await cloudTaskCreate(
          clubId,
          {
            title: input.title,
            description: input.description,
            category: input.category,
            repo: input.repo ?? null,
            acceptanceCriteria: input.acceptanceCriteria ?? null,
          },
          createMutationId()
        )
        if (authStore.cloudActiveTeam?.clubId !== clubId) return
        toast('任务已发布', 'success')
        await this.refresh()
      } catch (e) {
        fail(e, '操作失败')
        throw e
      } finally {
        runInAction(() => {
          this.submitting = false
        })
      }
    })()
  }
}

class RoiStore {
  overview: RoiOverview | null = null
  period: RoiPeriod = 'month'
  items: RoiItem[] = []
  page = 0
  total = 0
  hasMore = true
  loading = false
  filters: { status?: string; category?: string; keyword?: string } = {}
  /** cloud：page 序号 → 该页 cursor（适配层维护，不把 cursor 填进旧 page 数字字段） */
  private pageCursors = new Map<string, (string | undefined)[]>()

  constructor() {
    makeAutoObservable<RoiStore, 'pageCursors'>(this, { pageCursors: false })
  }

  setPeriod(p: RoiPeriod) {
    this.period = p
    void this.loadOverview()
  }

  async loadOverview() {
    if (authStore.isCloud) return this.loadOverviewCloud()
    try {
      const ov = await roiService.fetchRoiOverview(this.period)
      runInAction(() => {
        this.overview = ov
      })
    } catch (e) {
      fail(e, '加载 ROI 概览失败')
    }
  }

  /** cloud：概览一次聚合；金额分→元只在边界换算；切队后不回填。 */
  private async loadOverviewCloud() {
    const team = authStore.cloudActiveTeam
    if (!team || authStore.cloudTeamState !== 'READY') return
    const clubId = team.clubId
    runInAction(() => {
      this.loading = true
    })
    try {
      const raw = await cloudRoiOverview(clubId, this.period)
      if (authStore.cloudActiveTeam?.clubId !== clubId) return
      runInAction(() => {
        this.overview = toLegacyRoiOverview(raw)
      })
    } catch (e) {
      fail(e, '加载 ROI 概览失败')
    } finally {
      runInAction(() => {
        this.loading = false
      })
    }
  }

  private cursorsFor(key: string): (string | undefined)[] {
    let list = this.pageCursors.get(key)
    if (!list) {
      list = [undefined]
      this.pageCursors.set(key, list)
    }
    return list
  }

  setFilters(f: Partial<RoiStore['filters']>) {
    this.filters = { ...this.filters, ...f }
    if (authStore.isCloud) this.pageCursors.clear()
    void this.loadItems({ reset: true })
  }

  async loadItems(opts: { reset?: boolean } = {}) {
    if (authStore.isCloud) return this.loadItemsCloud(opts)
    if (opts.reset) {
      this.page = 0
      this.hasMore = true
    }
    runInAction(() => {
      this.loading = true
    })
    try {
      const p = await roiService.fetchRoiItems({
        ...this.filters,
        page: this.page,
        size: 20,
      })
      runInAction(() => {
        this.items = this.page === 0 ? p.items : [...this.items, ...p.items]
        this.total = p.total
        this.hasMore = this.items.length < p.total
      })
    } catch (e) {
      fail(e, '加载 ROI 列表失败')
    } finally {
      runInAction(() => {
        this.loading = false
      })
    }
  }

  /** cloud：cursor 分页；失败不推进游标（page 不增），A 队结果不回填 B。 */
  private async loadItemsCloud(opts: { reset?: boolean }) {
    const team = authStore.cloudActiveTeam
    if (!team || authStore.cloudTeamState !== 'READY') return
    const clubId = team.clubId
    const key = JSON.stringify([clubId, this.filters])
    if (opts.reset) {
      this.pageCursors.delete(key)
      runInAction(() => {
        this.page = 0
        this.hasMore = true
      })
    }
    const cursors = this.cursorsFor(key)
    const cursor = cursors[this.page]
    runInAction(() => {
      this.loading = true
    })
    try {
      const raw = await cloudRoiList(clubId, { ...this.filters, cursor, pageSize: 20 })
      if (authStore.cloudActiveTeam?.clubId !== clubId) return
      const mapped = raw.items.map(toLegacyRoiItem)
      runInAction(() => {
        this.items = this.page === 0 ? mapped : [...this.items, ...mapped]
        this.hasMore = raw.hasMore
        if (raw.nextCursor) cursors[this.page + 1] = raw.nextCursor
        this.total = this.items.length
      })
    } catch (e) {
      fail(e, '加载 ROI 列表失败')
    } finally {
      runInAction(() => {
        this.loading = false
      })
    }
  }

  async loadMore() {
    if (!this.hasMore || this.loading) return
    this.page += 1
    await this.loadItems()
  }

  async fetchOne(id: string): Promise<RoiItem | null> {
    if (authStore.isCloud) {
      const team = authStore.cloudActiveTeam
      if (!team) return null
      try {
        const view = await cloudRoiGet(team.clubId, id)
        if (authStore.cloudActiveTeam?.clubId !== team.clubId) return null
        return toLegacyRoiItem(view)
      } catch (e) {
        fail(e, 'ROI 项目不存在')
        return null
      }
    }
    try {
      return await roiService.fetchRoiItem(id)
    } catch (e) {
      fail(e, 'ROI 项目不存在')
      return null
    }
  }

  async create(input: RoiInput) {
    if (authStore.isCloud) {
      const team = authStore.cloudActiveTeam
      if (!team) throw new Error('尚未进入团队')
      try {
        await cloudRoiCreate(team.clubId, toCloudRoiWrite(input), createMutationId())
        toast('已录入', 'success')
      } catch (e) {
        fail(e, '录入失败')
        throw e
      }
      return
    }
    try {
      await roiService.createRoiItem(input)
      toast('已录入', 'success')
    } catch (e) {
      fail(e, '录入失败')
      throw e
    }
  }

  async update(id: string, input: RoiInput) {
    if (authStore.isCloud) {
      const team = authStore.cloudActiveTeam
      if (!team) throw new Error('尚未进入团队')
      try {
        const current = await cloudRoiGet(team.clubId, id)
        await cloudRoiUpdate(team.clubId, {
          roiId: id,
          ...toCloudRoiWrite(input),
          expectedRevision: current.revision,
          mutationId: createMutationId(),
        })
        toast('已保存', 'success')
      } catch (e) {
        fail(e, '保存失败')
        throw e
      }
      return
    }
    try {
      await roiService.updateRoiItem(id, input)
      toast('已保存', 'success')
    } catch (e) {
      fail(e, '保存失败')
      throw e
    }
  }

  async remove(id: string) {
    if (authStore.isCloud) {
      const team = authStore.cloudActiveTeam
      if (!team) return
      try {
        await cloudRoiDelete(team.clubId, { roiId: id, mutationId: createMutationId() })
        toast('已删除', 'success')
        await this.loadItems({ reset: true })
      } catch (e) {
        fail(e, '删除失败')
      }
      return
    }
    try {
      await roiService.deleteRoiItem(id)
      toast('已删除', 'success')
      await this.loadItems({ reset: true })
    } catch (e) {
      fail(e, '删除失败')
    }
  }

  /** 切队/登出：清概览/列表/分页/筛选。 */
  resetState() {
    this.pageCursors.clear()
    runInAction(() => {
      this.overview = null
      this.items = []
      this.page = 0
      this.total = 0
      this.hasMore = true
      this.loading = false
      this.filters = {}
    })
  }
}

/** cloud cursor 分页：page 序号 → 该页 cursor（适配层维护，不把 cursor 填进旧 page 字段）。 */
function cursorPages(map: Map<string, (string | undefined)[]>, key: string): (string | undefined)[] {
  let list = map.get(key)
  if (!list) {
    list = [undefined]
    map.set(key, list)
  }
  return list
}

class TeamStore {
  members: ClubMember[] = []
  announcements: Announcement[] = []
  annTotal = 0
  /** cloud：公告是否还有下一页（云列表契约不返回 total，分页判据用 hasMore） */
  annHasMore = false
  invites: InviteCode[] = []
  joinRequests: JoinRequest[] = []
  /** cloud：入队申请加载失败原因（页面显式展示，不伪造空列表） */
  joinError: string | null = null
  allPerformance: MemberPerformance[] = []
  /** cloud：公告 page 序号 → cursor */
  private annCursors = new Map<string, (string | undefined)[]>()

  constructor() {
    makeAutoObservable<TeamStore, 'annCursors'>(this, { annCursors: false })
  }

  private cloudClubId(): string | null {
    const team = authStore.cloudActiveTeam
    return team && authStore.cloudTeamState === 'READY' ? team.clubId : null
  }

  async loadMembers() {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) return
      try {
        const page = await cloudMemberList(clubId, { pageSize: 50 })
        if (authStore.cloudActiveTeam?.clubId !== clubId) return
        runInAction(() => {
          this.members = page.items.map((view) => toLegacyMember(clubId, view))
        })
      } catch (e) {
        fail(e, '加载成员失败')
      }
      return
    }
    try {
      const list = await memberService.fetchMembers()
      runInAction(() => {
        this.members = list
      })
    } catch (e) {
      fail(e, '加载成员失败')
    }
  }

  /** includeDrafts 仅 manager+ 生效（服务端按角色裁剪：普通成员只回 PUBLISHED） */
  async loadAnnouncements(page = 0) {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) return
      const key = `ann:${clubId}`
      if (page === 0) this.annCursors.delete(key)
      const cursors = cursorPages(this.annCursors, key)
      try {
        const raw = await cloudAnnouncementList(clubId, { cursor: cursors[page], pageSize: 20 })
        if (authStore.cloudActiveTeam?.clubId !== clubId) return
        const mapped = raw.items.map(toLegacyAnnouncement)
        runInAction(() => {
          this.announcements = page === 0 ? mapped : [...this.announcements, ...mapped]
          this.annTotal = this.announcements.length
          this.annHasMore = raw.hasMore
          if (raw.nextCursor) cursors[page + 1] = raw.nextCursor
        })
      } catch (e) {
        fail(e, '加载公告失败')
      }
      return
    }
    try {
      const p = await clubService.fetchAnnouncements(page, 20)
      runInAction(() => {
        this.announcements = page === 0 ? p.items : [...this.announcements, ...p.items]
        this.annTotal = p.total
        this.annHasMore = this.announcements.length < p.total
      })
    } catch (e) {
      fail(e, '加载公告失败')
    }
  }

  private applyAnnouncement(next: Announcement) {
    runInAction(() => {
      const index = this.announcements.findIndex((item) => item.id === next.id)
      this.announcements = index < 0 ? [next, ...this.announcements] : this.announcements.map((item) => (item.id === next.id ? next : item))
    })
  }

  /** 新建公告（cloud 走幂等命令；legacy 走原 service）。 */
  async createAnnouncement(input: { title: string; body: string; pinned: boolean }) {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) throw new Error('尚未进入团队')
      const view = await cloudAnnouncementCreate(clubId, input, createMutationId())
      const mapped = toLegacyAnnouncement(view)
      runInAction(() => {
        this.announcements = [mapped, ...this.announcements]
        this.annTotal += 1
      })
      return mapped
    }
    const created = await clubService.createAnnouncement(input)
    this.applyAnnouncement(created)
    return created
  }

  async updateAnnouncement(id: string, input: { title?: string; body?: string; pinned?: boolean }) {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) throw new Error('尚未进入团队')
      const current = this.announcements.find((item) => item.id === id)
      if (!current) throw new Error('公告信息已变化，请刷新后重试')
      const view = await cloudAnnouncementUpdate(clubId, {
        announcementId: id,
        ...input,
        expectedRevision: current.revision ?? 0,
        mutationId: createMutationId(),
      })
      const mapped = toLegacyAnnouncement(view)
      this.applyAnnouncement(mapped)
      return mapped
    }
    const updated = await clubService.updateAnnouncement(id, input)
    this.applyAnnouncement(updated)
    return updated
  }

  async publishAnnouncement(id: string) {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) throw new Error('尚未进入团队')
      const current = this.announcements.find((item) => item.id === id)
      if (!current) throw new Error('公告信息已变化，请刷新后重试')
      const view = await cloudAnnouncementPublish(clubId, {
        announcementId: id,
        expectedRevision: current.revision ?? 0,
        mutationId: createMutationId(),
      })
      const mapped = toLegacyAnnouncement(view)
      this.applyAnnouncement(mapped)
      return mapped
    }
    const published = await clubService.publishAnnouncement(id)
    this.applyAnnouncement(published)
    return published
  }

  async archiveAnnouncement(id: string) {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) throw new Error('尚未进入团队')
      const current = this.announcements.find((item) => item.id === id)
      if (!current) throw new Error('公告信息已变化，请刷新后重试')
      const view = await cloudAnnouncementArchive(clubId, {
        announcementId: id,
        expectedRevision: current.revision ?? 0,
        mutationId: createMutationId(),
      })
      const mapped = toLegacyAnnouncement(view)
      this.applyAnnouncement(mapped)
      return mapped
    }
    const archived = await clubService.archiveAnnouncement(id)
    this.applyAnnouncement(archived)
    return archived
  }

  async loadPerformance() {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) return
      try {
        const page = await cloudPerformanceList(clubId, { pageSize: 50 })
        if (authStore.cloudActiveTeam?.clubId !== clubId) return
        runInAction(() => {
          this.allPerformance = page.items.map(toLegacyPerformance)
        })
      } catch (e) {
        fail(e, '加载考核失败')
      }
      return
    }
    try {
      const list = await taskService.fetchAllMemberPerformance()
      runInAction(() => {
        this.allPerformance = list
      })
    } catch (e) {
      fail(e, '加载考核失败')
    }
  }

  /**
   * 团队信息（cloud 用 club.get；legacy 走原 service）。settingsJson 仅为兼容旧页面展示。
   */
  async fetchClubInfo(): Promise<ClubInfo | null> {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) return null
      const view = await cloudClubGet(clubId)
      return {
        id: view.clubId,
        tenantId: '',
        slug: view.slug,
        name: view.name,
        logoUrl: view.logoUrl,
        description: view.description,
        settingsJson: JSON.stringify(view.settings ?? {}),
        createdAt: view.createdAt,
        updatedAt: view.updatedAt,
      }
    }
    return clubService.fetchClub()
  }

  /**
   * 团队设置（内容/设置白名单由服务端校验）。
   * cloud：先读当前 revision 再写，冲突由服务端 revision_conflict 拦截；legacy 走原 service。
   */
  async updateClub(input: {
    name?: string
    description?: string | null
    logoUrl?: string | null
    settings?: Record<string, unknown>
  }) {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) throw new Error('尚未进入团队')
      const current = await cloudClubGet(clubId)
      return cloudClubUpdate(clubId, {
        ...input,
        expectedRevision: current.revision,
        mutationId: createMutationId(),
      })
    }
    return clubService.updateClub({
      ...input,
      // legacy 契约不接受 null：显式清空语义在 cloud 端由服务端处理
      description: input.description ?? undefined,
      logoUrl: input.logoUrl ?? undefined,
    })
  }

  /**
   * 入队申请审核（TEAM）。
   * - cloud：`join.list/approve/reject`（manager+）；失败写入 `joinError` 供页面显式展示，
   *   **不伪造**空列表。
   * - legacy：走原 service 门面。
   */
  async loadJoinRequests() {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) return
      try {
        const page = await cloudJoinList(clubId, { status: 'PENDING', pageSize: 50 })
        if (authStore.cloudActiveTeam?.clubId !== clubId) return
        runInAction(() => {
          this.joinRequests = page.items.map((view) => toLegacyJoinRequest(clubId, view))
          this.joinError = null
        })
      } catch (e) {
        runInAction(() => {
          this.joinError = e instanceof ApiError ? e.userMessage : (e as Error)?.message || '加载申请失败'
        })
      }
      return
    }
    try {
      const list = await memberService.fetchJoinRequests('PENDING')
      runInAction(() => {
        this.joinRequests = list
        this.joinError = null
      })
    } catch (e) {
      fail(e, '加载申请失败')
    }
  }

  async approveJoin(id: string) {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) return
      try {
        await cloudJoinApprove(clubId, { joinRequestId: id, mutationId: createMutationId() })
        // 切队后不再刷新/提示（旧 A 的审批不在 B 续跑）
        if (authStore.cloudActiveTeam?.clubId !== clubId) return
        toast('已通过，成员下次进入小程序即生效', 'success')
        await this.loadJoinRequests()
        await this.loadMembers()
      } catch (e) {
        fail(e, '审批失败')
      }
      return
    }
    try {
      await memberService.approveJoinRequest(id)
      toast('已通过，成员下次进入小程序即生效', 'success')
      await this.loadJoinRequests()
      await this.loadMembers()
    } catch (e) {
      fail(e, '审批失败')
    }
  }

  async rejectJoin(id: string, reason: string) {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) return
      try {
        await cloudJoinReject(clubId, {
          joinRequestId: id,
          rejectReason: reason,
          mutationId: createMutationId(),
        })
        if (authStore.cloudActiveTeam?.clubId !== clubId) return
        await this.loadJoinRequests()
      } catch (e) {
        fail(e, '操作失败')
      }
      return
    }
    try {
      await memberService.rejectJoinRequest(id)
      await this.loadJoinRequests()
    } catch (e) {
      fail(e, '操作失败')
    }
  }

  async setRole(userId: string, role: ClubRole) {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) return
      if (role !== 'member' && role !== 'manager' && role !== 'super_admin') {
        toast('仅可任免为成员、管理层或超级管理员')
        return
      }
      const target = this.members.find((member) => member.id === userId)
      if (!target) {
        toast('成员信息已变化，请刷新后重试')
        await this.loadMembers()
        return
      }
      try {
        await cloudMemberSetRole(clubId, {
          targetMemberId: userId,
          targetRole: role,
          expectedRevision: target.revision ?? 0,
          mutationId: createMutationId(),
        })
        toast('任免已生效', 'success')
        await this.loadMembers()
        await this.loadPerformance()
      } catch (e) {
        fail(e, '任免失败')
      }
      return
    }
    try {
      if (role === 'super_admin') {
        toast('当前构建不支持任命超级管理员')
        return
      }
      await memberService.setMemberRole(userId, role)
      toast('任免已生效', 'success')
      await this.loadMembers()
      await this.loadPerformance()
    } catch (e) {
      fail(e, '任免失败')
    }
  }

  async setMemberStatus(userId: string, status: string) {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) return
      if (status === 'LEFT') {
        // 首版离队仅由受控运维处理，业务接口不提供
        toast('离队仅由团队运维处理')
        return
      }
      if (status !== 'ACTIVE' && status !== 'DISABLED') {
        toast('成员状态无效')
        return
      }
      const target = this.members.find((member) => member.id === userId)
      if (!target) {
        toast('成员信息已变化，请刷新后重试')
        await this.loadMembers()
        return
      }
      try {
        await cloudMemberSetStatus(clubId, {
          targetMemberId: userId,
          targetStatus: status,
          expectedRevision: target.revision ?? 0,
          mutationId: createMutationId(),
        })
        await this.loadMembers()
      } catch (e) {
        fail(e, '更新成员状态失败')
      }
      return
    }
    try {
      await memberService.setMemberStatus(userId, status)
      await this.loadMembers()
    } catch (e) {
      fail(e, '更新成员状态失败')
    }
  }

  async loadInvites() {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) return
      try {
        const list = await cloudInviteList(clubId)
        if (authStore.cloudActiveTeam?.clubId !== clubId) return
        runInAction(() => {
          this.invites = list.map((view) => toLegacyInvite(clubId, view))
        })
      } catch (e) {
        fail(e, '加载邀请码失败')
      }
      return
    }
    try {
      const list = await clubService.fetchInvites()
      runInAction(() => {
        this.invites = list
      })
    } catch (e) {
      fail(e, '加载邀请码失败')
    }
  }

  async createInvite() {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) throw new Error('尚未进入团队')
      try {
        const created = await cloudInviteCreate(clubId, {}, createMutationId())
        const invite = toLegacyInvite(clubId, created, created.plaintextCode)
        runInAction(() => {
          this.invites = [invite, ...this.invites]
        })
        return invite
      } catch (e) {
        fail(e, '生成邀请码失败')
        throw e
      }
    }
    try {
      const inv = await clubService.createInvite()
      runInAction(() => {
        this.invites = [inv, ...this.invites]
      })
      return inv
    } catch (e) {
      fail(e, '生成邀请码失败')
      throw e
    }
  }

  async revokeInvite(id: string) {
    if (authStore.isCloud) {
      const clubId = this.cloudClubId()
      if (!clubId) return
      try {
        await cloudInviteRevoke(clubId, id, createMutationId())
        await this.loadInvites()
      } catch (e) {
        fail(e, '作废失败')
      }
      return
    }
    try {
      await clubService.revokeInvite(id)
      await this.loadInvites()
    } catch (e) {
      fail(e, '作废失败')
    }
  }

  /** 切队/登出：清成员/公告/申请/邀请/绩效等全部本队展示数据。 */
  resetState() {
    this.annCursors.clear()
    runInAction(() => {
      this.members = []
      this.announcements = []
      this.annTotal = 0
      this.annHasMore = false
      this.invites = []
      this.joinRequests = []
      this.joinError = null
      this.allPerformance = []
    })
  }
}

export const authStore = new AuthStore()
export const uiStore = new UiStore()
export const taskStore = new TaskStore()
export const roiStore = new RoiStore()
export const teamStore = new TeamStore()

/** 切队/登出/换微信：清空全部业务 Store（受保护展示不得跨队残留）。 */
function resetBusinessStores() {
  taskStore.resetState()
  roiStore.resetState()
  teamStore.resetState()
  // 受保护展示含 QR 内存缓存（PLAN §M7 (e)/(j)）
  clubService.clearInviteQrCache()
}

/**
 * 未决命令对账（PLAN §M4 出口、§M7 (d)）：进入/回到某 scope 后，按**原 scope + 原 mutationId**
 * 查询 `command.status` 确认结果；**绝不新键重做、绝不重放 payload**。
 * - 只处理当前账户/当前队的指针；异 scope 指针不查询（A 的未知写不在 B 续跑）。
 * - `ACCEPTED_JOB` 保留指针；查询失败保留指针，下次再对账。
 */
let reconciling = false
async function reconcilePendingCommands(): Promise<void> {
  if (BACKEND !== 'cloud' || reconciling) return
  const snap = cloudSnapshot()
  if (!snap.accountIdentified) return
  const activeClubId = snap.active?.clubId ?? null
  const candidates: { entry: { action: string; mutationId: string }; scope: RequestScope }[] = [
    ...commandTracker
      .pendingInScope('GLOBAL')
      .map((entry) => ({ entry, scope: { kind: 'GLOBAL' } as RequestScope })),
  ]
  if (activeClubId) {
    candidates.push(
      ...commandTracker
        .pendingInScope(scopeKeyOf({ kind: 'TEAM', clubId: activeClubId }))
        .map((entry) => ({
          entry,
          scope: { kind: 'TEAM', clubId: activeClubId } as RequestScope,
        }))
    )
  }
  if (candidates.length === 0) return

  reconciling = true
  try {
    for (const { entry, scope } of candidates) {
      // 查询前重查活动 scope：切走后立即停止（不从旧队继续）
      if (scope.kind === 'TEAM' && cloudSnapshot().active?.clubId !== scope.clubId) continue
      try {
        const res = await cloudCommandStatus(scope, { action: entry.action, mutationId: entry.mutationId })
        if (res.status === 'ACCEPTED_JOB') continue
        commandTracker.resolve(scope, entry.action, entry.mutationId)
      } catch {
        /* 查询失败：保留指针，下次对账 */
      }
    }
    persistPendingCommands()
  } finally {
    reconciling = false
  }
}

/** 页面可注册"是否存在未提交编辑"探针，供切队协调器做脏编辑确认。 */
let unsavedProbe: (() => boolean) | null = null
export function setUnsavedProbe(probe: (() => boolean) | null) {
  unsavedProbe = probe
}

// 切队/登出前清受保护状态；reLaunch 目标由 cloud-team 默认为"我的"
configureCloudTeam({
  clearProtected: () => resetBusinessStores(),
  isDirty: () => unsavedProbe?.() === true,
})
