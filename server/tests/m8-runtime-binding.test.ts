import assert from 'node:assert/strict'
import test from 'node:test'

import { AppError } from '../contracts/errors.ts'
import { assertTrustedIdentity } from '../shared/identity.ts'
import type {
  CloudSdk,
  SdkCollection,
  SdkDatabase as RawDatabase,
  SdkDeleteItemResult,
  SdkDocumentRef,
  SdkQuery,
  SdkTransaction,
  SdkWxContext,
} from '../shared/cloud-sdk.ts'
import { MAX_SCAN_DOCS, SdkDatabase } from '../repositories/sdk-database.ts'
import { MemoryDatabase } from '../repositories/store.ts'
import { COLLECTIONS } from '../repositories/collections.ts'
import type { StorageAdapter } from '../storage/adapter.ts'
import { SdkStorageAdapter } from '../storage/sdk-adapter.ts'
import {
  createApiRuntime,
  createFilesRuntime,
  createMaintenanceRuntime,
  loadApiRuntime,
  loadFilesRuntime,
  readPlatformConfig,
  readRuntimeConfig,
  type MaintenanceRuntime,
  type RuntimeConfig,
} from '../entrypoints/runtime.ts'
import { handleMaintenance } from '../entrypoints/rak-maintenance.ts'
import { identityId } from '../repositories/ids.ts'
import { APP_ID, ENV, makeClock, setupPlatform } from './helpers.ts'

/**
 * M8 运行时绑定用例（多团队 DESIGN §6.3/§11、PLAN §M8）。
 *
 * **假 SDK**：镜像 wx-server-sdk 的最小 API 面（getWXContext / database / uploadFile /
 * downloadFile / deleteFile）。本文件只证明**映射与守门正确**；真实身份、真实字节、
 * 真实 errCode 与事务外壳结构仍属云侧/真机 **NOT_RUN**，不得据此判定云端可用。
 */

class FakeCloudError extends Error {
  readonly errCode: number
  constructor(errCode: number, message: string) {
    super(message)
    this.name = 'FakeCloudError'
    this.errCode = errCode
  }
}

class FakeDocRef implements SdkDocumentRef {
  private readonly store: Map<string, Record<string, unknown>>
  private readonly id: string

  constructor(store: Map<string, Record<string, unknown>>, id: string) {
    this.store = store
    this.id = id
  }

  async get(): Promise<{ data: unknown }> {
    const doc = this.store.get(this.id)
    if (!doc) throw new FakeCloudError(-502004, `document with _id ${this.id} does not exist`)
    return { data: { ...doc } }
  }

  async set(options: { data: Record<string, unknown> }): Promise<unknown> {
    // 忠实模拟平台：data 携带 `_id` 会被拒绝（id 由路径决定）。
    if (Object.prototype.hasOwnProperty.call(options.data, '_id')) {
      throw new FakeCloudError(-502001, 'Cannot update field _id')
    }
    this.store.set(this.id, { ...options.data, _id: this.id })
    return { _id: this.id }
  }

  async remove(): Promise<unknown> {
    this.store.delete(this.id)
    return { removed: 1 }
  }
}

class FakeQuery implements SdkQuery {
  private readonly source: () => Record<string, unknown>[]
  private readonly state: { skip: number; limit: number }

  constructor(source: () => Record<string, unknown>[], state: { skip: number; limit: number }) {
    this.source = source
    this.state = state
  }

  limit(n: number): SdkQuery {
    return new FakeQuery(this.source, { ...this.state, limit: n })
  }

  skip(n: number): SdkQuery {
    return new FakeQuery(this.source, { ...this.state, skip: n })
  }

  async get(): Promise<{ data: unknown[] }> {
    const all = this.source()
    return { data: all.slice(this.state.skip, this.state.skip + this.state.limit).map((doc) => ({ ...doc })) }
  }
}

class FakeCollection implements SdkCollection {
  private readonly store: () => Map<string, Record<string, unknown>>

