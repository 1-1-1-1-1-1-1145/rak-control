import { AppError } from '../contracts/errors.ts'

/**
 * 文档数据库抽象（多团队 DESIGN §8.3；M3）。
 *
 * - 事务只做 doc 操作、不支持 where；禁止事务内网络/存储副作用。
 * - 生产用 CloudBase SDK 绑定（M8 起，`sdk-database.ts`）；本地测试用 MemoryDatabase 替身，
 *   **不得**把替身结果称为真实云鉴权。
 * - 乐观并发：事务提交前校验已读文档版本，冲突抛 revision_conflict。
 * - **接口为异步**（M8 决策 D1）：wx-server-sdk 全部返回 Promise，同步接口无法绑定真实 SDK。
 *   所有调用点必须 `await`（含 `tx.set`/`tx.remove` 这类"无返回值"的写调用，
 *   否则真实事务会在回调返回前未发出写请求）。
 */

export interface Doc {
  _id: string
  clubId?: string
  [key: string]: unknown
}

export interface Tx {
  get(collection: string, id: string): Promise<Doc | null>
  set(collection: string, doc: Doc): Promise<void>
  remove(collection: string, id: string): Promise<void>
}

export interface Database {
  read(collection: string, id: string): Promise<Doc | null>
  query(collection: string, predicate: (doc: Doc) => boolean): Promise<Doc[]>
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}

interface Row {
  doc: Doc
  version: number
}

export class MemoryDatabase implements Database {
  private cols = new Map<string, Map<string, Row>>()

  private col(name: string): Map<string, Row> {
    let map = this.cols.get(name)
    if (!map) {
      map = new Map()
      this.cols.set(name, map)
    }
    return map
  }

  async read(collection: string, id: string): Promise<Doc | null> {
    const row = this.col(collection).get(id)
    return row ? { ...row.doc } : null
  }

  async query(collection: string, predicate: (doc: Doc) => boolean): Promise<Doc[]> {
    return [...this.col(collection).values()]
      .map((row) => row.doc)
      .filter(predicate)
      .map((doc) => ({ ...doc }))
  }

  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const reads = new Map<string, number>()
    const writes: { collection: string; doc: Doc }[] = []
    const deletes: { collection: string; id: string }[] = []

    const tx: Tx = {
      get: async (collection, id) => {
        const row = this.col(collection).get(id)
        reads.set(`${collection}|${id}`, row ? row.version : 0)
        return row ? { ...row.doc } : null
      },
      set: async (collection, doc) => {
        writes.push({ collection, doc })
      },
      remove: async (collection, id) => {
        deletes.push({ collection, id })
      },
    }

    const result = await fn(tx)

    for (const [key, version] of reads) {
      const sep = key.indexOf('|')
      const collection = key.slice(0, sep)
      const id = key.slice(sep + 1)
      const row = this.col(collection).get(id)
      const current = row ? row.version : 0
      if (current !== version) throw new AppError('revision_conflict')
    }
    for (const { collection, doc } of writes) {
      const map = this.col(collection)
      const row = map.get(doc._id)
      map.set(doc._id, { doc: { ...doc }, version: (row ? row.version : 0) + 1 })
    }
    for (const { collection, id } of deletes) {
      this.col(collection).delete(id)
    }
    return result
  }
}
