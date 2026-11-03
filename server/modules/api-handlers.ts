import { AppError } from '../contracts/errors.ts'
import type { Database } from '../repositories/store.ts'
import { COLLECTIONS } from '../repositories/collections.ts'
import { identityId, randomClubId } from '../repositories/ids.ts'
import type { ParsedRequest } from '../contracts/request-v2.ts'
import type { HandlerMap } from '../entrypoints/dispatch.ts'
import { assertTrustedIdentity, type TrustedIdentity } from '../shared/identity.ts'
import * as auth from './auth/index.ts'
import * as teams from './teams/index.ts'
import * as members from './members/index.ts'
import * as join from './join/index.ts'
import * as invites from './invites/index.ts'
import * as tasks from './tasks/index.ts'
import * as announcements from './announcements/index.ts'
import * as roi from './roi/index.ts'
import * as performance from './performance/index.ts'
import * as club from './club/index.ts'
import * as clubApplications from './clubApplications/index.ts'
import * as dismissals from './dismissals/index.ts'
import * as dissolutions from './dissolutions/index.ts'

/**
 * M3 已实现的 rakApi 动作处理器（多团队 DESIGN §M3）。
 *
 * runtime 提供：数据库、时钟、可信身份来源与预期 AppID/环境。
 * 生产运行时由 entrypoints/runtime.ts 装配（CloudBase SDK 绑定留待 M5/M8）；
 * 本地测试用 MemoryDatabase + 伪造身份注入，**不得**称其为真实云鉴权。
 */

export interface ApiRuntime {
  db: Database
  now: () => number
  expected: { appId: string; env: string }
  identity: () => TrustedIdentity | null
  /** 申请入口 token 签名密钥（仅服务端受控配置，不进源码/日志）。 */
  joinSecret: string
}

function teamClubId(req: ParsedRequest): string {
  const scope = req.request.scope
  if (scope.kind !== 'TEAM') throw new AppError('scope_mismatch', '本动作需要 TEAM scope')
  return scope.clubId
}

