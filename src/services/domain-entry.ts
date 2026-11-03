import type { createDemoServices } from '../demo/services'
import type {
  Announcement,
  JoinStatusView,
  LoginOutcome,
  MemberPerformance,
  MeView,
  Paged,
  QualityGrade,
  RoiInput,
  RoiItem,
  RoiOverview,
  RoiPeriod,
  Task,
  TaskSubmissionAttachment,
  TaskQuery,
} from '../types/domain'
import { AuthContractError, normalizeLoginOutcome, normalizeMeView } from '../utils/auth-contract.js'

export interface PublishTaskInput {
  title: string
  description: string
  category: string
  repo?: string | null
  acceptanceCriteria?: string | null
}

export interface ServiceRequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  data?: Record<string, unknown>
  auth?: boolean
}

export type ServiceRequest = <T>(options: ServiceRequestOptions) => Promise<T>

export interface ServiceEntryContext {
  demoMode: boolean
  request: ServiceRequest
  clubBase: () => string
  query: (params: Record<string, string | number | undefined | null>) => string
}

type DemoTaskService = ReturnType<typeof createDemoServices>['task']
type DemoClubService = ReturnType<typeof createDemoServices>['club']
type DemoRoiService = ReturnType<typeof createDemoServices>['roi']
type DemoAuthService = ReturnType<typeof createDemoServices>['auth']

function readLoginOutcome(
  response: unknown,
  setToken: (token: string) => void
): LoginOutcome {
  try {
    return normalizeLoginOutcome(response)
  } catch (error) {
    setToken('')
    throw error
  }
}

export function createAuthService(
  context: {
    demoMode: boolean
    request: ServiceRequest
    demo: () => DemoAuthService
    login: () => Promise<{ code: string }>
    wechatBase: string
    setToken: (token: string) => void
  }
) {
  const demo = () => context.demo()

  return {
    async wxLogin(): Promise<LoginOutcome> {
      if (context.demoMode) return demo().wxLogin()
      const { code } = await context.login()
      const response = await context.request<unknown>({
        url: `${context.wechatBase}/login`,
        method: 'POST',
        data: { code },
        auth: false,
      })
      const out = readLoginOutcome(response, context.setToken)
      if (out.bound && out.accessToken) context.setToken(out.accessToken)
      else context.setToken('')
      return out
    },

    async bind(inviteCode: string, displayName?: string): Promise<LoginOutcome> {
      if (context.demoMode) return demo().bind(inviteCode, displayName)
      const { code } = await context.login()
      const response = await context.request<unknown>({
        url: `${context.wechatBase}/bind`,
        method: 'POST',
        data: { code, inviteCode, displayName: displayName || undefined },
        auth: false,
      })
      const out = readLoginOutcome(response, context.setToken)
      if (out.bound && out.accessToken) context.setToken(out.accessToken)
      else context.setToken('')
      return out
    },

    async submitJoinRequest(input: { name: string; wechat: string; reason: string }) {
      if (context.demoMode) return demo().submitJoinRequest(input)
      const { code } = await context.login()
      return context.request<{ id: string; status: string }>({
        url: `${context.wechatBase}/join-request`,
        method: 'POST',
        data: {
          code,
          applicantName: input.name,
          applicantWechat: input.wechat,
          reason: input.reason,
        },
        auth: false,
      })
    },

    async fetchJoinStatus(): Promise<JoinStatusView> {
      if (context.demoMode) return demo().fetchJoinStatus()
      const { code } = await context.login()
      return context.request<JoinStatusView>({
        url: `${context.wechatBase}/join-request`,
        data: { code },
        auth: false,
      })
    },

    fetchMe(): Promise<MeView> {
      if (context.demoMode) return demo().fetchMe()
      return context.request<unknown>({ url: `${context.wechatBase}/me` }).then((response) => {
        try {
          return normalizeMeView(response)
        } catch (error) {
          if (error instanceof AuthContractError) context.setToken('')
          throw error
        }
      })
    },

    async logout(): Promise<void> {
      if (context.demoMode) {
        await demo().logout()
        context.setToken('')
        return
      }
      try {
        await context.request({ url: '/auth/logout', method: 'POST' })
      } catch {
        // Logout is best-effort; always clear the local token.
      } finally {
        context.setToken('')
      }
    },

    setDemoRole(role: 'super_admin' | 'manager' | 'member'): Promise<MeView> {
      if (!context.demoMode) throw new Error('仅本地演示模式可以切换演示角色')
      return demo().setRole(role)
    },

    async resetDemoData(): Promise<void> {
      if (!context.demoMode) throw new Error('仅本地演示模式可以重置演示数据')
      await demo().reset()
    },
  }
}

