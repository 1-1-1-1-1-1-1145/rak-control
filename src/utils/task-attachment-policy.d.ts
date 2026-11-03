export interface TaskAttachmentInput {
  name: string
  size: number
}

export const MAX_TASK_ATTACHMENTS: number
export const MAX_TASK_ATTACHMENT_SIZE: number
export function validateTaskAttachment(name: string, size: number): string | null
export function validateTaskAttachments(attachments: TaskAttachmentInput[]): string | null
