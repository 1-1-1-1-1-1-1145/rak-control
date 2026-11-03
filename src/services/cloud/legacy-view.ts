import type {
  Announcement,
  ClubMember,
  InviteCode,
  JoinRequest,
  MemberPerformance,
  RoiInput,
  RoiItem,
  RoiOverview,
  Task,
} from '@/types/domain'
import type { RoiWriteInput } from './roi'
import type {
  AnnouncementView,
  JoinRequestView,
  MemberView,
  PerformanceView,
  RoiItemView,
  RoiOverviewView,
  TaskView,
} from './dto'

/**
 * cloud DTO → 页面既有 DTO 的**唯一适配层**（PLAN §M6/§M7、BASE-DESIGN §10.1）。
 *
 * - 金额：云端口径是分整数；**分→元只在此边界换算**，业务/统计逻辑不累计浮点元。
 * - 云公共 DTO 有意省略的私有字段（他人交付说明/附件/评级等）填 null，
 *   由 M5 附件与对应页面迁移补齐；此处**不伪造**任何值。
 * - 页面统一改用 cursor 后本层可逐步退出；当前用于让既有页面在 cloud 下可用。
 */

export function centsToYuan(cents: number): number {
  return cents / 100
}

/** 页面既有元 number → 云端十进制元字符串（最多 2 位小数，无千分位/科学计数）。 */
export function yuanText(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0'
  return value.toFixed(2)
}

export function toLegacyRoiItem(view: RoiItemView): RoiItem {
  return {
    id: view.roiId,
    clubId: view.clubId,
    title: view.title,
    category: view.category,
    cost: centsToYuan(view.costCents),
    revenue: centsToYuan(view.revenueCents),
    participants: view.participants,
    periodStart: view.periodStart,
    periodEnd: view.periodEnd,
    status: view.status,
    notes: view.notes,
    roiRatio: view.roiRatio,
    createdBy: view.createdByMemberId,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  }
}

export function toLegacyRoiOverview(view: RoiOverviewView): RoiOverview {
  return {
    period: view.period,
    totalCost: centsToYuan(view.totalCost),
    totalRevenue: centsToYuan(view.totalRevenue),
    net: centsToYuan(view.net),
    roiRatio: view.roiRatio,
    itemCount: view.itemCount,
    series: view.series.map((bucket) => ({
      label: bucket.label,
      cost: centsToYuan(bucket.cost),
      revenue: centsToYuan(bucket.revenue),
    })),
  }
}

export function toCloudRoiWrite(input: RoiInput): RoiWriteInput {
  return {
    title: input.title,
    category: input.category,
    cost: yuanText(input.cost),
    revenue: yuanText(input.revenue),
    participants: input.participants ?? 0,
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    status: input.status,
    notes: input.notes ?? null,
  }
}

/** 任务公共视图：私有交付字段（说明/附件/评级/驳回原因）按契约留空，待 M5/详情页迁移。 */
export function toLegacyTask(view: TaskView): Task {
  return {
    id: view.taskId,
    clubId: view.clubId,
    title: view.title,
    description: view.description,
    category: view.category as Task['category'],
    repo: view.repo,
    acceptanceCriteria: view.acceptanceCriteria,
    status: view.status,
    assigneeId: view.assigneeMemberId,
    assigneeName: view.assigneeName,
    claimedAt: view.claimedAt,
    submittedAt: view.submittedAt,
    submitNote: null,
    submissionAttachments: undefined,
    approvedAt:
      view.status === 'APPROVED' || view.status === 'DONE' ? (view.reviewedAt ?? view.updatedAt) : null,
    qualityGrade: null,
    qualityNote: null,
    rejectedAt: view.status === 'REJECTED' ? (view.reviewedAt ?? view.updatedAt) : null,
    rejectReason: null,
    reviewedByName: view.reviewedByName,
    createdBy: view.createdByMemberId,
    createdByName: view.createdByName,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    revision: view.revision,
  }
}

export function toLegacyAnnouncement(view: AnnouncementView): Announcement {
  return {
    id: view.announcementId,
    clubId: view.clubId,
    title: view.title,
    body: view.body,
    pinned: view.pinned,
    authorId: view.authorMemberId,
    authorName: view.authorDisplayName,
    status: view.status,
    publishedAt: view.publishedAt,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    revision: view.revision,
  }
}

export function toLegacyMember(clubId: string, view: MemberView): ClubMember {
  return {
    id: view.memberId,
    clubId,
    userId: view.memberId,
    clubRole: view.role,
    displayName: view.displayName,
    duty: view.duty,
    status: view.status,
    joinedAt: view.joinedAt ?? '',
    updatedAt: view.joinedAt ?? '',
    revision: view.revision,
  }
}

export function toLegacyPerformance(view: PerformanceView): MemberPerformance {
  return {
    userId: view.memberId,
    displayName: view.displayName,
    duty: view.duty,
    role: view.role,
    claimedCount: view.claimedCount,
    approvedCount: view.approvedCount,
    rejectedCount: view.rejectedCount,
    inProgressCount: view.inProgressCount,
    completionRate: view.completionRate,
    avgQualityScore: view.avgQualityScore,
    compositeScore: view.compositeScore,
  }
}

/** 邀请码最小可映射字段（list 的 InviteView 与 create 的响应共用）。 */
export interface InviteLike {
  inviteId: string
  maskedCode: string
  maxUses: number
  expiresAt: string | null
  usedCount?: number
  revokedAt?: string | null
}

/** 邀请码：明文只在**签发当次**可见；其余情况只回 masked（不伪造明文）。 */
export function toLegacyInvite(clubId: string, view: InviteLike, plaintext?: string | null): InviteCode {
  return {
    id: view.inviteId,
    clubId,
    code: plaintext ?? view.maskedCode,
    createdBy: '',
    maxUses: view.maxUses,
    usedCount: view.usedCount ?? 0,
    expiresAt: view.expiresAt,
    revokedAt: view.revokedAt ?? null,
    createdAt: '',
  }
}

/**
 * 入队申请（TEAM、manager+）。
 * 云 DTO 有意不含他人 `openid/appid/userId`：此处填 `''`/`null` 表示"未暴露"，**不是伪造**。
 */
export function toLegacyJoinRequest(clubId: string, view: JoinRequestView): JoinRequest {
  return {
    id: view.joinRequestId,
    clubId,
    applicantName: view.applicantName,
    applicantWechat: view.wechat,
    reason: view.reason,
    appid: '',
    openid: '',
    userId: null,
    status: view.status,
    reviewedBy: null,
    reviewedAt: view.reviewedAt,
    createdAt: view.createdAt,
  }
}
