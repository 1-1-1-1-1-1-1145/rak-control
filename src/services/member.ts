import { CLUB_API_BASE, DEMO_MODE } from '@/constants'
import { requestForBackend } from './backend'
import { currentClubId } from '@/services/context'
import type { ClubMember, ClubRole, JoinRequest } from '@/types/domain'
import { getDemoServicesLazy } from '@/demo/loader'

const base = () => `${CLUB_API_BASE}/${currentClubId()}`

/** 成员目录（API.md §7.5；全员可读，受 settings.memberDirectoryVisible） */
export async function fetchMembers(): Promise<ClubMember[]> {
  if (DEMO_MODE) return getDemoServicesLazy().member.fetchMembers()
  return requestForBackend<ClubMember[]>({ url: `${base()}/members` })
}

export const setMemberStatus = (userId: string, status: string) => DEMO_MODE
  ? getDemoServicesLazy().member.setMemberStatus(userId, status)
  : requestForBackend<ClubMember>({
      url: `${base()}/members/${userId}`,
      method: 'PATCH',
      data: { status },
    })

/** 任免（仅 super_admin，§7.5） */
export const setMemberRole = (userId: string, clubRole: ClubRole) => DEMO_MODE
  ? getDemoServicesLazy().member.setMemberRole(userId, clubRole)
  : requestForBackend<ClubMember>({
      url: `${base()}/members/${userId}/role`,
      method: 'PUT',
      data: { clubRole },
    })

/** 入队申请（manager+，§7.5） */
export async function fetchJoinRequests(
  status?: 'PENDING' | 'APPROVED' | 'REJECTED'
): Promise<JoinRequest[]> {
  if (DEMO_MODE) return getDemoServicesLazy().member.fetchJoinRequests(status)
  return requestForBackend<JoinRequest[]>({
    url: `${base()}/join-requests${status ? `?status=${status}` : ''}`,
  })
}

export const approveJoinRequest = (id: string) => DEMO_MODE
  ? getDemoServicesLazy().member.approveJoinRequest(id)
  : requestForBackend<JoinRequest>({
      url: `${base()}/join-requests/${id}/approve`,
      method: 'POST',
    })

export const rejectJoinRequest = (id: string) => DEMO_MODE
  ? getDemoServicesLazy().member.rejectJoinRequest(id)
  : requestForBackend<JoinRequest>({
      url: `${base()}/join-requests/${id}/reject`,
      method: 'POST',
    })
