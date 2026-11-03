/**
 * 客户端最小命令追踪器（PLAN §M4 出口、§M7 checklist (d)）。
 *
 * - 只保存**最小指针**：scope / action / mutationId / 状态 / 时间。**绝不保存 payload**，
 *   因此重启后只能按原 mutationId 查询 `command.status`，不能虚构重放。
 * - 结果未知（传输失败 / result_unknown）= `UNKNOWN`：**不生成新键重做**，只允许原键查询。
 * - 按 scope 隔离：`TEAM:clubA` 的未决命令在 `clubB` 既不查询也不续跑
 *   （A 的未知写不得在 B 继续下一步 / 刷新 / toast）。
 *
 * 本文件为纯逻辑（无 Taro / 无相对值导入），可被 Node type-stripping 测试直接加载。
 */

export type CommandScope = { kind: 'GLOBAL' } | { kind: 'TEAM'; clubId: string }

export type TrackedState = 'PENDING' | 'UNKNOWN'

export interface TrackedCommand {
  /** 'GLOBAL' | 'TEAM:{clubId}' */
  scopeKey: string
  action: string
  mutationId: string
  state: TrackedState
  updatedAt: number
}

/** 内存条目上限：超出按 updatedAt 丢弃最旧（指针非审计留痕）。 */
const MAX_ENTRIES = 50

export function scopeKeyOf(scope: CommandScope): string {
  return scope.kind === 'GLOBAL' ? 'GLOBAL' : `TEAM:${scope.clubId}`
}

/** 该 scope 是否与当前活动 scope 一致（异 scope 一律不得续跑/查询）。 */
export function isSameScopeScope(a: string, b: string): boolean {
  return a === b
}

function entryKey(scopeKey: string, action: string, mutationId: string): string {
  return `${scopeKey}\u0000${action}\u0000${mutationId}`
}

export class CommandTracker {
  private entries = new Map<string, TrackedCommand>()

  /** 发起写命令（带 mutationId 的调用开始）。 */
  begin(scope: CommandScope, action: string, mutationId: string, now: number): void {
    this.put({ scopeKey: scopeKeyOf(scope), action, mutationId, state: 'PENDING', updatedAt: now })
  }

  /** 已确定结果（成功或确定性业务失败）：移除指针，不再查询。 */
  resolve(scope: CommandScope, action: string, mutationId: string): void {
    this.entries.delete(entryKey(scopeKeyOf(scope), action, mutationId))
  }

  /** 结果未知：保留指针（原键），等待按原 scope 查询确认。 */
  markUnknown(scope: CommandScope, action: string, mutationId: string, now: number): void {
    this.put({ scopeKey: scopeKeyOf(scope), action, mutationId, state: 'UNKNOWN', updatedAt: now })
  }

  list(): TrackedCommand[] {
    return [...this.entries.values()].sort((a, b) => a.updatedAt - b.updatedAt)
  }

  /** 当前 scope 内、结果未知、需要按原键查询确认的指针。 */
  pendingInScope(scopeKey: string): TrackedCommand[] {
    return this.list().filter((entry) => entry.scopeKey === scopeKey && entry.state === 'UNKNOWN')
  }

  /** 不属于当前 scope 的未决指针：**不得**在新 scope 查询或续跑。 */
  pendingOutOfScope(scopeKey: string): TrackedCommand[] {
    return this.list().filter((entry) => entry.scopeKey !== scopeKey)
  }

  clearAll(): void {
    this.entries.clear()
  }

  /** 最小指针序列化（不含 payload）。 */
  toJSON(): TrackedCommand[] {
    return this.list()
  }

  /** 载入持久化指针：形状非法即丢弃（不猜测、不虚构重放）。 */
  loadFrom(raw: unknown): void {
    this.entries.clear()
    if (!Array.isArray(raw)) return
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      if (typeof rec.scopeKey !== 'string' || typeof rec.action !== 'string') continue
      if (typeof rec.mutationId !== 'string' || typeof rec.updatedAt !== 'number') continue
      const state: TrackedState = rec.state === 'UNKNOWN' ? 'UNKNOWN' : 'PENDING'
      // 重启后不保留 PENDING（原 payload 已丢失，不可重放）；只保留 UNKNOWN 供查询。
      if (state !== 'UNKNOWN') continue
      this.put({
        scopeKey: rec.scopeKey,
        action: rec.action,
        mutationId: rec.mutationId,
        state,
        updatedAt: rec.updatedAt,
      })
    }
  }

  private put(entry: TrackedCommand): void {
    this.entries.set(entryKey(entry.scopeKey, entry.action, entry.mutationId), entry)
    if (this.entries.size <= MAX_ENTRIES) return
    const oldest = this.list().slice(0, this.entries.size - MAX_ENTRIES)
    for (const item of oldest) {
      this.entries.delete(entryKey(item.scopeKey, item.action, item.mutationId))
    }
  }
}

/** 全应用唯一实例（backend 层写入、Store 层对账）。 */
export const commandTracker = new CommandTracker()
