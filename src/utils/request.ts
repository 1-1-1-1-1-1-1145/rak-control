import Taro from '@tarojs/taro'
import { API_BASE, ROUTES, WECHAT_UI_BASE } from '@/constants'
import type { ProblemDetail } from '@/types/domain'
import { normalizeLoginOutcome } from './auth-contract.js'

export interface ApiErrorShape {
  status: number
  code: string
  detail: string
}

export class ApiError extends Error {
  status: number
  code: string
  detail: string

  constructor(shape: ApiErrorShape) {
    super(shape.detail || shape.code)
    this.status = shape.status
    this.code = shape.code
    this.detail = shape.detail
  }

  /** 契约错误码 → 用户可读文案（API.md §2.1；detail 兜底） */
  get userMessage(): string {
    return CODE_MESSAGES[this.code] || this.detail || '操作失败，请稍后重试'
  }
}

const CODE_MESSAGES: Record<string, string> = {
  invalid_token: '登录已过期，请重试',
  forbidden: '没有权限执行此操作',
  wechat_code_invalid: '微信登录凭证无效，请重试',
  wechat_disabled: '登录服务暂未启用',
  invite_invalid: '邀请码无效，请核对后重试',
  invite_revoked: '邀请码已作废，请联系管理员',
  invite_expired: '邀请码已过期，请联系管理员',
  invite_exhausted: '邀请码次数已用尽，请联系管理员',
  already_bound: '该微信已入驻，请直接登录',
  join_request_pending: '已有待审批的申请，请耐心等待',
  task_invalid_transition: '任务当前状态不允许此操作',
  task_not_claimable: '任务已被他人认领',
  task_not_yours: '只能操作本人认领的任务',
  roi_invalid_amount: '金额必须为非负数',
  network_error: '网络异常，请稍后重试',
  internal_error: '服务开小差了，请稍后重试',
}

export function readToken(): string {
  return Taro.getStorageSync(STORAGE_TOKEN_KEY) || ''
}

const STORAGE_TOKEN_KEY = 'rak-control:v2:access_token'

export function setToken(token: string) {
  if (token) Taro.setStorageSync(STORAGE_TOKEN_KEY, token)
  else Taro.removeStorageSync(STORAGE_TOKEN_KEY)
}

let redirecting = false

async function recoverSession() {
  setToken('')
  if (redirecting) return
  redirecting = true
  try {
    await Taro.reLaunch({ url: ROUTES.login })
  } finally {
    redirecting = false
  }
}

/**
 * 401 静默续登（设计 §3）：重走 Taro.login → miniprogram/login，成功即换新 token。
 * 单飞（single-flight）：并发 401 共享同一次续登。失败回登录页。
 * 用裸 Taro.request 实现，避免与 request() 互相递归。
 */
let reloginPromise: Promise<boolean> | null = null

export function silentRelogin(): Promise<boolean> {
  if (!reloginPromise) {
    reloginPromise = (async () => {
      try {
        const { code } = await Taro.login()
        const res = await Taro.request<ProblemDetail>({
          url: `${API_BASE}${WECHAT_UI_BASE}/login`,
          method: 'POST',
          data: { code },
          header: { 'Content-Type': 'application/json' },
          timeout: 15000,
        })
        const outcome = normalizeLoginOutcome(res.data)
        if (res.statusCode === 200 && outcome.bound && outcome.accessToken) {
          setToken(outcome.accessToken)
          return true
        }
        return false
      } catch {
        return false
      }
    })().finally(() => {
      reloginPromise = null
    })
  }
  return reloginPromise
}

export interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  data?: Record<string, unknown>
  auth?: boolean
  /** 内部字段：重放标记 */
  _retried?: boolean
}

/** 唯一 HTTP 出口：Bearer JWT · RFC7807 code · 401 静默续登后重放一次 */
export async function request<T>(options: RequestOptions): Promise<T> {
  const { url, method = 'GET', data, auth = true } = options
  const header: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (auth) {
    const token = readToken()
    if (token) header.Authorization = `Bearer ${token}`
  }

  try {
    const res = await Taro.request<T & ProblemDetail>({
      url: url.startsWith('http') ? url : `${API_BASE}${url}`,
      method,
      data,
      header,
      timeout: 15000,
    })
    const status = res.statusCode
    if (status >= 200 && status < 300) return res.data as T

    const body = (res.data || {}) as ProblemDetail
    const code = String(body.code || 'internal_error')
    const detail = String(body.detail || '请求失败')
    const err = new ApiError({ status, code, detail })

    if (status === 401 && auth && !options._retried) {
      const refreshed = await silentRelogin()
      if (refreshed) {
        return request<T>({ ...options, _retried: true })
      }
      await recoverSession()
      throw err
    }
    if (status === 403 && auth && !options._retried && !readToken()) {
      // 本地无 token 却调了鉴权端点：冷启动竞态，补一次静默登录
      const refreshed = await silentRelogin()
      if (refreshed) return request<T>({ ...options, _retried: true })
    }
    throw err
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError({
      status: 0,
      code: 'network_error',
      detail: '网络异常，请稍后重试',
    })
  }
}

/** GET query 拼装（跳过 undefined/空串） */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  return parts.length ? `?${parts.join('&')}` : ''
}
