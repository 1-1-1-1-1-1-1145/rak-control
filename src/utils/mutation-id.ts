/**
 * 客户端命令 mutationId（UUIDv7，服务端要求）。
 *
 * 仅需**格式合法 + 时间递增**：不用于安全随机，故用 Math.random 足够；
 * 服务端另有 UUIDv7 年龄门禁（未来偏差 ≤5 分钟、年龄 ≤24 小时）。
 */

export function createMutationId(now: number = Date.now()): string {
  const time = Math.max(0, Math.floor(now)).toString(16).padStart(12, '0').slice(-12)
  const rand = Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12)
  const tail = Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12)
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${rand.slice(0, 3)}-8${rand.slice(3, 6)}-${tail}`
}
