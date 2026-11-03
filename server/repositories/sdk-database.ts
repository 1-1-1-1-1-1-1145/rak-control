import { AppError } from '../contracts/errors.ts'
import type { Database, Doc, Tx } from './store.ts'
import type { SdkDatabase as RawDatabase, SdkTransaction } from '../shared/cloud-sdk.ts'

/**
 * CloudBase SDK → `Database` 绑定（多团队 DESIGN §6.3/§8.3、PLAN §M8）。
 *
 * 与 `MemoryDatabase` 的差异（**如实记录，不掩盖**）：
 * 1. `query(collection, predicate)` 是**任意 JS 谓词**，SDK 无法下推 → 实现为
 *    「分页全量扫描 + JS 过滤」；累计扫描条数超 `MAX_SCAN_DOCS` 即抛
 *    `stats_unavailable`，**不返回部分结果、不用 SDK 默认首批冒充全队**
 *    （对应 M6 绩效的扫描预算口径）。属待优化项（可改投影/索引下推）。
 * 2. `tx` 只做 **doc 级** get/set/remove（服务端事务不支持 where/add，DESIGN §12）；
 *    冲突由平台保证（`runTransaction(fn, times)` 有限重试），冲突最终映射为
 *    `revision_conflict`；**不**在此层实现版本比对。
 * 3. 「文档不存在」判定的目标是：**返回 null 而非抛错**。客户端 `doc.get()` 不存在时
 *    平台以错误形式返回（探针实测文案形如 `document with _id X does not exist`）。
 *    本文件按 `errCode`（-502004）与消息文案双重判定；**真实 errCode 待云侧实测确认**
 *    （M8 真机项，当前 NOT_RUN）。集合不存在（-502005）**不**视为文档不存在，如实暴露。
 *
 * 本地/未装配时不得使用本类；真实字节/真实事务结果只在云侧成立。
 */

/** 单次分页大小（服务端 `limit` 上限 1000，取 500 留余量）。 */
export const SCAN_PAGE_SIZE = 500
/** 扫描预算（命中口径见 `modules/performance` 的 MAX_SCAN）。 */
export const MAX_SCAN_DOCS = 20000
/** 事务有限重试次数（平台冲突由 `runTransaction` 自动重试）。 */
export const TX_RETRY_TIMES = 3

function errCodeOf(error: unknown): number | null {
  if (error && typeof error === 'object') {
    const raw = (error as { errCode?: unknown; code?: unknown }).errCode ?? (error as { code?: unknown }).code
    if (typeof raw === 'number') return raw
    if (typeof raw === 'string' && /^-?\d+$/.test(raw)) return Number(raw)
  }
  return null
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : ''
}

/** 文档不存在（-502004 / 平台文案）；集合不存在（-502005）明确排除。 */
function isDocumentNotFound(error: unknown): boolean {
  const code = errCodeOf(error)
  if (code === -502005) return false
  if (code === -502004) return true
  const msg = messageOf(error)
  if (/collection/i.test(msg) && /(not[_ ]?exist|不存在)/i.test(msg)) return false
  return /(does not exist|not[_ ]?exist|不存在)/i.test(msg)
}

/** 事务冲突（-501001 / TransactionConflict）。 */
function isTransactionConflict(error: unknown): boolean {
  if (errCodeOf(error) === -501001) return true
  return /transaction[\s_-]*conflict/i.test(messageOf(error))
}

/** 把 SDK 返回的 data 归一为 `Doc`；非对象或缺 `_id` 一律 null（不猜、不补）。 */
function normalizeDoc(data: unknown): Doc | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const record = data as Record<string, unknown>
  if (typeof record._id !== 'string' || record._id.length === 0) return null
  return { ...record } as Doc
}

/** 写入时剥离 `_id`（id 已由文档路径决定，平台不接受 data 携带 `_id`）。 */
function dataWithoutId(doc: Doc): Record<string, unknown> {
  const { _id: _ignored, ...rest } = doc
  return rest
}

export class SdkDatabase implements Database {
  private readonly raw: RawDatabase

  constructor(raw: RawDatabase) {
    this.raw = raw
  }

  async read(collection: string, id: string): Promise<Doc | null> {
    try {
      const res = await this.raw.collection(collection).doc(id).get()
      return normalizeDoc(res?.data)
    } catch (error) {
      if (isDocumentNotFound(error)) return null
      throw new AppError('internal_error')
    }
  }

  async query(collection: string, predicate: (doc: Doc) => boolean): Promise<Doc[]> {
    const matched: Doc[] = []
    let scanned = 0
    let offset = 0
    for (;;) {
      let batch: unknown[]
      try {
        const res = await this.raw.collection(collection).skip(offset).limit(SCAN_PAGE_SIZE).get()
        batch = Array.isArray(res?.data) ? res.data : []
      } catch {
        throw new AppError('internal_error')
      }
      for (const raw of batch) {
        const doc = normalizeDoc(raw)
        if (!doc) continue
        scanned += 1
        if (scanned > MAX_SCAN_DOCS) {
          throw new AppError('stats_unavailable', `扫描规模超出当前预算（> ${MAX_SCAN_DOCS}）`)
        }
        if (predicate(doc)) matched.push(doc)
      }
      if (batch.length < SCAN_PAGE_SIZE) break
      offset += batch.length
    }
    return matched
  }

  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    let captured: T | undefined
    let capturedSet = false
    try {
      await this.raw.runTransaction(async (raw: SdkTransaction) => {
        const tx: Tx = {
          get: async (collection, id) => {
            try {
              const res = await raw.collection(collection).doc(id).get()
              return normalizeDoc(res?.data)
            } catch (error) {
              if (isDocumentNotFound(error)) return null
              throw error
            }
          },
          set: async (collection, doc) => {
            await raw.collection(collection).doc(doc._id).set({ data: dataWithoutId(doc) })
          },
          remove: async (collection, id) => {
            await raw.collection(collection).doc(id).remove()
          },
        }
        captured = await fn(tx)
        capturedSet = true
        return null
      }, TX_RETRY_TIMES)
    } catch (error) {
      if (isTransactionConflict(error)) throw new AppError('revision_conflict')
      throw error instanceof AppError ? error : new AppError('internal_error')
    }
    if (!capturedSet) throw new AppError('internal_error')
    return captured as T
  }
}