  constructor(store: () => Map<string, Record<string, unknown>>) {
    this.store = store
  }

  doc(id: string): SdkDocumentRef {
    return new FakeDocRef(this.store(), id)
  }

  limit(n: number): SdkQuery {
    return new FakeQuery(() => [...this.store().values()], { skip: 0, limit: n })
  }

  skip(n: number): SdkQuery {
    return new FakeQuery(() => [...this.store().values()], { skip: n, limit: 1000 })
  }

  async get(): Promise<{ data: unknown[] }> {
    return { data: [...this.store().values()].map((doc) => ({ ...doc })) }
  }
}

class FakeDb implements RawDatabase {
  private readonly cols = new Map<string, Map<string, Record<string, unknown>>>()
  readonly missingCollections = new Set<string>()
  conflictNext = false

  private store(name: string): Map<string, Record<string, unknown>> {
    let map = this.cols.get(name)
    if (!map) {
      map = new Map()
      this.cols.set(name, map)
    }
    return map
  }

  seed(name: string, docs: Record<string, unknown>[]): void {
    const map = this.store(name)
    for (const doc of docs) map.set(String(doc._id), { ...doc })
  }

  has(name: string, id: string): boolean {
    return this.store(name).has(id)
  }

  get(name: string, id: string): Record<string, unknown> | undefined {
    return this.store(name).get(id)
  }

  collection(name: string): SdkCollection {
    if (this.missingCollections.has(name)) {
      throw new FakeCloudError(-502005, 'DATABASE_COLLECTION_NOT_EXIST')
    }
    return new FakeCollection(() => this.store(name))
  }

  async runTransaction(fn: (tx: SdkTransaction) => Promise<unknown>): Promise<unknown> {
    if (this.conflictNext) {
      this.conflictNext = false
      throw new FakeCloudError(-501001, 'TransactionConflict')
    }
    const value = await fn({ collection: (name: string) => new FakeCollection(() => this.store(name)) })
    // 故意返回**外壳**：验证适配层靠闭包捕获回调返回值，而不依赖此结构。
    return { result: value }
  }
}

class FakeCloudSdk implements CloudSdk {
  ctx: SdkWxContext = {}
  readonly db = new FakeDb()
  readonly uploadPaths: string[] = []
  readonly deleteCalls: string[][] = []
  omitFirstDeleteResult = false
  breakUpload = false
  throwOnGetWxContext = false
  readonly initCalls: { env: string }[] = []

  private readonly objects = new Map<string, Uint8Array>()

  init(options: { env: string }): void {
    this.initCalls.push(options)
  }

  getWXContext(): SdkWxContext {
    if (this.throwOnGetWxContext) throw new Error('platform context unavailable')
    return { ...this.ctx }
  }

  database(): RawDatabase {
    return this.db
  }

  async uploadFile(options: { cloudPath: string; fileContent: Uint8Array }): Promise<{ fileID: string }> {
    this.uploadPaths.push(options.cloudPath)
    this.objects.set(options.cloudPath, new Uint8Array(options.fileContent))
    if (this.breakUpload) return { fileID: '' }
    return { fileID: `cloud://fake-env.fake-bucket/${options.cloudPath}` }
  }

  async downloadFile(options: { fileID: string }): Promise<{ fileContent: Uint8Array }> {
    const objectPath = options.fileID.replace('cloud://fake-env.fake-bucket/', '')
    const bytes = this.objects.get(objectPath)
    if (!bytes) throw new FakeCloudError(-503003, 'storage file not exists')
    return { fileContent: new Uint8Array(bytes) }
  }

  async deleteFile(options: { fileList: string[] }): Promise<{ fileList: SdkDeleteItemResult[] }> {
    this.deleteCalls.push([...options.fileList])
    const omitted = this.omitFirstDeleteResult ? options.fileList[0] : undefined
    const fileList = options.fileList
      .filter((fileID) => fileID !== omitted)
      .map((fileID) => ({ fileID, status: 0 }))
    return { fileList }
  }
}