export function createApiHandlers(runtime: ApiRuntime): HandlerMap {
  const requireIdentity = (): TrustedIdentity =>
    assertTrustedIdentity(runtime.identity(), runtime.expected)
  const deps = { db: runtime.db, now: runtime.now }
  const joinDeps = { db: runtime.db, now: runtime.now, joinSecret: runtime.joinSecret }
  const inviteDeps = { db: runtime.db, now: runtime.now }
  const applicationDeps = { db: runtime.db, now: runtime.now, newClubId: randomClubId }
  const dismissalDeps = { db: runtime.db, now: runtime.now }
  const dissolutionDeps = { db: runtime.db, now: runtime.now }

  return {
    // ===== 身份 / 账户 =====
    'auth.bootstrap': async () => auth.bootstrap(deps, requireIdentity()),
    'auth.me': async () => {
      const identity = requireIdentity()
      const identityDoc = await runtime.db.read(
        COLLECTIONS.identities,
        identityId(identity.appId, identity.openid)
      )
      if (!identityDoc) throw new AppError('identity_required')
      const user = await runtime.db.read(COLLECTIONS.users, identityDoc.userId as string)
      const config = await runtime.db.read(COLLECTIONS.systemConfig, 'main')
      return {
        accountKey: identityDoc.userId as string,
        securityState: user?.securityState === 'BLOCKED' ? 'BLOCKED' : 'NORMAL',
        setupRequired: !config,
      }
    },
    'account.provisioningReference': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { replaceConsumed?: unknown }
      return auth.provisioningReference(deps, identity, data.replaceConsumed === true)
    },

    // ===== 团队 =====
    'team.listMine': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { cursor?: string; pageSize?: number }
      return teams.listMine(deps, identity, { cursor: data.cursor, pageSize: data.pageSize })
    },
    'team.enter': async (req) => {
      const identity = requireIdentity()
      return teams.enter(deps, identity, teamClubId(req))
    },

    // ===== 成员 =====
    'member.list': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { cursor?: string; pageSize?: number }
      return members.listMembers(deps, identity, teamClubId(req), {
        cursor: data.cursor,
        pageSize: data.pageSize,
      })
    },
    'member.setRole': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        targetMemberId: string
        targetRole: 'member' | 'manager' | 'super_admin'
      }
      return members.setRole(deps, identity, teamClubId(req), {
        targetMemberId: data.targetMemberId,
        targetRole: data.targetRole,
        expectedRevision: req.request.expectedRevision as number,
        mutationId: req.request.mutationId as string,
      })
    },
    'member.setStatus': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        targetMemberId: string
        targetStatus: 'ACTIVE' | 'DISABLED'
      }
      return members.setStatus(deps, identity, teamClubId(req), {
        targetMemberId: data.targetMemberId,
        targetStatus: data.targetStatus,
        expectedRevision: req.request.expectedRevision as number,
        mutationId: req.request.mutationId as string,
      })
    },
    'member.updateMyProfile': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { displayName: string; duty?: string | null }
      return members.updateMyProfile(deps, identity, teamClubId(req), {
        displayName: data.displayName,
        duty: data.duty,
        expectedRevision: req.request.expectedRevision as number,
        mutationId: req.request.mutationId as string,
      })
    },
    'member.updateProfile': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        targetMemberId: string
        displayName?: string
        duty?: string | null
      }
      return members.updateProfile(deps, identity, teamClubId(req), {
        targetMemberId: data.targetMemberId,
        displayName: data.displayName,
        duty: data.duty,
        expectedRevision: req.request.expectedRevision as number,
        mutationId: req.request.mutationId as string,
      })
    },

    // ===== 开通新团队（2026-10-18）：成员申请 → 本队管理员审批 → 建队 =====
    'team.newApplication.submit': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        name: string
        slug: string
        displayCode: string
        description?: string | null
      }
      return clubApplications.submitNewTeamApplication(applicationDeps, identity, teamClubId(req), data)
    },
    'team.newApplication.mine': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { cursor?: string; pageSize?: number }
      return clubApplications.listMyNewTeamApplications(applicationDeps, identity, {
        cursor: data.cursor,
        pageSize: data.pageSize,
      })
    },
    'team.newApplication.list': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        status?: 'PENDING' | 'APPROVED' | 'REJECTED'
        cursor?: string
        pageSize?: number
      }
      return clubApplications.listNewTeamApplications(applicationDeps, identity, teamClubId(req), data)
    },
    'team.newApplication.approve': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { applicationId: string }
      return clubApplications.approveNewTeamApplication(applicationDeps, identity, teamClubId(req), {
        applicationId: data.applicationId,
        mutationId: req.request.mutationId as string,
        expectedRevision: req.request.expectedRevision,
      })
    },
    'team.newApplication.reject': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { applicationId: string; rejectReason: string }
      return clubApplications.rejectNewTeamApplication(applicationDeps, identity, teamClubId(req), {
        applicationId: data.applicationId,
        rejectReason: data.rejectReason,
        mutationId: req.request.mutationId as string,
        expectedRevision: req.request.expectedRevision,
      })
    },

    // ===== 裁员（2026-10-18）：双人双角色审批 → LEFT =====
    'member.dismissal.request': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { targetMemberId: string; reason: string }
      return dismissals.requestDismissal(dismissalDeps, identity, teamClubId(req), {
        targetMemberId: data.targetMemberId,
        reason: data.reason,
        mutationId: req.request.mutationId as string,
      })
    },
    'member.dismissal.list': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
        cursor?: string
        pageSize?: number
      }
      return dismissals.listDismissals(dismissalDeps, identity, teamClubId(req), data)
    },
    'member.dismissal.approve': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { dismissalId: string }
      return dismissals.approveDismissal(dismissalDeps, identity, teamClubId(req), {
        dismissalId: data.dismissalId,
        mutationId: req.request.mutationId as string,
        expectedRevision: req.request.expectedRevision,
      })
    },
    'member.dismissal.reject': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { dismissalId: string; rejectReason: string }
      return dismissals.rejectDismissal(dismissalDeps, identity, teamClubId(req), {
        dismissalId: data.dismissalId,
        rejectReason: data.rejectReason,
        mutationId: req.request.mutationId as string,
        expectedRevision: req.request.expectedRevision,
      })
    },

    // ===== 团队解散（2026-10-18）=====
    'club.dissolve': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { reason: string }
      return dissolutions.dissolveByManager(dissolutionDeps, identity, teamClubId(req), {
        reason: data.reason,
        mutationId: req.request.mutationId as string,
      })
    },
    'club.dissolution.request': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { reason: string }
      return dissolutions.requestDissolution(dissolutionDeps, identity, teamClubId(req), {
        reason: data.reason,
        mutationId: req.request.mutationId as string,
      })
    },
    'club.dissolution.list': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
        cursor?: string
        pageSize?: number
      }
      return dissolutions.listDissolutionRequests(dissolutionDeps, identity, data)
    },
    'club.dissolution.decide': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { targetClubId: string; approve: boolean; rejectReason?: string }
      return dissolutions.decideDissolution(dissolutionDeps, identity, {
        clubId: data.targetClubId,
        approve: data.approve === true,
        rejectReason: data.rejectReason,
        mutationId: req.request.mutationId as string,
        expectedRevision: req.request.expectedRevision,
      })
    },
    'club.searchForAdmin': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { keyword?: string }
      return dissolutions.searchClubsForAdmin(dissolutionDeps, identity, { keyword: data.keyword })
    },
    'club.dissolveAny': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { targetClubId: string; reason: string }
      return dissolutions.dissolveAnyClub(dissolutionDeps, identity, {
        clubId: data.targetClubId,
        reason: data.reason,
        mutationId: req.request.mutationId as string,
      })
    },

    // ===== 申请入口 / 入队 =====
    'team.resolveJoinTarget': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { joinKey: string }
      return join.resolveJoinTarget(joinDeps, identity, data.joinKey)
    },
    'team.joinLink.rotate': async (req) => {
      const identity = requireIdentity()
      return join.rotateJoinLink(joinDeps, identity, teamClubId(req), {
        mutationId: req.request.mutationId as string,
      })
    },
    'join.submit': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { joinTargetToken: string; name: string; wechat: string; reason: string }
      return join.submit(joinDeps, identity, {
        joinTargetToken: data.joinTargetToken,
        name: data.name,
        wechat: data.wechat,
        reason: data.reason,
        mutationId: req.request.mutationId as string,
      })
    },
    'join.status': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { joinRequestId: string }
      return join.status(joinDeps, identity, data.joinRequestId)
    },
    'join.mine': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { cursor?: string; pageSize?: number }
      return join.listMine(joinDeps, identity, { cursor: data.cursor, pageSize: data.pageSize })
    },
    'join.list': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        status?: 'PENDING' | 'APPROVED' | 'REJECTED'
        cursor?: string
        pageSize?: number
      }
      return join.listJoinRequests(joinDeps, identity, teamClubId(req), data)
    },
    'join.approve': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { joinRequestId: string }
      return join.approveJoinRequest(joinDeps, identity, teamClubId(req), {
        joinRequestId: data.joinRequestId,
        mutationId: req.request.mutationId as string,
      })
    },
    'join.reject': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { joinRequestId: string; rejectReason: string }
      return join.rejectJoinRequest(joinDeps, identity, teamClubId(req), {
        joinRequestId: data.joinRequestId,
        rejectReason: data.rejectReason,
        mutationId: req.request.mutationId as string,
      })
    },
    'invite.list': async (req) => {
      const identity = requireIdentity()
      return invites.listInvites(inviteDeps, identity, teamClubId(req))
    },
    'invite.create': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { maxUses?: number; expiresInDays?: number }
      return invites.createInvite(inviteDeps, identity, teamClubId(req), {
        maxUses: data.maxUses,
        expiresInDays: data.expiresInDays,
        mutationId: req.request.mutationId as string,
      })
    },
    'invite.revoke': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { inviteId: string }
      return invites.revokeInvite(inviteDeps, identity, teamClubId(req), {
        inviteId: data.inviteId,
        mutationId: req.request.mutationId as string,
      })
    },
    'invite.redeem': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { code?: string; sceneToken?: string; displayName: string }
      return invites.redeem(inviteDeps, identity, {
        code: data.code,
        sceneToken: data.sceneToken,
        displayName: data.displayName,
        mutationId: req.request.mutationId as string,
      })
    },

    // ===== 任务 / 交付（M4）=====
    'task.list': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        status?: string[]
        category?: string
        keyword?: string
        assigneeMemberId?: string
        cursor?: string
        pageSize?: number
      }
      return tasks.listTasks(deps, identity, teamClubId(req), data)
    },
    'task.get': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { taskId: string }
      return tasks.getTask(deps, identity, teamClubId(req), data.taskId)
    },
    'task.create': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        title: string
        description: string
        category: string
        repo?: string | null
        acceptanceCriteria?: string | null
      }
      return tasks.createTask(deps, identity, teamClubId(req), {
        ...data,
        mutationId: req.request.mutationId as string,
      })
    },
    'task.update': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        taskId: string
        title?: string
        description?: string
        category?: string
        repo?: string | null
        acceptanceCriteria?: string | null
      }
      return tasks.updateTask(deps, identity, teamClubId(req), {
        ...data,
        expectedRevision: req.request.expectedRevision as number,
        mutationId: req.request.mutationId as string,
      })
    },
    'task.claim': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { taskId: string }
      return tasks.claimTask(deps, identity, teamClubId(req), {
        taskId: data.taskId,
        expectedRevision: req.request.expectedRevision as number,
        mutationId: req.request.mutationId as string,
      })
    },
    'task.submit': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        taskId: string
        note: string
        attachmentIds?: string[]
        targetRound?: number
      }
      return tasks.submitTask(deps, identity, teamClubId(req), {
        taskId: data.taskId,
        note: data.note,
        attachmentIds: data.attachmentIds ?? [],
        targetRound: data.targetRound,
        expectedRevision: req.request.expectedRevision as number,
        mutationId: req.request.mutationId as string,
      })
    },
    'task.approve': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        taskId: string
        submissionId: string
        grade: string
        note?: string
      }
      return tasks.approveTask(deps, identity, teamClubId(req), {
        taskId: data.taskId,
        submissionId: data.submissionId,
        grade: data.grade,
        note: data.note,
        expectedRevision: req.request.expectedRevision as number,
        mutationId: req.request.mutationId as string,
      })
    },
    'task.reject': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { taskId: string; submissionId: string; reason: string }
      return tasks.rejectTask(deps, identity, teamClubId(req), {
        taskId: data.taskId,
        submissionId: data.submissionId,
        reason: data.reason,
        expectedRevision: req.request.expectedRevision as number,
        mutationId: req.request.mutationId as string,
      })
    },
    'task.archive': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { taskId: string }
      return tasks.archiveTask(deps, identity, teamClubId(req), {
        taskId: data.taskId,
        expectedRevision: req.request.expectedRevision as number,
        mutationId: req.request.mutationId as string,
      })
    },
    'submission.list': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { taskId: string }
      return tasks.listSubmissions(deps, identity, teamClubId(req), data.taskId)
    },
    'submission.get': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { submissionId: string }
      return tasks.getSubmission(deps, identity, teamClubId(req), data.submissionId)
    },
    // ===== 公告（M6）=====
    'announcement.list': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { status?: string; cursor?: string; pageSize?: number }
      return announcements.listAnnouncements(deps, identity, teamClubId(req), data)
    },
    'announcement.get': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { announcementId: string }
      return announcements.getAnnouncement(deps, identity, teamClubId(req), data.announcementId)
    },
    'announcement.create': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { title: string; body: string; pinned?: boolean }
      return announcements.createAnnouncement(deps, identity, teamClubId(req), {
        title: data.title,
        body: data.body,
        pinned: data.pinned,
        mutationId: req.request.mutationId as string,
      })
    },
    'announcement.update': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { announcementId: string; title?: string; body?: string; pinned?: boolean }
      return announcements.updateAnnouncement(deps, identity, teamClubId(req), {
        announcementId: data.announcementId,
        title: data.title,
        body: data.body,
        pinned: data.pinned,
        expectedRevision: req.request.expectedRevision as number,
        mutationId: req.request.mutationId as string,
      })
    },
    'announcement.publish': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { announcementId: string }
      return announcements.publishAnnouncement(deps, identity, teamClubId(req), {
        announcementId: data.announcementId,
        expectedRevision: req.request.expectedRevision as number,
        mutationId: req.request.mutationId as string,
      })
    },
    'announcement.archive': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { announcementId: string }
      return announcements.archiveAnnouncement(deps, identity, teamClubId(req), {
        announcementId: data.announcementId,
        expectedRevision: req.request.expectedRevision as number,
        mutationId: req.request.mutationId as string,
      })
    },

    // ===== ROI（M6）=====
    'roi.list': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        status?: string
        category?: string
        keyword?: string
        cursor?: string
        pageSize?: number
      }
      return roi.listRoiItems(deps, identity, teamClubId(req), data)
    },
    'roi.get': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { roiId: string }
      return roi.getRoiItem(deps, identity, teamClubId(req), data.roiId)
    },
    'roi.create': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        title: string
        category: string
        cost: string
        revenue: string
        participants?: number
        periodStart?: string | null
        periodEnd?: string | null
        status?: string
        notes?: string | null
      }
      return roi.createRoiItem(deps, identity, teamClubId(req), {
        title: data.title,
        category: data.category,
        cost: data.cost,
        revenue: data.revenue,
        participants: data.participants,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        status: data.status,
        notes: data.notes,
        mutationId: req.request.mutationId as string,
      })
    },
    'roi.update': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        roiId: string
        title?: string
        category?: string
        cost?: string
        revenue?: string
        participants?: number
        periodStart?: string | null
        periodEnd?: string | null
        status?: string
        notes?: string | null
      }
      return roi.updateRoiItem(deps, identity, teamClubId(req), {
        roiId: data.roiId,
        title: data.title,
        category: data.category,
        cost: data.cost,
        revenue: data.revenue,
        participants: data.participants,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        status: data.status,
        notes: data.notes,
        expectedRevision: req.request.expectedRevision as number,
        mutationId: req.request.mutationId as string,
      })
    },
    'roi.delete': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { roiId: string }
      return roi.deleteRoiItem(deps, identity, teamClubId(req), {
        roiId: data.roiId,
        mutationId: req.request.mutationId as string,
      })
    },
    'roi.overview': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { period?: string }
      const period = data.period === undefined ? 'month' : data.period
      return roi.roiOverview(deps, identity, teamClubId(req), period as 'month' | 'quarter' | 'year' | 'all')
    },

    // ===== 绩效 / 社团摘要（M6）=====
    'performance.mine': async (req) => {
      const identity = requireIdentity()
      return performance.myPerformance(deps, identity, teamClubId(req))
    },
    'performance.list': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { cursor?: string; pageSize?: number }
      return performance.listPerformance(deps, identity, teamClubId(req), data)
    },
    'club.get': async (req) => {
      const identity = requireIdentity()
      return club.getClub(deps, identity, teamClubId(req))
    },
    'club.update': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as {
        name?: string
        description?: string | null
        logoUrl?: string | null
        settings?: Record<string, unknown>
      }
      return club.updateClub(deps, identity, teamClubId(req), {
        name: data.name,
        description: data.description,
        logoUrl: data.logoUrl,
        settings: data.settings,
        expectedRevision: req.request.expectedRevision as number,
        mutationId: req.request.mutationId as string,
      })
    },
    'club.dashboard': async (req) => {
      const identity = requireIdentity()
      return club.clubDashboard(deps, identity, teamClubId(req))
    },
    'profile.summary': async (req) => {
      const identity = requireIdentity()
      return club.profileSummary(deps, identity, teamClubId(req))
    },

    'command.status': async (req) => {
      const identity = requireIdentity()
      const data = req.request.data as { action: string; mutationId: string }
      return tasks.commandStatus(deps, identity, req.request.scope, {
        action: data.action,
        mutationId: data.mutationId,
      })
    },
  }
}
