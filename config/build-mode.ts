/**
 * 构建模式解析（多团队 DESIGN §4.3、M2）。
 *
 * 后端：demo（仅开发）| cloud（需 TARO_APP_CLOUD_ENV）| http（legacy/test，非本轮发布入口）。
 * 生产必须显式 cloud + 环境；缺 env / 生产 demo / 矛盾变量均 fail-fast。
 */

export interface BuildEnvironment {
  TARO_MODE?: string
  NODE_ENV?: string
  TARO_APP_DEMO?: string
  TARO_APP_API_BASE?: string
  TARO_APP_BACKEND?: string
  TARO_APP_CLOUD_ENV?: string
  TARO_APP_ID?: string
}

export type BackendKind = 'demo' | 'cloud' | 'http'

export interface BuildMode {
  development: boolean
  backend: BackendKind
  demoMode: boolean
  apiBase: string
  cloudEnv: string
  appId: string
}

const BACKENDS: readonly BackendKind[] = ['demo', 'cloud', 'http']

/** 开发联调允许的 http 主机：本机回环 + RFC1918 私网段 + CGNAT 100.64/10（Netmaker / 局域网） */
function isDevHttpAllowed(url: URL): boolean {
  if (url.protocol !== 'http:') return false
  const host = url.hostname
  if (['localhost', '127.0.0.1', '[::1]'].includes(host)) return true
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host)
}

function normalizeApiBase(raw: string | undefined, development: boolean): string {
  const apiBase = (raw || '').trim().replace(/\/+$/, '')
  if (!apiBase) return ''
  let url: URL
  try {
    url = new URL(apiBase)
  } catch {
    throw new Error('TARO_APP_API_BASE must be an absolute HTTPS URL')
  }
  if (url.protocol !== 'https:' && !(development && isDevHttpAllowed(url))) {
    throw new Error('TARO_APP_API_BASE must use HTTPS outside localhost/private development')
  }
  return apiBase
}

export function resolveBuildMode(env: BuildEnvironment): BuildMode {
  const development = (env.TARO_MODE || env.NODE_ENV) === 'development'

  const demoSetting = env.TARO_APP_DEMO?.trim().toLowerCase()
  if (demoSetting && demoSetting !== 'true' && demoSetting !== 'false') {
    throw new Error('TARO_APP_DEMO must be true or false')
  }

  const backendSetting = env.TARO_APP_BACKEND?.trim().toLowerCase()
  if (backendSetting && !BACKENDS.includes(backendSetting as BackendKind)) {
    throw new Error('TARO_APP_BACKEND must be demo, cloud or http')
  }

  // 矛盾变量：显式非 demo 后端与 TARO_APP_DEMO=true 冲突即失败。
  if (backendSetting && backendSetting !== 'demo' && demoSetting === 'true') {
    throw new Error(`TARO_APP_DEMO=true conflicts with TARO_APP_BACKEND=${backendSetting}`)
  }

  let backend: BackendKind
  if (backendSetting) {
    backend = backendSetting as BackendKind
  } else if (demoSetting === 'false') {
    // 过渡：未显式给 backend 但显式关闭 demo → 旧 http 路径。
    backend = 'http'
  } else if (development) {
    backend = 'demo'
  } else {
    throw new Error(
      '非开发构建必须显式设置 TARO_APP_BACKEND=cloud（或 http legacy）；生产禁止默认 demo'
    )
  }

  if (backend === 'demo' && !development) {
    throw new Error('TARO_APP_BACKEND=demo is only allowed in development builds')
  }

  const apiBase = normalizeApiBase(env.TARO_APP_API_BASE, development)
  const cloudEnv = (env.TARO_APP_CLOUD_ENV || '').trim()
  const appId = (env.TARO_APP_ID || '').trim()

  if (backend === 'cloud') {
    if (!cloudEnv) throw new Error('TARO_APP_BACKEND=cloud 需要 TARO_APP_CLOUD_ENV')
    if (apiBase) throw new Error('cloud 模式不使用 TARO_APP_API_BASE（矛盾变量）')
  }
  if (backend === 'demo') {
    if (apiBase) throw new Error('demo 模式不使用 TARO_APP_API_BASE（矛盾变量）')
    if (cloudEnv) throw new Error('demo 模式不使用 TARO_APP_CLOUD_ENV（矛盾变量）')
  }
  if (backend === 'http') {
    if (!apiBase) throw new Error('http 模式需要 TARO_APP_API_BASE')
    if (cloudEnv) throw new Error('http 模式不使用 TARO_APP_CLOUD_ENV（矛盾变量）')
  }

  return {
    development,
    backend,
    demoMode: backend === 'demo',
    apiBase,
    cloudEnv,
    appId,
  }
}
