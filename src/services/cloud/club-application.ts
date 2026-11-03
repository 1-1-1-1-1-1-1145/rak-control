import { getCloudClient } from '../backend'
import type {
  DecideNewTeamApplicationResult,
  NewTeamApplicationPage,
  NewTeamApplicationStatus,
  SubmitNewTeamApplicationResult,
} from './dto'

/**
 * 小程序内「开通新团队」（2026-10-18）。
 *
 * - `submit` / `list` / `approve` / `reject` 都用 **TEAM scope**：clubId = 审批团队（当前所在队）；
 * - `mine` 是账户级只读（跨队查看自己的申请）；
 * - 服务端是最终权限边界：UI 隐藏按钮不构成授权。
 */

export function cloudSubmitNewTeamApplication(
  approvalClubId: string,
  input: { name: string; slug: string; displayCode: string; description?: string | null }
): Promise<SubmitNewTeamApplicationResult> {
  return getCloudClient().call<SubmitNewTeamApplicationResult>(
    'rakApi',
    'team.newApplication.submit',
    { kind: 'TEAM', clubId: approvalClubId },
    { ...input }
  )
}

export function cloudMyNewTeamApplications(
  opts: { cursor?: string; pageSize?: number } = {}
): Promise<NewTeamApplicationPage> {
  return getCloudClient().call<NewTeamApplicationPage>(
    'rakApi',
    'team.newApplication.mine',
    { kind: 'GLOBAL' },
    opts
  )
}

export function cloudListNewTeamApplications(
  approvalClubId: string,
  opts: { status?: NewTeamApplicationStatus; cursor?: string; pageSize?: number } = {}
): Promise<NewTeamApplicationPage> {
  return getCloudClient().call<NewTeamApplicationPage>(
    'rakApi',
    'team.newApplication.list',
    { kind: 'TEAM', clubId: approvalClubId },
    opts
  )
}

export function cloudApproveNewTeamApplication(
  approvalClubId: string,
  applicationId: string,
  opts: { mutationId: string; expectedRevision: number }
): Promise<DecideNewTeamApplicationResult> {
  return getCloudClient().call<DecideNewTeamApplicationResult>(
    'rakApi',
    'team.newApplication.approve',
    { kind: 'TEAM', clubId: approvalClubId },
    { applicationId },
    { mutationId: opts.mutationId, expectedRevision: opts.expectedRevision }
  )
}

export function cloudRejectNewTeamApplication(
  approvalClubId: string,
  input: { applicationId: string; rejectReason: string },
  opts: { mutationId: string; expectedRevision: number }
): Promise<DecideNewTeamApplicationResult> {
  return getCloudClient().call<DecideNewTeamApplicationResult>(
    'rakApi',
    'team.newApplication.reject',
    { kind: 'TEAM', clubId: approvalClubId },
    { ...input },
    { mutationId: opts.mutationId, expectedRevision: opts.expectedRevision }
  )
}
