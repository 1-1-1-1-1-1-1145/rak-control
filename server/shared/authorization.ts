import { AppError } from '../contracts/errors.ts'
import type { ClubRole } from '../contracts/dtos.ts'
import { isManagerPlus, isOwner, type TenantContext } from './tenant-context.ts'

/**
 * 权限矩阵基元（多团队 DESIGN §6.2/§7.4、BASE-DESIGN §5.3）。
 *
 * 说明：本文件只提供**角色谓词与强制检查**；每个 action → 具体资源关系/目标约束的
 * 完整接线在 M3–M6 各模块实现，避免在此处臆造未验证的完整矩阵。
 * 服务端始终是最终权限边界，UI 隐藏按钮不构成授权。
 */

export function requireManagerPlus(ctx: TenantContext): void {
  if (!isManagerPlus(ctx.role)) throw new AppError('permission_denied')
}

export function requireOwner(ctx: TenantContext): void {
  if (!isOwner(ctx.role)) throw new AppError('permission_denied')
}

/** manager 只能管理普通 member；owner 可管理 manager/member；任何接口不能处置 owner。 */
export function requireCanManageTarget(
  ctx: TenantContext,
  target: { role: ClubRole; isOwner: boolean },
  actorIsPrimaryOwner: boolean
): void {
  if (target.isOwner) throw new AppError('permission_denied', '不能通过业务接口修改 owner')
  // 普通 super_admin 可管理 manager/member，但只有首位 owner 可管理其他 super_admin。
  if (target.role === 'super_admin' && !actorIsPrimaryOwner) {
    throw new AppError('permission_denied', '仅首位超级管理员可管理其他超级管理员')
  }
  if (actorIsPrimaryOwner) return
  if (ctx.role === 'super_admin') return
  if (ctx.role === 'manager' && target.role === 'member') return
  throw new AppError('permission_denied')
}

/** 任免（setRole）仅 owner（super_admin），且不能作用于 owner 自身。 */
export function requireCanSetRole(ctx: TenantContext): void {
  requireOwner(ctx)
}

/** 成员状态（setStatus）manager 仅 member，owner 可 manager/member，均不可处置 owner。 */
export function requireCanSetStatus(ctx: TenantContext, targetIsOwner: boolean): void {
  if (targetIsOwner) throw new AppError('permission_denied', '不能通过业务接口处置 owner')
  requireManagerPlus(ctx)
}
