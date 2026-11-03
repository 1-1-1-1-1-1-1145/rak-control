import type { ClubRole } from '@/types/domain'

export function canManage(role?: ClubRole | null): boolean {
  return role === 'manager' || role === 'super_admin'
}

export function isSuper(role?: ClubRole | null): boolean {
  return role === 'super_admin'
}

export function roleLabel(role?: ClubRole | null): string {
  switch (role) {
    case 'super_admin':
      return '超级管理员'
    case 'manager':
      return '管理层'
    case 'member':
      return '成员'
    default:
      return '未入驻'
  }
}
