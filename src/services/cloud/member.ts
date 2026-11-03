import { getCloudClient } from '../backend'
import type { MemberPage, MemberView } from './dto'

/** 成员列表与任免（多团队 DESIGN §6.2）。 */

export function cloudMemberList(
  clubId: string,
  opts: { cursor?: string; pageSize?: number } = {}
): Promise<MemberPage> {
  return getCloudClient().call<MemberPage>('rakApi', 'member.list', { kind: 'TEAM', clubId }, opts)
}

export function cloudMemberSetRole(
  clubId: string,
  input: { targetMemberId: string; targetRole: 'member' | 'manager' | 'super_admin'; expectedRevision: number; mutationId: string }
): Promise<MemberView> {
  return getCloudClient().call<MemberView>(
    'rakApi',
    'member.setRole',
    { kind: 'TEAM', clubId },
    { targetMemberId: input.targetMemberId, targetRole: input.targetRole },
    { mutationId: input.mutationId, expectedRevision: input.expectedRevision }
  )
}

export function cloudMemberSetStatus(
  clubId: string,
  input: { targetMemberId: string; targetStatus: 'ACTIVE' | 'DISABLED'; expectedRevision: number; mutationId: string }
): Promise<MemberView> {
  return getCloudClient().call<MemberView>(
    'rakApi',
    'member.setStatus',
    { kind: 'TEAM', clubId },
    { targetMemberId: input.targetMemberId, targetStatus: input.targetStatus },
    { mutationId: input.mutationId, expectedRevision: input.expectedRevision }
  )
}

export function cloudMemberUpdateMyProfile(
  clubId: string,
  input: { displayName: string; duty?: string | null; expectedRevision: number; mutationId: string }
): Promise<MemberView> {
  const data: Record<string, unknown> = { displayName: input.displayName }
  if (input.duty !== undefined) data.duty = input.duty
  return getCloudClient().call<MemberView>('rakApi', 'member.updateMyProfile', { kind: 'TEAM', clubId }, data, {
    mutationId: input.mutationId,
    expectedRevision: input.expectedRevision,
  })
}

export function cloudMemberUpdateProfile(
  clubId: string,
  input: {
    targetMemberId: string
    displayName?: string
    duty?: string | null
    expectedRevision: number
    mutationId: string
  }
): Promise<MemberView> {
  const data: Record<string, unknown> = { targetMemberId: input.targetMemberId }
  if (input.displayName !== undefined) data.displayName = input.displayName
  if (input.duty !== undefined) data.duty = input.duty
  return getCloudClient().call<MemberView>('rakApi', 'member.updateProfile', { kind: 'TEAM', clubId }, data, {
    mutationId: input.mutationId,
    expectedRevision: input.expectedRevision,
  })
}
