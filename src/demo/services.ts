import type { DemoAdapter } from './adapter'
import type {
  Announcement,
  ClubRole,
  InviteCode,
  JoinRequest,
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
} from '../types/domain'

export function createDemoServices(adapter: DemoAdapter) {
  return {
    auth: {
      wxLogin: async () => adapter.login(),
      bind: async (_inviteCode: string, _displayName?: string) => {
        throw new Error('邀请码绑定需要连接 Rak 服务端；演示账号请在设置中切换')
      },
      submitJoinRequest: async (_input: { name: string; wechat: string; reason: string }) => {
        throw new Error('入队申请需要连接 Rak 服务端；演示账号请在设置中切换')
      },
      fetchJoinStatus: async () => ({ status: 'NONE' as const, reviewedAt: null, clubName: null }),
      fetchMe: async () => adapter.me(),
      logout: async () => adapter.logout(),
      setRole: async (role: ClubRole) => adapter.setCurrentRole(role),
      reset: async () => adapter.reset(),
    },
    task: {
      fetchTasks: async (query: TaskQuery = {}): Promise<Paged<Task>> => adapter.fetchTasks(query),
      fetchTask: async (id: string): Promise<Task> => adapter.fetchTask(id),
      publishTask: async (input: Parameters<DemoAdapter['publishTask']>[0]) => adapter.publishTask(input),
      updateTask: async (id: string, input: Parameters<DemoAdapter['updateTask']>[1]) => adapter.updateTask(id, input),
      claimTask: async (id: string) => adapter.claimTask(id),
      submitTask: async (id: string, note: string, attachments?: TaskSubmissionAttachment[]) =>
        adapter.submitTask(id, note, attachments),
      approveTask: async (id: string, grade: QualityGrade, note: string) => adapter.approveTask(id, grade, note),
      rejectTask: async (id: string, reason: string) => adapter.rejectTask(id, reason),
      archiveTask: async (id: string) => adapter.archiveTask(id),
      fetchAllMemberPerformance: async (): Promise<MemberPerformance[]> => adapter.fetchAllMemberPerformance(),
      fetchMemberPerformance: async (userId: string) => adapter.fetchMemberPerformance(userId),
    },
    club: {
      fetchClub: async () => adapter.fetchClub(),
      updateClub: async (input: Parameters<DemoAdapter['updateClub']>[0]) => adapter.updateClub(input),
      fetchAnnouncements: async (page = 0, size = 20): Promise<Paged<Announcement>> => adapter.fetchAnnouncements(page, size),
      fetchAnnouncement: async (id: string) => adapter.fetchAnnouncement(id),
      createAnnouncement: async (input: Parameters<DemoAdapter['createAnnouncement']>[0]) => adapter.createAnnouncement(input),
      updateAnnouncement: async (id: string, input: Parameters<DemoAdapter['updateAnnouncement']>[1]) => adapter.updateAnnouncement(id, input),
      publishAnnouncement: async (id: string) => adapter.publishAnnouncement(id),
      archiveAnnouncement: async (id: string) => adapter.archiveAnnouncement(id),
      fetchInvites: async () => [],
      createInvite: async (_input?: { maxUses?: number; expiresInDays?: number }): Promise<InviteCode> => {
        throw new Error('邀请码需要连接 Rak 服务端')
      },
      revokeInvite: async (_id: string): Promise<InviteCode> => {
        throw new Error('邀请码需要连接 Rak 服务端')
      },
    },
    member: {
      fetchMembers: async () => adapter.fetchMembers(),
      setMemberStatus: async (userId: string, status: string) => adapter.setMemberStatus(userId, status),
      setMemberRole: async (userId: string, role: ClubRole) => adapter.setMemberRole(userId, role),
      fetchJoinRequests: async (_status?: JoinRequest['status']): Promise<JoinRequest[]> => [],
      approveJoinRequest: async (_id: string): Promise<JoinRequest> => {
        throw new Error('入队申请需要连接 Rak 服务端')
      },
      rejectJoinRequest: async (_id: string): Promise<JoinRequest> => {
        throw new Error('入队申请需要连接 Rak 服务端')
      },
    },
    roi: {
      fetchRoiItems: async (query: Parameters<DemoAdapter['fetchRoiItems']>[0] = {}) => adapter.fetchRoiItems(query),
      fetchRoiItem: async (id: string) => adapter.fetchRoiItem(id),
      fetchRoiOverview: async (period: RoiPeriod = 'month'): Promise<RoiOverview> => adapter.fetchRoiOverview(period),
      createRoiItem: async (input: RoiInput): Promise<RoiItem> => adapter.createRoiItem(input),
      updateRoiItem: async (id: string, input: RoiInput) => adapter.updateRoiItem(id, input),
      deleteRoiItem: async (id: string) => adapter.deleteRoiItem(id),
    },
  }
}
