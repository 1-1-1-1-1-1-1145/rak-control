import { getCloudClient } from '../backend'
import type {
  CreateInviteResponse,
  InviteView,
  JoinMinePage,
  JoinStatusResponse,
  JoinSubmitResponse,
  JoinTargetResponse,
  RedeemResponse,
  RotateJoinLinkResponse,
  TeamListPage,
  TeamSessionView,
} from './dto'

/** 团队 / 申请入口 / 入队 / 邀请（多团队 DESIGN §6.2）。 */

export function cloudTeamListMine(
  opts: { cursor?: string; pageSize?: number } = {}
): Promise<TeamListPage> {
  return getCloudClient().call<TeamListPage>('rakApi', 'team.listMine', { kind: 'GLOBAL' }, opts)
}

/**
 * 进入团队。`switchAttemptId` 仅用于**客户端**核对本次切换尝试（服务端不据此授权），
 * 因此它是诊断字段而非归属/自报授权字段。
 */
export function cloudTeamEnter(clubId: string, switchAttemptId?: string): Promise<TeamSessionView> {
  return getCloudClient().call<TeamSessionView>(
    'rakApi',
    'team.enter',
    { kind: 'TEAM', clubId },
    switchAttemptId ? { switchAttemptId } : {}
  )
}

export function cloudResolveJoinTarget(joinKey: string): Promise<JoinTargetResponse> {
  return getCloudClient().call<JoinTargetResponse>('rakApi', 'team.resolveJoinTarget', { kind: 'GLOBAL' }, { joinKey })
}

export function cloudRotateJoinLink(clubId: string, mutationId: string): Promise<RotateJoinLinkResponse> {
  return getCloudClient().call<RotateJoinLinkResponse>(
    'rakApi',
    'team.joinLink.rotate',
    { kind: 'TEAM', clubId },
    {},
    { mutationId }
  )
}

export function cloudJoinSubmit(
  input: { joinTargetToken: string; name: string; wechat: string; reason: string },
  mutationId: string
): Promise<JoinSubmitResponse> {
  return getCloudClient().call<JoinSubmitResponse>(
    'rakApi',
    'join.submit',
    { kind: 'GLOBAL' },
    { ...input },
    { mutationId }
  )
}

export function cloudJoinStatus(joinRequestId: string): Promise<JoinStatusResponse> {
  return getCloudClient().call<JoinStatusResponse>('rakApi', 'join.status', { kind: 'GLOBAL' }, { joinRequestId })
}

/** 本人入队申请列表（GLOBAL、账户级）——用于"仅待审"落点与进度展示。 */
export function cloudJoinMine(opts: { cursor?: string; pageSize?: number } = {}): Promise<JoinMinePage> {
  return getCloudClient().call<JoinMinePage>('rakApi', 'join.mine', { kind: 'GLOBAL' }, opts)
}

export function cloudInviteList(clubId: string): Promise<InviteView[]> {
  return getCloudClient().call<InviteView[]>('rakApi', 'invite.list', { kind: 'TEAM', clubId }, {})
}

export function cloudInviteCreate(
  clubId: string,
  input: { maxUses?: number; expiresInDays?: number },
  mutationId: string
): Promise<CreateInviteResponse> {
  return getCloudClient().call<CreateInviteResponse>(
    'rakApi',
    'invite.create',
    { kind: 'TEAM', clubId },
    { ...input },
    { mutationId }
  )
}

export function cloudInviteRevoke(
  clubId: string,
  inviteId: string,
  mutationId: string
): Promise<InviteView> {
  return getCloudClient().call<InviteView>(
    'rakApi',
    'invite.revoke',
    { kind: 'TEAM', clubId },
    { inviteId },
    { mutationId }
  )
}

export function cloudInviteRedeem(
  input: { code?: string; sceneToken?: string; displayName: string },
  mutationId: string
): Promise<RedeemResponse> {
  return getCloudClient().call<RedeemResponse>('rakApi', 'invite.redeem', { kind: 'GLOBAL' }, { ...input }, { mutationId })
}
