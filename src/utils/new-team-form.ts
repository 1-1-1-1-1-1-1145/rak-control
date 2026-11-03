/**
 * 开通新团队表单校验（前端；与服务端 `modules/clubApplications` 同规则）。
 *
 * 服务端始终是最终校验方；这里只做即时反馈，避免明显无效的请求。
 * 校验规则（两端口径一致）：
 * - 团队名称：2..40 字（去首尾空白，禁控制字符）
 * - 团队标识 slug：小写字母/数字/短横线，3..32 位，首尾不能是短横线
 * - 展示码：大写字母/数字，4..8 位
 * - 简介：可选，0..200 字
 */

export const NEW_TEAM_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/
export const NEW_TEAM_CODE_RE = /^[A-Z0-9]{4,8}$/
const CONTROL_SINGLE = /[\u0000-\u001F\u007F]/u
/** 多行字段允许 LF（0x0A），拒绝其余控制字符。 */
const CONTROL_MULTI = /[\u0000-\u0009\u000B-\u001F\u007F]/u

export interface NewTeamFormInput {
  name: string
  slug: string
  displayCode: string
  description?: string
}

export interface NormalizedNewTeamForm {
  name: string
  slug: string
  displayCode: string
  description: string | null
}

export type NewTeamFormResult =
  | { ok: true; value: NormalizedNewTeamForm }
  | { ok: false; message: string }

export function normalizeNewTeamForm(input: NewTeamFormInput): NewTeamFormResult {
  const name = String(input.name ?? '').trim()
  if (CONTROL_SINGLE.test(name)) return { ok: false, message: '团队名称不能包含控制字符' }
  if ([...name].length < 2 || [...name].length > 40) {
    return { ok: false, message: '团队名称需为 2..40 字' }
  }

  const slug = String(input.slug ?? '').trim().toLowerCase()
  if (!NEW_TEAM_SLUG_RE.test(slug)) {
    return { ok: false, message: '团队标识只能包含小写字母、数字与短横线（3..32 位，首尾非短横线）' }
  }

  const displayCode = String(input.displayCode ?? '').trim().toUpperCase()
  if (!NEW_TEAM_CODE_RE.test(displayCode)) {
    return { ok: false, message: '展示码只能包含大写字母与数字（4..8 位）' }
  }

  const rawDescription = String(input.description ?? '').replace(/\r\n|\r/g, '\n').trim()
  if (CONTROL_MULTI.test(rawDescription)) return { ok: false, message: '简介不能包含控制字符（换行除外）' }
  if ([...rawDescription].length > 200) return { ok: false, message: '简介不能超过 200 字' }

  return {
    ok: true,
    value: {
      name,
      slug,
      displayCode,
      description: rawDescription.length > 0 ? rawDescription : null,
    },
  }
}