const CONFIG: RuntimeConfig = {
  appId: 'wxapp-1',
  env: 'env-1',
  joinSecret: 'join-secret-1',
  storageFileIdRoot: 'cloud://env-1.bucket-1',
}

function codeOf(error: unknown): string | undefined {
  return (error as { code?: string }).code
}

// ===== 配置读取与 fail-closed =====

test('readRuntimeConfig：必填缺失即 null；storageFileIdRoot 缺省为 null 且去尾斜杠', () => {
  assert.equal(readRuntimeConfig({}), null)
  assert.equal(readRuntimeConfig({ RAK_APP_ID: 'a', RAK_CLOUD_ENV: 'e' }), null)
  assert.equal(readRuntimeConfig({ RAK_APP_ID: 'a', RAK_JOIN_SECRET: 's' }), null)
  assert.equal(readRuntimeConfig({ RAK_CLOUD_ENV: 'e', RAK_JOIN_SECRET: 's' }), null)
  assert.equal(readRuntimeConfig({ RAK_APP_ID: '   ', RAK_CLOUD_ENV: 'e', RAK_JOIN_SECRET: 's' }), null)

  assert.deepEqual(readRuntimeConfig({ RAK_APP_ID: ' a ', RAK_CLOUD_ENV: ' e ', RAK_JOIN_SECRET: ' s ' }), {
    appId: 'a',
    env: 'e',
    joinSecret: 's',
    storageFileIdRoot: null,
  })
  assert.equal(
    readRuntimeConfig({
      RAK_APP_ID: 'a',
      RAK_CLOUD_ENV: 'e',
      RAK_JOIN_SECRET: 's',
      RAK_STORAGE_FILEID_ROOT: 'cloud://env-1.bucket-1/',
    })?.storageFileIdRoot,
    'cloud://env-1.bucket-1'
  )
})

