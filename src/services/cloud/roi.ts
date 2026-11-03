import { getCloudClient } from '../backend'
import type { RoiItemView, RoiOverviewView, RoiPage, RoiPeriod } from './dto'

/** 本队 ROI（多团队 DESIGN §M6、BASE-DESIGN §10.1）。金额以元字符串提交，云端回分整数。 */

export interface RoiWriteInput {
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

export function cloudRoiList(
  clubId: string,
  opts: { status?: string; category?: string; keyword?: string; cursor?: string; pageSize?: number } = {}
): Promise<RoiPage> {
  return getCloudClient().call<RoiPage>('rakApi', 'roi.list', { kind: 'TEAM', clubId }, opts)
}

export function cloudRoiGet(clubId: string, roiId: string): Promise<RoiItemView> {
  return getCloudClient().call<RoiItemView>('rakApi', 'roi.get', { kind: 'TEAM', clubId }, { roiId })
}

export function cloudRoiCreate(clubId: string, input: RoiWriteInput, mutationId: string): Promise<RoiItemView> {
  return getCloudClient().call<RoiItemView>(
    'rakApi',
    'roi.create',
    { kind: 'TEAM', clubId },
    { ...input },
    { mutationId }
  )
}

export function cloudRoiUpdate(
  clubId: string,
  input: RoiWriteInput & { roiId: string; expectedRevision: number; mutationId: string }
): Promise<RoiItemView> {
  return getCloudClient().call<RoiItemView>(
    'rakApi',
    'roi.update',
    { kind: 'TEAM', clubId },
    {
      roiId: input.roiId,
      title: input.title,
      category: input.category,
      cost: input.cost,
      revenue: input.revenue,
      participants: input.participants,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: input.status,
      notes: input.notes,
    },
    { mutationId: input.mutationId, expectedRevision: input.expectedRevision }
  )
}

export function cloudRoiDelete(clubId: string, input: { roiId: string; mutationId: string }): Promise<RoiItemView> {
  return getCloudClient().call<RoiItemView>(
    'rakApi',
    'roi.delete',
    { kind: 'TEAM', clubId },
    { roiId: input.roiId },
    { mutationId: input.mutationId }
  )
}

export function cloudRoiOverview(clubId: string, period: RoiPeriod = 'month'): Promise<RoiOverviewView> {
  return getCloudClient().call<RoiOverviewView>('rakApi', 'roi.overview', { kind: 'TEAM', clubId }, { period })
}
