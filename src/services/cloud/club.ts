import { getCloudClient } from '../backend'
import type {
  AnnouncementPage,
  AnnouncementView,
  CloudClubDashboardView,
  CloudClubView,
  CloudProfileSummaryView,
} from './dto'

/** 本队社团设置、公告与显式摘要（多团队 DESIGN §M6、BASE-DESIGN §9.2/§10.3）。 */

export function cloudClubGet(clubId: string): Promise<CloudClubView> {
  return getCloudClient().call<CloudClubView>('rakApi', 'club.get', { kind: 'TEAM', clubId }, {})
}

export function cloudClubUpdate(
  clubId: string,
  input: {
    name?: string
    description?: string | null
    logoUrl?: string | null
    settings?: Record<string, unknown>
    expectedRevision: number
    mutationId: string
  }
): Promise<CloudClubView> {
  return getCloudClient().call<CloudClubView>(
    'rakApi',
    'club.update',
    { kind: 'TEAM', clubId },
    {
      name: input.name,
      description: input.description,
      logoUrl: input.logoUrl,
      settings: input.settings,
    },
    { mutationId: input.mutationId, expectedRevision: input.expectedRevision }
  )
}

export function cloudClubDashboard(clubId: string): Promise<CloudClubDashboardView> {
  return getCloudClient().call<CloudClubDashboardView>('rakApi', 'club.dashboard', { kind: 'TEAM', clubId }, {})
}

export function cloudProfileSummary(clubId: string): Promise<CloudProfileSummaryView> {
  return getCloudClient().call<CloudProfileSummaryView>('rakApi', 'profile.summary', { kind: 'TEAM', clubId }, {})
}

export function cloudAnnouncementList(
  clubId: string,
  opts: { status?: string; cursor?: string; pageSize?: number } = {}
): Promise<AnnouncementPage> {
  return getCloudClient().call<AnnouncementPage>('rakApi', 'announcement.list', { kind: 'TEAM', clubId }, opts)
}

export function cloudAnnouncementGet(clubId: string, announcementId: string): Promise<AnnouncementView> {
  return getCloudClient().call<AnnouncementView>(
    'rakApi',
    'announcement.get',
    { kind: 'TEAM', clubId },
    { announcementId }
  )
}

export function cloudAnnouncementCreate(
  clubId: string,
  input: { title: string; body: string; pinned?: boolean },
  mutationId: string
): Promise<AnnouncementView> {
  return getCloudClient().call<AnnouncementView>(
    'rakApi',
    'announcement.create',
    { kind: 'TEAM', clubId },
    { ...input },
    { mutationId }
  )
}

export function cloudAnnouncementUpdate(
  clubId: string,
  input: { announcementId: string; title?: string; body?: string; pinned?: boolean; expectedRevision: number; mutationId: string }
): Promise<AnnouncementView> {
  return getCloudClient().call<AnnouncementView>(
    'rakApi',
    'announcement.update',
    { kind: 'TEAM', clubId },
    {
      announcementId: input.announcementId,
      title: input.title,
      body: input.body,
      pinned: input.pinned,
    },
    { mutationId: input.mutationId, expectedRevision: input.expectedRevision }
  )
}

function announcementTransition(
  action: 'announcement.publish' | 'announcement.archive',
  clubId: string,
  input: { announcementId: string; expectedRevision: number; mutationId: string }
): Promise<AnnouncementView> {
  return getCloudClient().call<AnnouncementView>(
    'rakApi',
    action,
    { kind: 'TEAM', clubId },
    { announcementId: input.announcementId },
    { mutationId: input.mutationId, expectedRevision: input.expectedRevision }
  )
}

export function cloudAnnouncementPublish(
  clubId: string,
  input: { announcementId: string; expectedRevision: number; mutationId: string }
): Promise<AnnouncementView> {
  return announcementTransition('announcement.publish', clubId, input)
}

export function cloudAnnouncementArchive(
  clubId: string,
  input: { announcementId: string; expectedRevision: number; mutationId: string }
): Promise<AnnouncementView> {
  return announcementTransition('announcement.archive', clubId, input)
}