test('loadApiRuntime/loadFilesRuntime：必填环境变量缺失 → null（fail-closed）', () => {
  const keys = ['RAK_APP_ID', 'RAK_CLOUD_ENV', 'RAK_JOIN_SECRET', 'RAK_STORAGE_FILEID_ROOT']
  const saved = keys.map((key) => [key, process.env[key]] as const)
  for (const key of keys) delete process.env[key]
  try {
    assert.equal(loadApiRuntime(), null)
    assert.equal(loadFilesRuntime(), null)
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

// ===== 身份映射与守门 =====

test('identity：平台上下文映射；缺 OPENID/APPID → null；app/env 不符 → 明确拒绝', () => {
  const sdk = new FakeCloudSdk()
  const runtime = createApiRuntime({ sdk, config: CONFIG, now: () => 123 })

  sdk.ctx = { APPID: CONFIG.appId, OPENID: 'openid-1', ENV: CONFIG.env }
  assert.deepEqual(runtime.identity(), { appId: CONFIG.appId, openid: 'openid-1', env: CONFIG.env })
  assert.equal(assertTrustedIdentity(runtime.identity(), runtime.expected).openid, 'openid-1')

  sdk.ctx = { APPID: CONFIG.appId, ENV: CONFIG.env }
  assert.equal(runtime.identity(), null)
  assert.throws(() => assertTrustedIdentity(runtime.identity(), runtime.expected), (e) => codeOf(e) === 'identity_required')

  sdk.ctx = { APPID: 'other-app', OPENID: 'openid-1', ENV: CONFIG.env }
  assert.throws(() => assertTrustedIdentity(runtime.identity(), runtime.expected), (e) => codeOf(e) === 'app_mismatch')

  sdk.ctx = { APPID: CONFIG.appId, OPENID: 'openid-1', ENV: 'other-env' }
  assert.throws(() => assertTrustedIdentity(runtime.identity(), runtime.expected), (e) => codeOf(e) === 'environment_mismatch')

  // ENV 缺失不得回落为 expected.env
  sdk.ctx = { APPID: CONFIG.appId, OPENID: 'openid-1' }
  assert.throws(() => assertTrustedIdentity(runtime.identity(), runtime.expected), (e) => codeOf(e) === 'environment_mismatch')

  sdk.throwOnGetWxContext = true
  assert.equal(runtime.identity(), null)

  // expected 只来自服务端配置
  assert.deepEqual(runtime.expected, { appId: CONFIG.appId, env: CONFIG.env })
  assert.equal(runtime.now(), 123)
  assert.equal(runtime.joinSecret, CONFIG.joinSecret)
  assert.ok(runtime.db instanceof SdkDatabase)
  // 装配时必须先 init（云端实测未 init 会让 database() 抛错），且 env 用配置值
  assert.deepEqual(sdk.initCalls, [{ env: CONFIG.env }])
})

// ===== DB 适配 =====

test('SdkDatabase.read：命中返回文档；文档不存在 → null；集合不存在 → internal_error', async () => {
  const db = new FakeDb()
  db.seed('rak_tasks', [{ _id: 't1', clubId: 'c1', title: 'x' }])
  const sdb = new SdkDatabase(db)

  assert.deepEqual(await sdb.read('rak_tasks', 't1'), { _id: 't1', clubId: 'c1', title: 'x' })
  assert.equal(await sdb.read('rak_tasks', 'missing'), null)
  // 空集合中的读取仍是"文档不存在"（不产生副作用）
  assert.equal(await sdb.read('rak_empty', 'anything'), null)

  db.missingCollections.add('rak_missing')
  await assert.rejects(() => sdb.read('rak_missing', 'x'), (e) => codeOf(e) === 'internal_error')
})

test('SdkDatabase.query：分页全扫 + 谓词过滤，跨页命中不漏', async () => {
  const db = new FakeDb()
  const total = 1200
  db.seed(
    'rak_tasks',
    Array.from({ length: total }, (_, i) => ({ _id: `d${i}`, clubId: i % 3 === 0 ? 'c1' : 'c2', n: i }))
  )
  const sdb = new SdkDatabase(db)

  const matched = await sdb.query('rak_tasks', (doc) => doc.clubId === 'c1')
  assert.equal(matched.length, 400)
  assert.ok(matched.every((doc) => doc.clubId === 'c1'))
  // 第 3 页（offset 1000..1199）中的命中项确实被纳入
  assert.ok(matched.some((doc) => doc._id === 'd1101'))

  db.missingCollections.add('rak_none')
  await assert.rejects(() => sdb.query('rak_none', () => true), (e) => codeOf(e) === 'internal_error')
})

test('SdkDatabase.query：累计扫描超预算 → stats_unavailable（不返回部分结果）', async () => {
  const db = new FakeDb()
  db.seed(
    'rak_tasks',
    Array.from({ length: MAX_SCAN_DOCS + 1 }, (_, i) => ({ _id: `d${i}`, clubId: 'c1' }))
  )
  const sdb = new SdkDatabase(db)
  await assert.rejects(() => sdb.query('rak_tasks', () => true), (e) => codeOf(e) === 'stats_unavailable')
})

test('SdkDatabase.tx：doc 级 get/set/remove；剥离 _id；闭包捕获回调返回值', async () => {
  const db = new FakeDb()
  db.seed('rak_clubs', [{ _id: 'c1', clubId: 'c1', name: '旧', mutationSeq: 1 }])
  const sdb = new SdkDatabase(db)

  const result = await sdb.tx(async (tx) => {
    const club = await tx.get('rak_clubs', 'c1')
    assert.equal(club?.name, '旧')
    assert.equal(await tx.get('rak_clubs', 'nope'), null)
    await tx.set('rak_clubs', { ...(club as Record<string, unknown>), _id: 'c1', name: '新', mutationSeq: 2 })
    await tx.set('rak_clubs', { _id: 'c2', name: '新建' })
    await tx.remove('rak_clubs', 'c1')
    return 42
  })

  // 假 SDK 返回外壳 { result: 42 }；适配层仍返回回调的返回值 42
  assert.equal(result, 42)
  assert.equal(db.has('rak_clubs', 'c1'), false)
  assert.equal(db.get('rak_clubs', 'c2')?.name, '新建')
  assert.equal(db.get('rak_clubs', 'c2')?._id, 'c2')
})

test('SdkDatabase.tx：平台事务冲突 → revision_conflict；回调内业务拒绝原样冒泡', async () => {
  const conflicting = new FakeDb()
  conflicting.conflictNext = true
  await assert.rejects(() => new SdkDatabase(conflicting).tx(async () => 1), (e) => codeOf(e) === 'revision_conflict')

  await assert.rejects(
    () =>
      new SdkDatabase(new FakeDb()).tx(async () => {
        throw new AppError('permission_denied')
      }),
    (e) => codeOf(e) === 'permission_denied'
  )
})

// ===== 存储适配 =====

test('SdkStorageAdapter：上传用 SDK fileID；下载字节往返；fileIdForPath 确定性；能力快照不伪造 TTL', async () => {
  const sdk = new FakeCloudSdk()
  const adapter = new SdkStorageAdapter({ sdk, fileIdRoot: 'cloud://env-1.bucket-1' })

  const bytes = new Uint8Array([1, 2, 3, 4])
  const ref = await adapter.uploadObject('clubs/c1/staging/s1/chunks/0000', bytes)
  assert.deepEqual(sdk.uploadPaths, ['clubs/c1/staging/s1/chunks/0000'])
  assert.equal(ref.fileID, 'cloud://fake-env.fake-bucket/clubs/c1/staging/s1/chunks/0000')
  assert.deepEqual([...(await adapter.downloadObject(ref.fileID))], [1, 2, 3, 4])

  assert.equal(adapter.fileIdForPath('clubs/c1/final/s1/a1/blob'), 'cloud://env-1.bucket-1/clubs/c1/final/s1/a1/blob')

  const caps = adapter.capabilities()
  assert.equal(caps.adjudicated, true)
  assert.equal(caps.uploadTransport, 'function-chunks-v1')
  assert.equal(caps.maxObjectBytes, 10 * 1024 * 1024)
  assert.equal(caps.downloadTtlSeconds, null)
})

test('SdkStorageAdapter：deleteObjects 保输入顺序；响应缺失项非 0（不伪造成功）；空输入不发请求', async () => {
  const sdk = new FakeCloudSdk()
  const adapter = new SdkStorageAdapter({ sdk, fileIdRoot: null })
  sdk.omitFirstDeleteResult = true

  const out = await adapter.deleteObjects(['f-b', 'f-a', 'f-c'])
  assert.deepEqual(out.map((item) => item.fileID), ['f-b', 'f-a', 'f-c'])
  assert.equal(out[0].status, -1)
  assert.equal(out[1].status, 0)
  assert.equal(out[2].status, 0)

  assert.deepEqual(await adapter.deleteObjects([]), [])
  assert.equal(sdk.deleteCalls.length, 1)
})

test('SdkStorageAdapter：未配置 fileID 前缀 / 上传响应缺 fileID → storage_unavailable（fail-closed）', async () => {
  const noRoot = new SdkStorageAdapter({ sdk: new FakeCloudSdk(), fileIdRoot: null })
  assert.throws(() => noRoot.fileIdForPath('x'), (e) => codeOf(e) === 'storage_unavailable')

  const sdk = new FakeCloudSdk()
  sdk.breakUpload = true
  const adapter = new SdkStorageAdapter({ sdk, fileIdRoot: null })
  await assert.rejects(() => adapter.uploadObject('p', new Uint8Array([1])), (e) => codeOf(e) === 'storage_unavailable')
})

test('createFilesRuntime：默认装配 SDK 存储适配；storage 可注入替身', () => {
  const sdk = new FakeCloudSdk()
  const runtime = createFilesRuntime({ sdk, config: CONFIG })
  assert.ok(runtime.storage instanceof SdkStorageAdapter)
  assert.deepEqual(runtime.expected, { appId: CONFIG.appId, env: CONFIG.env })
  assert.deepEqual(sdk.initCalls, [{ env: CONFIG.env }])

  const standIn: StorageAdapter = {
    capabilities: () => ({
      adjudicated: false,
      uploadTransport: null,
      maxObjectBytes: null,
      downloadTtlSeconds: null,
    }),
    requireAdjudicated: () => {},
    uploadObject: async () => ({ fileID: 'stand-in' }),
    downloadObject: async () => new Uint8Array(),
    deleteObjects: async () => [],
    fileIdForPath: () => 'stand-in',
  }
  assert.equal(createFilesRuntime({ sdk, config: CONFIG, storage: standIn }).storage, standIn)
})

// ===== worker（rakMaintenance）受控入口 =====

test('readPlatformConfig：AppID/环境缺一即 null；业务运行时另需申请令牌密钥', () => {
  assert.equal(readPlatformConfig({}), null)
  assert.equal(readPlatformConfig({ RAK_APP_ID: 'a' }), null)
  assert.equal(readPlatformConfig({ RAK_CLOUD_ENV: 'e' }), null)
  assert.deepEqual(readPlatformConfig({ RAK_APP_ID: ' a ', RAK_CLOUD_ENV: ' e ' }), { appId: 'a', env: 'e' })

  const platformOnly = { RAK_APP_ID: 'a', RAK_CLOUD_ENV: 'e' }
  assert.equal(readRuntimeConfig(platformOnly), null) // 缺 RAK_JOIN_SECRET → fail-closed
  assert.equal(
    readRuntimeConfig({ ...platformOnly, RAK_JOIN_SECRET: 's', RAK_STORAGE_FILEID_ROOT: 'cloud://a.b/' })
      ?.storageFileIdRoot,
    'cloud://a.b'
  )
})

test('createMaintenanceRuntime：先 init（配置 env）+ 数据库绑定；worker 不持有申请令牌密钥', () => {
  const sdk = new FakeCloudSdk()
  const runtime = createMaintenanceRuntime({
    sdk,
    config: { appId: CONFIG.appId, env: CONFIG.env },
    now: () => 7,
  })
  assert.deepEqual(sdk.initCalls, [{ env: CONFIG.env }])
  assert.equal(runtime.appId, CONFIG.appId)
  assert.equal(runtime.now(), 7)
  assert.ok(runtime.db instanceof SdkDatabase)
  assert.ok(!('joinSecret' in runtime))
})

test('handleMaintenance：platformInitialize 幂等写 system_config/main；缺运行时/未知 kind/异 appId 拒绝且无副作用', async () => {
  const db = new MemoryDatabase()
  const clock = makeClock()
  const runtime: MaintenanceRuntime = { db, now: clock.now, appId: CONFIG.appId, env: CONFIG.env }

  const first = await handleMaintenance({ kind: 'platformInitialize', appId: CONFIG.appId }, runtime)
  assert.equal(first.ok, true)
  assert.equal(first.handled, true)
  assert.equal(first.initialized, true)
  assert.equal(first.alreadyInitialized, false)

  const created = await db.read(COLLECTIONS.systemConfig, 'main')
  assert.equal(created?.appId, CONFIG.appId)
  assert.equal(created?.schemaVersion, 1)
  assert.equal(created?.platformInitializedAt, clock.now())
  assert.deepEqual(created?.maintenanceFlags, {})
  // 不再含单队语义
  assert.equal('clubId' in (created as Record<string, unknown>), false)
  assert.equal('ownerUserId' in (created as Record<string, unknown>), false)

  // 幂等：重复执行不重置
  clock.advance(60_000)
  const second = await handleMaintenance({ kind: 'platformInitialize', appId: CONFIG.appId }, runtime)
  assert.equal(second.handled, true)
  assert.equal(second.alreadyInitialized, true)
  assert.equal((await db.read(COLLECTIONS.systemConfig, 'main'))?.platformInitializedAt, created?.platformInitializedAt)

  // 未知 kind / 非对象 / 缺运行时 → not_implemented（fail-closed）
  assert.equal((await handleMaintenance({ kind: 'cleanup' }, runtime)).reason, 'not_implemented')
  assert.equal((await handleMaintenance({}, runtime)).reason, 'not_implemented')
  assert.equal((await handleMaintenance('raw', runtime)).reason, 'not_implemented')
  assert.equal((await handleMaintenance(undefined, null)).reason, 'not_implemented')

  // 异 appId / 缺 appId → 拒绝，且**不写库**
  const fresh = new MemoryDatabase()
  const freshRuntime: MaintenanceRuntime = { db: fresh, now: clock.now, appId: CONFIG.appId, env: CONFIG.env }
  assert.equal(
    (await handleMaintenance({ kind: 'platformInitialize', appId: 'other-app' }, freshRuntime)).reason,
    'app_id_mismatch'
  )
  assert.equal((await handleMaintenance({ kind: 'platformInitialize' }, freshRuntime)).reason, 'app_id_mismatch')
  assert.equal(await fresh.read(COLLECTIONS.systemConfig, 'main'), null)
})

test('handleMaintenance：provisionTeam 受控开通（幂等、消费参考号）；异 appId/env/缺字段拒绝', async () => {
  const setup = await setupPlatform()
  const runtime: MaintenanceRuntime = { db: setup.db, now: setup.clock.now, appId: APP_ID, env: ENV }
  const base = {
    kind: 'provisionTeam',
    appId: APP_ID,
    env: ENV,
    provisioningKey: 'smoke-key-1',
    clubName: '摄影社',
    slug: 'photo',
    displayCode: 'A7K2',
    ownerReferenceCode: setup.code,
    ownerDisplayName: '王同学',
  }

  const first = await handleMaintenance(base, runtime)
  assert.equal(first.ok, true)
  assert.equal(first.handled, true)
  assert.equal(typeof first.clubId, 'string')
  assert.equal(first.replayed, false)

  const clubId = first.clubId as string
  const club = await setup.db.read(COLLECTIONS.clubs, clubId)
  assert.equal(club?.name, '摄影社')
  assert.equal(club?.status, 'ACTIVE')
  const members = await setup.db.query(COLLECTIONS.members, (doc) => doc.clubId === clubId)
  assert.equal(members.length, 1)
  assert.equal(members[0]._id, club?.ownerMemberId)
  assert.equal(members[0].status, 'ACTIVE')

  // 参考号已消费
  const identity = await setup.db.read(COLLECTIONS.identities, identityId(APP_ID, setup.ownerIdentity.openid))
  assert.equal(typeof identity?.ownerReferenceUsedAt, 'number')

  // 幂等：同 provisioningKey 重放 → 同一队，不建第二个队
  const second = await handleMaintenance(base, runtime)
  assert.equal(second.clubId, clubId)
  assert.equal(second.replayed, true)
  assert.equal((await setup.db.query(COLLECTIONS.clubs, () => true)).length, 1)

  // 异 appId / 异 env / 缺字段 / 未知 kind → 拒绝且不建队
  assert.equal((await handleMaintenance({ ...base, appId: 'other' }, runtime)).reason, 'app_id_mismatch')
  assert.equal((await handleMaintenance({ ...base, env: 'other-env' }, runtime)).reason, 'env_mismatch')
  assert.equal(
    (await handleMaintenance({ kind: 'provisionTeam', appId: APP_ID, env: ENV }, runtime)).reason,
    'invalid_params'
  )
  assert.equal((await handleMaintenance({ kind: 'cleanup', appId: APP_ID }, runtime)).reason, 'not_implemented')
  assert.equal((await setup.db.query(COLLECTIONS.clubs, () => true)).length, 1)
})
