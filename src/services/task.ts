import { CLUB_API_BASE, DEMO_MODE } from '@/constants'
import { qs } from '@/utils/request'
import { currentClubId } from '@/services/context'
import { getDemoServicesLazy } from '@/demo/loader'
import { requestForBackend } from './backend'

import { createTaskService } from './domain-entry'

export type { PublishTaskInput } from './domain-entry'

const base = () => `${CLUB_API_BASE}/${currentClubId()}`

const taskService = createTaskService({
  demoMode: DEMO_MODE,
  demo: () => getDemoServicesLazy().task,
  request: requestForBackend,
  clubBase: base,
  query: qs,
})

export const {
  fetchTasks,
  fetchTask,
  publishTask,
  claimTask,
  submitTask,
  approveTask,
  rejectTask,
  archiveTask,
  fetchAllMemberPerformance,
  fetchMemberPerformance,
} = taskService
