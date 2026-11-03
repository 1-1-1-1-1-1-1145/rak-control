import { getCloudClient } from '../backend'
import type { RequestScope } from './client'
import type { CommandStatusResponse, SubmissionView, TaskPage, TaskView } from './dto'

/** 本队任务与交付（多团队 DESIGN §9.1、§M4）。 */

export function cloudTaskList(
  clubId: string,
  opts: {
    status?: string[]
    category?: string
    keyword?: string
    assigneeMemberId?: string
    cursor?: string
    pageSize?: number
  } = {}
): Promise<TaskPage> {
  return getCloudClient().call<TaskPage>('rakApi', 'task.list', { kind: 'TEAM', clubId }, opts)
}

export function cloudTaskGet(clubId: string, taskId: string): Promise<TaskView> {
  return getCloudClient().call<TaskView>('rakApi', 'task.get', { kind: 'TEAM', clubId }, { taskId })
}

export function cloudTaskCreate(
  clubId: string,
  input: {
    title: string
    description: string
    category: string
    repo?: string | null
    acceptanceCriteria?: string | null
  },
  mutationId: string
): Promise<TaskView> {
  return getCloudClient().call<TaskView>('rakApi', 'task.create', { kind: 'TEAM', clubId }, { ...input }, { mutationId })
}

export function cloudTaskUpdate(
  clubId: string,
  input: {
    taskId: string
    title?: string
    description?: string
    category?: string
    repo?: string | null
    acceptanceCriteria?: string | null
    expectedRevision: number
    mutationId: string
  }
): Promise<TaskView> {
  return getCloudClient().call<TaskView>(
    'rakApi',
    'task.update',
    { kind: 'TEAM', clubId },
    {
      taskId: input.taskId,
      title: input.title,
      description: input.description,
      category: input.category,
      repo: input.repo,
      acceptanceCriteria: input.acceptanceCriteria,
    },
    { mutationId: input.mutationId, expectedRevision: input.expectedRevision }
  )
}

export function cloudTaskClaim(
  clubId: string,
  input: { taskId: string; expectedRevision: number; mutationId: string }
): Promise<TaskView> {
  return getCloudClient().call<TaskView>(
    'rakApi',
    'task.claim',
    { kind: 'TEAM', clubId },
    { taskId: input.taskId },
    { mutationId: input.mutationId, expectedRevision: input.expectedRevision }
  )
}

export function cloudTaskSubmit(
  clubId: string,
  input: {
    taskId: string
    note: string
    attachmentIds?: string[]
    targetRound?: number
    expectedRevision: number
    mutationId: string
  }
): Promise<{ task: TaskView; submission: SubmissionView }> {
  return getCloudClient().call<{ task: TaskView; submission: SubmissionView }>(
    'rakApi',
    'task.submit',
    { kind: 'TEAM', clubId },
    {
      taskId: input.taskId,
      note: input.note,
      attachmentIds: input.attachmentIds ?? [],
      targetRound: input.targetRound,
    },
    { mutationId: input.mutationId, expectedRevision: input.expectedRevision }
  )
}

export function cloudTaskApprove(
  clubId: string,
  input: {
    taskId: string
    submissionId: string
    grade: string
    note?: string
    expectedRevision: number
    mutationId: string
  }
): Promise<{ task: TaskView; submission: SubmissionView }> {
  return getCloudClient().call<{ task: TaskView; submission: SubmissionView }>(
    'rakApi',
    'task.approve',
    { kind: 'TEAM', clubId },
    { taskId: input.taskId, submissionId: input.submissionId, grade: input.grade, note: input.note },
    { mutationId: input.mutationId, expectedRevision: input.expectedRevision }
  )
}

export function cloudTaskReject(
  clubId: string,
  input: { taskId: string; submissionId: string; reason: string; expectedRevision: number; mutationId: string }
): Promise<{ task: TaskView; submission: SubmissionView }> {
  return getCloudClient().call<{ task: TaskView; submission: SubmissionView }>(
    'rakApi',
    'task.reject',
    { kind: 'TEAM', clubId },
    { taskId: input.taskId, submissionId: input.submissionId, reason: input.reason },
    { mutationId: input.mutationId, expectedRevision: input.expectedRevision }
  )
}

export function cloudTaskArchive(
  clubId: string,
  input: { taskId: string; expectedRevision: number; mutationId: string }
): Promise<TaskView> {
  return getCloudClient().call<TaskView>(
    'rakApi',
    'task.archive',
    { kind: 'TEAM', clubId },
    { taskId: input.taskId },
    { mutationId: input.mutationId, expectedRevision: input.expectedRevision }
  )
}

export function cloudSubmissionList(clubId: string, taskId: string): Promise<SubmissionView[]> {
  return getCloudClient().call<SubmissionView[]>('rakApi', 'submission.list', { kind: 'TEAM', clubId }, { taskId })
}

export function cloudSubmissionGet(clubId: string, submissionId: string): Promise<SubmissionView> {
  return getCloudClient().call<SubmissionView>('rakApi', 'submission.get', { kind: 'TEAM', clubId }, { submissionId })
}

/** command.status 必须与原命令 scope 完全一致（GLOBAL 或 TEAM）。 */
export function cloudCommandStatus(
  scope: RequestScope,
  input: { action: string; mutationId: string }
): Promise<CommandStatusResponse> {
  return getCloudClient().call<CommandStatusResponse>('rakApi', 'command.status', scope, {
    action: input.action,
    mutationId: input.mutationId,
  })
}
