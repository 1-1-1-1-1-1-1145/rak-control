import { AppError } from '../contracts/errors.ts'

/**
 * 游标契约（多团队 DESIGN §10.3、BASE-DESIGN §10.3）。
 *
 * cursor 绑定 action/clubId/查询指纹/排序值；A cursor 给 B 必须拒绝
 * cursor_scope_mismatch，不能重置后偷偷返回 B 第一页。
 * 账户级列表（team.listMine/join.mine）绑定 account（clubId 记为 null）。
 */

export interface CursorPayload {
  v: 1
  action: string
  clubId: string | null
  fingerprint: string
  sort: unknown[]
}

export interface CursorExpectation {
  action: string
  clubId: string | null
  fingerprint: string
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeCursor(raw: string, expected: CursorExpectation): CursorPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    throw new AppError('cursor_scope_mismatch')
  }
  if (typeof parsed !== 'object' || parsed === null) throw new AppError('cursor_scope_mismatch')
  const cursor = parsed as Partial<CursorPayload>
  if (
    cursor.v !== 1 ||
    cursor.action !== expected.action ||
    (cursor.clubId ?? null) !== expected.clubId ||
    cursor.fingerprint !== expected.fingerprint ||
    !Array.isArray(cursor.sort)
  ) {
    throw new AppError('cursor_scope_mismatch')
  }
  return cursor as CursorPayload
}