export function createTaskService(
  context: ServiceEntryContext & { demo: () => DemoTaskService }
) {
  const base = () => `${context.clubBase()}/tasks`
  const demo = () => context.demo()

  return {
    fetchTasks(q: TaskQuery = {}): Promise<Paged<Task>> {
      if (context.demoMode) return demo().fetchTasks(q)
      return context.request<Paged<Task>>({
        url: `${base()}${context.query({
          status: q.status,
          category: q.category,
          keyword: q.keyword,
          assigneeId: q.assigneeId,
          page: q.page ?? 0,
          size: q.size ?? 20,
        })}`,
      })
    },

    fetchTask(id: string): Promise<Task> {
      if (context.demoMode) return demo().fetchTask(id)
      return context.request<Task>({ url: `${base()}/${id}` })
    },

    publishTask(input: PublishTaskInput): Promise<Task> {
      if (context.demoMode) return demo().publishTask(input)
      return context.request<Task>({ url: base(), method: 'POST', data: { ...input } })
    },

    updateTask(id: string, input: PublishTaskInput): Promise<Task> {
      if (context.demoMode) return demo().updateTask(id, input)
      return context.request<Task>({ url: `${base()}/${id}`, method: 'PATCH', data: { ...input } })
    },

    claimTask(id: string): Promise<Task> {
      if (context.demoMode) return demo().claimTask(id)
      return context.request<Task>({ url: `${base()}/${id}/claim`, method: 'POST' })
    },

    submitTask(
      id: string,
      note: string,
      attachments: TaskSubmissionAttachment[] = []
    ): Promise<Task> {
      if (context.demoMode) return demo().submitTask(id, note, attachments)
      if (attachments.length > 0) {
        throw new Error('Rak 服务端尚未定义任务附件上传接口')
      }
      return context.request<Task>({ url: `${base()}/${id}/submit`, method: 'POST', data: { note } })
    },

    approveTask(id: string, grade: QualityGrade, note: string): Promise<Task> {
      if (context.demoMode) return demo().approveTask(id, grade, note)
      return context.request<Task>({
        url: `${base()}/${id}/approve`,
        method: 'POST',
        data: { grade, note: note || undefined },
      })
    },

    rejectTask(id: string, reason: string): Promise<Task> {
      if (context.demoMode) return demo().rejectTask(id, reason)
      return context.request<Task>({ url: `${base()}/${id}/reject`, method: 'POST', data: { reason } })
    },

    archiveTask(id: string): Promise<Task> {
      if (context.demoMode) return demo().archiveTask(id)
      return context.request<Task>({ url: `${base()}/${id}/archive`, method: 'POST' })
    },

    fetchAllMemberPerformance(): Promise<MemberPerformance[]> {
      if (context.demoMode) return demo().fetchAllMemberPerformance()
      return context.request<MemberPerformance[]>({ url: `${context.clubBase()}/performance` })
    },

    async fetchMemberPerformance(userId: string): Promise<MemberPerformance | null> {
      if (context.demoMode) return demo().fetchMemberPerformance(userId)
      const list = await context.request<MemberPerformance[]>({
        url: `${context.clubBase()}/members/${userId}/performance`,
      })
      return list[0] || null
    },
  }
}

export function createAnnouncementService(
  context: ServiceEntryContext & { demo: () => DemoClubService }
) {
  const base = () => `${context.clubBase()}/announcements`
  const demo = () => context.demo()

  return {
    fetchAnnouncements(page = 0, size = 20): Promise<Paged<Announcement>> {
      if (context.demoMode) return demo().fetchAnnouncements(page, size)
      return context.request<Paged<Announcement>>({ url: `${base()}${context.query({ page, size })}` })
    },

    fetchAnnouncement(id: string): Promise<Announcement> {
      if (context.demoMode) return demo().fetchAnnouncement(id)
      return context.request<Announcement>({ url: `${base()}/${id}` })
    },

    createAnnouncement(input: { title: string; body: string; pinned: boolean }): Promise<Announcement> {
      if (context.demoMode) return demo().createAnnouncement(input)
      return context.request<Announcement>({ url: base(), method: 'POST', data: { ...input } })
    },

    updateAnnouncement(id: string, input: { title?: string; body?: string; pinned?: boolean }): Promise<Announcement> {
      if (context.demoMode) return demo().updateAnnouncement(id, input)
      return context.request<Announcement>({ url: `${base()}/${id}`, method: 'PATCH', data: { ...input } })
    },

    publishAnnouncement(id: string): Promise<Announcement> {
      if (context.demoMode) return demo().publishAnnouncement(id)
      return context.request<Announcement>({ url: `${base()}/${id}/publish`, method: 'POST' })
    },

    archiveAnnouncement(id: string): Promise<Announcement> {
      if (context.demoMode) return demo().archiveAnnouncement(id)
      return context.request<Announcement>({ url: `${base()}/${id}`, method: 'DELETE' })
    },
  }
}

export function createRoiService(
  context: ServiceEntryContext & { demo: () => DemoRoiService }
) {
  const base = () => `${context.clubBase()}/roi`
  const demo = () => context.demo()

  return {
    fetchRoiItems(q: {
      status?: string
      category?: string
      keyword?: string
      page?: number
      size?: number
    } = {}): Promise<Paged<RoiItem>> {
      if (context.demoMode) return demo().fetchRoiItems(q)
      return context.request<Paged<RoiItem>>({
        url: `${base()}/items${context.query({
          status: q.status,
          category: q.category,
          keyword: q.keyword,
          page: q.page ?? 0,
          size: q.size ?? 20,
        })}`,
      })
    },

    fetchRoiItem(id: string): Promise<RoiItem> {
      if (context.demoMode) return demo().fetchRoiItem(id)
      return context.request<RoiItem>({ url: `${base()}/items/${id}` })
    },

    fetchRoiOverview(period: RoiPeriod = 'month'): Promise<RoiOverview> {
      if (context.demoMode) return demo().fetchRoiOverview(period)
      return context.request<RoiOverview>({ url: `${base()}/overview?period=${period}` })
    },

    createRoiItem(input: RoiInput): Promise<RoiItem> {
      if (context.demoMode) return demo().createRoiItem(input)
      return context.request<RoiItem>({ url: `${base()}/items`, method: 'POST', data: { ...input } })
    },

    updateRoiItem(id: string, input: RoiInput): Promise<RoiItem> {
      if (context.demoMode) return demo().updateRoiItem(id, input)
      return context.request<RoiItem>({ url: `${base()}/items/${id}`, method: 'PATCH', data: { ...input } })
    },

    deleteRoiItem(id: string): Promise<void> {
      if (context.demoMode) return demo().deleteRoiItem(id)
      return context.request<void>({ url: `${base()}/items/${id}`, method: 'DELETE' })
    },
  }
}
