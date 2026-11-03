/**
 * 分环境/账户/团队的缓存命名空间（多团队 DESIGN §10.1、M2）。
 *
 * 首版**不持久化**业务列表/权限；任何允许保存的敏感本地索引必须包含
 * backend+env+appId+accountKey+clubId+memberId+resourceKind+resourceId 与 schemaVersion。
 * URL 缓存需含实际 expiresAt。
 */

export interface CacheScope {
  backend: string
  env: string
  appId: string
  accountKey: string
  clubId?: string | null
  memberId?: string | null
  resourceKind: string
  resourceId?: string | null
  schemaVersion: number
}

export interface CacheScopeMatch {
  backend?: string
  env?: string
  appId?: string
  accountKey?: string
  clubId?: string | null
  memberId?: string | null
}

export function scopedCacheKey(scope: CacheScope): string {
  const parts = [
    scope.backend,
    scope.env,
    scope.appId,
    scope.accountKey,
    scope.clubId ?? '-',
    scope.memberId ?? '-',
    scope.resourceKind,
    scope.resourceId ?? '-',
    String(scope.schemaVersion),
  ]
  return parts.map((part) => encodeURIComponent(part)).join('|')
}

interface Entry<T> {
  scope: CacheScope
  value: T
  expiresAt: number
}

function matches(scope: CacheScope, match: CacheScopeMatch): boolean {
  for (const key of Object.keys(match) as (keyof CacheScopeMatch)[]) {
    const expected = match[key]
    if (expected === undefined) continue
    if ((scope[key] ?? null) !== expected) return false
  }
  return true
}

export class ScopedCache<T> {
  private entries = new Map<string, Entry<T>>()

  get(scope: CacheScope, nowMs: number): T | null {
    const key = scopedCacheKey(scope)
    const entry = this.entries.get(key)
    if (!entry) return null
    if (nowMs >= entry.expiresAt) {
      this.entries.delete(key)
      return null
    }
    return entry.value
  }

  set(scope: CacheScope, value: T, expiresAtMs: number): void {
    this.entries.set(scopedCacheKey(scope), { scope, value, expiresAt: expiresAtMs })
  }

  /** 按账号/团队等维度精确清理（退出/切队/停用）。 */
  clearMatching(match: CacheScopeMatch): void {
    for (const [key, entry] of this.entries) {
      if (matches(entry.scope, match)) this.entries.delete(key)
    }
  }

  clearAll(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}
