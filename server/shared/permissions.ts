import type { ClubRole } from '../contracts/dtos.ts'

/**
 * 角色 → 能力（多团队 DESIGN §6.2/§7.4、BASE-DESIGN §5.3）。
 * permissions 仅供 UI 渲染提示；服务端始终按角色与资源关系重新鉴权。
 */
const MEMBER: readonly string[] = [
  'club.read',
  'task.read',
  'task.claim',
  'task.submit',
  'submission.read.own',
  'roi.read',
  'announcement.read',
  'performance.mine',
  'profile.read',
  'file.upload',
  'file.download.own',
]

const MANAGER: readonly string[] = [
  ...MEMBER,
  'task.manage',
  'task.review',
  'submission.read.all',
  'announcement.manage',
  'roi.manage',
  'member.manage',
  'invite.manage',
  'join.review',
  'file.download.all',
  'performance.list',
  'dashboard.manage',
]

const SUPER_ADMIN: readonly string[] = [
  ...MANAGER,
  'member.setRole',
  'club.manage',
]

export const ROLE_PERMISSIONS: Record<ClubRole, readonly string[]> = {
  member: MEMBER,
  manager: MANAGER,
  super_admin: SUPER_ADMIN,
}

export function permissionsFor(role: ClubRole): string[] {
  return [...ROLE_PERMISSIONS[role]]
}
