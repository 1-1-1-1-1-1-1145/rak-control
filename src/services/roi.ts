import { CLUB_API_BASE, DEMO_MODE } from '@/constants'
import { qs } from '@/utils/request'
import { currentClubId } from '@/services/context'
import { getDemoServicesLazy } from '@/demo/loader'
import { requestForBackend } from './backend'
import { createRoiService } from './domain-entry'

const base = () => `${CLUB_API_BASE}/${currentClubId()}`

const roiService = createRoiService({
  demoMode: DEMO_MODE,
  demo: () => getDemoServicesLazy().roi,
  request: requestForBackend,
  clubBase: base,
  query: qs,
})

export const {
  fetchRoiItems,
  fetchRoiItem,
  fetchRoiOverview,
  createRoiItem,
  updateRoiItem,
  deleteRoiItem,
} = roiService
