export {
  MAX_TASK_ATTACHMENTS,
  MAX_TASK_ATTACHMENT_SIZE,
  validateTaskAttachment,
  validateTaskAttachments,
} from './task-attachment-policy'

export function isTaskImageAttachment(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(name)
}

export function isTaskVideoAttachment(name: string): boolean {
  return /\.(mp4|mov|m4v|3gp|avi|mkv|webm)$/i.test(name)
}

export function isTaskDocumentAttachment(name: string): boolean {
  return /\.(pdf|docx?|xlsx?|pptx?)$/i.test(name)
}

export function formatTaskAttachmentSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
