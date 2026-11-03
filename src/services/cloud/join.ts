import { getCloudClient } from '../backend'
import type {
  JoinRequestPage,
  JoinRequestRejectResponse,
  JoinRequestResolveResponse,
  JoinRequestView,
} from './dto'

/** 本队入队申请审批（多团队 DESIGN §6.2、§M3/M7；TEAM、manager+）。 */

export function cloudJoinList(
  clubId: string,
  opts: { status?: JoinRequestView['status']; cursor?: string; pageSize?: number } = {}
): Promise<JoinRequestPage> {
  return getCloudClient().call<JoinRequestPage>('rakApi', 'join.list', { kind: 'TEAM', clubId }, opts)
}

export function cloudJoinApprove(
  clubId: string,
  input: { joinRequestId: string; mutationId: string }
): Promise<JoinRequestResolveResponse> {
  return getCloudClient().call<JoinRequestResolveResponse>(
    'rakApi',
    'join.approve',
    { kind: 'TEAM', clubId },
    { joinRequestId: input.joinRequestId },
    { mutationId: input.mutationId }
  )
}

export function cloudJoinReject(
  clubId: string,
  input: { joinRequestId: string; rejectReason: string; mutationId: string }
): Promise<JoinRequestRejectResponse> {
  return getCloudClient().call<JoinRequestRejectResponse>(
    'rakApi',
    'join.reject',
    { kind: 'TEAM', clubId },
    { joinRequestId: input.joinRequestId, rejectReason: input.rejectReason },
    { mutationId: input.mutationId }
  )
}
