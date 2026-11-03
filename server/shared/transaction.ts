/**
 * 事务边界契约（多团队 DESIGN §12、BASE-DESIGN §8.3）。
 *
 * - 平台文档事务仅 doc 操作、不支持 where；100 操作 / 30 秒为待验证上限。
 * - 禁止在可重试事务回调内做网络/存储副作用（上传/复制/删除）。
 * - 事务外先用有授权范围的索引定位 ID → 事务内用 doc(id) 重读并校验全部条件。
 *
 * 具体 SDK 绑定在 M3 实现；本文件只固定接口与预算常量，供仓库实现与测试共用。
 */

export const MAX_TX_OPERATIONS = 100
export const TX_BUDGET_TARGET = 40

export interface DocRef {
  collection: string
  id: string
}

export interface TransactionContext {
  get<T>(ref: DocRef): Promise<T | null>
  set(ref: DocRef, value: unknown): void
  update(ref: DocRef, value: unknown): void
}

export interface TransactionRunner {
  run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>
}

/** 事务操作数预算检查：超过已验证平台上限即拒绝，不得静默拆分原子性。 */
export function assertTxBudget(operations: number, limit = MAX_TX_OPERATIONS): void {
  if (!Number.isInteger(operations) || operations < 0) {
    throw new Error('operations 必须是非负整数')
  }
  if (operations > limit) {
    throw new Error(`事务操作数 ${operations} 超过平台上限 ${limit}`)
  }
}
