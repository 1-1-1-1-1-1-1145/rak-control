import { getCloudClient } from '../backend'
import type {
  AdminClubSearchPage,
  ApproveDismissalResult,
  ClubDissolutionPage,
  DismissalStatus,
  DissolveClubResult,
  DissolutionStatus,
  MemberDismissalPage,
  MemberDismissalView,
} from './dto'

/**
 * 管理员/超级管理员管理动作（2026-10-18）。
 *
 * - 裁员：TEAM scope（本队）；双人双角色审批。
 * - 解散：本队直接 / 协助申请为 TEAM；超管跨队查看与处理为 GLOBAL。
 */

export function cloudRequestDismissal(
  clubId: string,
  input: { targetMemberId: string; reason: string },
  mutationId: string
): Promise<MemberDismissalView> {
  return getCloudClient().call<MemberDismissalView>(
    'rakApi',
    'member.dismissal.request',
    { kind: 'TEAM', clubId },
    { ...input },
    { mutationId }
  )
}

export function cloudListDismissals(
  clubId: string,
  opts: { status?: DismissalStatus; cursor?: string; pageSize?: number } = {}
): Promise<MemberDismissalPage> {
  return getCloudClient().call<MemberDismissalPage>(
    'rakApi',
    'member.dismissal.list',
    { kind: 'TEAM', clubId },
    opts
  )
}

export function cloudApproveDismissal(
  clubId: string,
  dismissalId: string,
  opts: { mutationId: string; expectedRevision: number }
): Promise<ApproveDismissalResult> {
  return getCloudClient().call<ApproveDismissalResult>(
    'rakApi',
    'member.dismissal.approve',
    { kind: 'TEAM', clubId },
    { dismissalId },
    { mutationId: opts.mutationId, expectedRevision: opts.expectedRevision }
  )
}

export function cloudRejectDismissal(
  clubId: string,
  input: { dismissalId: string; rejectReason: string },
  opts: { mutationId: string; expectedRevision: number }
): Promise<MemberDismissalView> {
  return getCloudClient().call<MemberDismissalView>(
    'rakApi',
    'member.dismissal.reject',
    { kind: 'TEAM', clubId },
    { ...input },
    { mutationId: opts.mutationId, expectedRevision: opts.expectedRevision }
  )
}

export function cloudDissolveClub(
  clubId: string,
  input: { reason: string },
  mutationId: string
): Promise<DissolveClubResult> {
  return getCloudClient().call<DissolveClubResult>(
    'rakApi',
    'club.dissolve',
    { kind: 'TEAM', clubId },
    { ...input },
    { mutationId }
  )
}

export function cloudRequestDissolution(
  clubId: string,
  input: { reason: string },
  mutationId: string
): Promise<ClubDissolutionPage['items'][number]> {
  return getCloudClient().call<ClubDissolutionPage['items'][number]>(
    'rakApi',
    'club.dissolution.request',
    { kind: 'TEAM', clubId },
    { ...input },
    { mutationId }
  )
}

export function cloudListDissolutions(
  opts: { status?: DissolutionStatus; cursor?: string; pageSize?: number } = {}
): Promise<ClubDissolutionPage> {
  return getCloudClient().call<ClubDissolutionPage>(
    'rakApi',
    'club.dissolution.list',
    { kind: 'GLOBAL' },
    opts
  )
}

export function cloudDecideDissolution(
  input: { clubId: string; approve: boolean; rejectReason?: string },
  opts: { mutationId: string; expectedRevision: number }
): Promise<{ clubId: string; status: DissolutionStatus; affectedMemberCount: number }> {
  return getCloudClient().call<{ clubId: string; status: DissolutionStatus; affectedMemberCount: number }>(
    'rakApi',
    'club.dissolution.decide',
    { kind: 'GLOBAL' },
    { targetClubId: input.clubId, approve: input.approve, rejectReason: input.rejectReason },
    { mutationId: opts.mutationId, expectedRevision: opts.expectedRevision }
  )
}

export function cloudSearchClubs(keyword: string): Promise<AdminClubSearchPage> {
  return getCloudClient().call<AdminClubSearchPage>(
    'rakApi',
    'club.searchForAdmin',
    { kind: 'GLOBAL' },
    { keyword }
  )
}

export function cloudDissolveAnyClub(
  input: { clubId: string; reason: string },
  mutationId: string
): Promise<DissolveClubResult> {
  return getCloudClient().call<DissolveClubResult>(
    'rakApi',
    'club.dissolveAny',
    { kind: 'GLOBAL' },
    { targetClubId: input.clubId, reason: input.reason },
    { mutationId }
  )
}
