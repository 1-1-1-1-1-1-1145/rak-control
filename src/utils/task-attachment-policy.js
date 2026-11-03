export const MAX_TASK_ATTACHMENTS = 3
export const MAX_TASK_ATTACHMENT_SIZE = 10 * 1024 * 1024

export function validateTaskAttachment(name, size) {
  if (!name.trim()) return '文件名称无效'
  if (!Number.isFinite(size) || size <= 0) return '文件为空或大小无效，无法添加'
  if (size > MAX_TASK_ATTACHMENT_SIZE) return '单个附件不能超过 10 MB'
  return null
}

export function validateTaskAttachments(attachments) {
  if (attachments.length > MAX_TASK_ATTACHMENTS) return `最多添加 ${MAX_TASK_ATTACHMENTS} 个附件`
  for (const attachment of attachments) {
    const error = validateTaskAttachment(attachment.name, attachment.size)
    if (error) return error
  }
  return null
}
