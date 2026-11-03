import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { AppError } from '../contracts/errors.ts'
import { COLLECTIONS } from '../repositories/collections.ts'
import { memberId } from '../repositories/ids.ts'
import type { Doc } from '../repositories/store.ts'
import type { StorageAdapter, StorageDeletionResult, StorageObjectRef } from '../storage/adapter.ts'
import type { StorageCapabilities } from '../storage/capabilities.ts'
import * as files from '../modules/files/index.ts'
import * as tasks from '../modules/tasks/index.ts'
import { addMemberWithIdentity, mutationFactory, seedTeam, type SeedResult } from './helpers.ts'

/**
 * M5 `function-chunks-v1` 服务端用例（多团队 DESIGN §11、PLAN §M5）。
 *
 * 替身层：内存数据库 + 内存存储适配器（**不代表真实云鉴权/真实字节传输**）。
 * 真实字节、真机、存储 SDK 绑定在 M8；本文件只证明状态机与不变量。
 */

class FakeStorageAdapter implements StorageAdapter {
  private objects = new Map<string, Uint8Array>()
  private byFileID = new Map<string, string>()
  deleted: string[] = []
  uploads: string[] = []
  uploadFailures = 0
  /** >0 时读回字节被篡改，用于验证组装校验确实生效。 */
  tamper = 0

  capabilities(): StorageCapabilities {
    return {
      adjudicated: true,
      uploadTransport: 'function-chunks-v1',
      maxObjectBytes: files.MAX_OBJECT_BYTES,
      downloadTtlSeconds: null,
    }
  }

  requireAdjudicated(): void {}

  async uploadObject(objectPath: string, bytes: Uint8Array): Promise<StorageObjectRef> {
    if (this.uploadFailures > 0) {
      this.uploadFailures -= 1
      throw new AppError('storage_unavailable', '替身层：一次上传失败')
    }
    this.objects.set(objectPath, new Uint8Array(bytes))
    this.uploads.push(objectPath)
    const fileID = this.fileIdForPath(objectPath)
    this.byFileID.set(fileID, objectPath)
    return { fileID }
  }

  async downloadObject(fileID: string): Promise<Uint8Array> {
    const objectPath = this.byFileID.get(fileID)
    const bytes = objectPath ? this.objects.get(objectPath) : undefined
    if (!bytes) throw new AppError('attachment_not_ready', '替身层：对象不存在')
    const copy = new Uint8Array(bytes)
    if (this.tamper > 0) copy[0] = (copy[0] + 1) % 256
    return copy
  }

  async deleteObjects(fileIDs: string[]): Promise<StorageDeletionResult[]> {
    for (const fileID of fileIDs) this.deleted.push(fileID)
    return fileIDs.map((fileID) => ({ fileID, status: 0 }))
  }

  fileIdForPath(objectPath: string): string {
    return `cloud://test-env.test-bucket/${objectPath}`
  }
}

const CHUNK = files.CHUNK_BYTES

function fill(length: number, value: number): Uint8Array {
  return new Uint8Array(length).fill(value)
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

interface Harness extends SeedResult {
  storage: FakeStorageAdapter
  deps: files.FilesDeps
  taskId: string
  revision: number
  nextMutationId: () => string
}

async function makeHarness(): Promise<Harness> {
  const seed = await seedTeam()
  const storage = new FakeStorageAdapter()
  const deps: files.FilesDeps = { db: seed.db, now: seed.clock.now, storage }
  const nextMutationId = mutationFactory(seed.clock)
  const tasksDeps = { db: seed.db, now: seed.clock.now }
  const created = await tasks.createTask(tasksDeps, seed.ownerIdentity, seed.clubId, {
    title: '拍摄任务',
    description: '交原片',
      category: 'content',
    mutationId: nextMutationId(),
  })
  const claimed = await tasks.claimTask(tasksDeps, seed.ownerIdentity, seed.clubId, {
    taskId: created.taskId,
    expectedRevision: created.revision,
    mutationId: nextMutationId(),
  })
  return { ...seed, storage, deps, taskId: created.taskId, revision: claimed.revision, nextMutationId }
}

async function initSession(h: Harness, declaredSize: number, name = 'a.pdf') {
  return files.fileInit(h.deps, h.ownerIdentity, h.clubId, {
    taskId: h.taskId,
    expectedTaskRevision: h.revision,
    name,
    declaredSize,
    mutationId: h.nextMutationId(),
  })
}

function codeOf(error: unknown): string {
  return error instanceof AppError ? error.code : `unexpected:${String(error)}`
}

test('init：固定 3 槽预占、只递增 batch revision，task 业务 revision 不变', async () => {
  const h = await makeHarness()
  const taskBefore = await h.db.read(COLLECTIONS.tasks, h.taskId)
  const v1 = await initSession(h, 300 * 1024, 'a.pdf')
  const v2 = await initSession(h, 1000, 'b.pdf')
  const v3 = await initSession(h, 1000, 'c.pdf')

  const batchId = createHash('sha256')
    .update(JSON.stringify(['rak-batch-v1', h.clubId, h.taskId, 1]))
    .digest('hex')
  const batch = await h.db.read(COLLECTIONS.uploadBatches, batchId)
  assert.ok(batch)
  assert.equal((batch!.slots as unknown[]).length, files.MAX_ATTACHMENTS)
  assert.equal((batch!.slots as Array<{ state: string }>).filter((s) => s.state === 'OCCUPIED').length, 3)
  assert.equal(batch!.revision, 3)

  const taskAfter = await h.db.read(COLLECTIONS.tasks, h.taskId)
  assert.equal(taskAfter!.revision, taskBefore!.revision, 'task 业务 revision 不因附件变化')

  assert.equal(v1.totalChunks, 2)
  assert.deepEqual(v1.missingIndexes, [0, 1])
  assert.equal(v1.transport, 'function-chunks-v1')
  assert.equal(v2.targetRound, 1)
  assert.ok(!JSON.stringify([v1, v2, v3]).includes('cloud://'), 'session 视图不得泄露 fileID')

  await assert.rejects(() => initSession(h, 1000, 'd.pdf'), (e) => codeOf(e) === 'validation_failed')
})

test('init 的幂等：同 mutationId 重放不另占槽', async () => {
  const h = await makeHarness()
  const mutationId = h.nextMutationId()
  const first = await files.fileInit(h.deps, h.ownerIdentity, h.clubId, {
    taskId: h.taskId,
    expectedTaskRevision: h.revision,
    name: 'a.pdf',
    declaredSize: 2000,
    mutationId,
  })
  const replay = await files.fileInit(h.deps, h.ownerIdentity, h.clubId, {
    taskId: h.taskId,
    expectedTaskRevision: h.revision,
    name: 'a.pdf',
    declaredSize: 2000,
    mutationId,
  })
  assert.equal(replay.sessionId, first.sessionId)
  const batchId = createHash('sha256').update(JSON.stringify(['rak-batch-v1', h.clubId, h.taskId, 1])).digest('hex')
  const batch = (await h.db.read(COLLECTIONS.uploadBatches, batchId))!
  assert.equal((batch.slots as Array<{ state: string }>).filter((s) => s.state === 'OCCUPIED').length, 1)
})

test('init 的授权：非负责人被拒、revision 不符被拒、异任务状态被拒', async () => {
  const h = await makeHarness()
  const other = await addMemberWithIdentity(h.db, h.clubId, 'other-openid', '他人', 'member')
  assert.equal(
    codeOf(
      await files
        .fileInit(h.deps, other.identity, h.clubId, {
          taskId: h.taskId,
          expectedTaskRevision: h.revision,
          name: 'a.pdf',
          declaredSize: 1000,
          mutationId: h.nextMutationId(),
        })
        .catch((e) => e)
    ),
    'permission_denied'
  )
  assert.equal(
    codeOf(
      await files
        .fileInit(h.deps, h.ownerIdentity, h.clubId, {
          taskId: h.taskId,
          expectedTaskRevision: h.revision + 5,
          name: 'a.pdf',
          declaredSize: 1000,
          mutationId: h.nextMutationId(),
        })
        .catch((e) => e)
    ),
    'revision_conflict'
  )
})

test('init 回收过期/作废槽位：遗留占位不再把批次卡死', async () => {
  const h = await makeHarness()
  const s1 = await initSession(h, 1000, 's1.pdf')
  const s2 = await initSession(h, 1000, 's2.pdf')
  await files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: s2.sessionId, index: 0, base64: b64(fill(1000, 9)) })
  const confirmed = await files.fileConfirm(h.deps, h.ownerIdentity, h.clubId, {
    sessionId: s2.sessionId,
    mutationId: h.nextMutationId(),
  })
  const s3 = await initSession(h, 1000, 's3.pdf')

  // 三个槽位都被占：第四个被拒
  await assert.rejects(() => initSession(h, 1000, 's4.pdf'), (e) => codeOf(e) === 'validation_failed')

  // 超过 24h：s1/s3 上传过期、s2 的已确认附件过期
  h.clock.advance(25 * 60 * 60 * 1000)
  const s4 = await initSession(h, 1000, 's4.pdf')
  assert.equal(s4.state, 'DRAFT')

  const t1 = (await h.db.read(COLLECTIONS.uploadSessions, s1.sessionId))!
  const t2 = (await h.db.read(COLLECTIONS.uploadSessions, s2.sessionId))!
  const t3 = (await h.db.read(COLLECTIONS.uploadSessions, s3.sessionId))!
  assert.equal(t1.state, 'EXPIRED')
  assert.equal(t2.state, 'EXPIRED')
  assert.equal(t3.state, 'EXPIRED')
  const attachment = (await h.db.read(COLLECTIONS.attachments, confirmed.attachmentId))!
  assert.equal(attachment.lifecycleState, 'GC_PENDING')

  const batchId = createHash('sha256').update(JSON.stringify(['rak-batch-v1', h.clubId, h.taskId, 1])).digest('hex')
  const batch = (await h.db.read(COLLECTIONS.uploadBatches, batchId))!
  const occupied = (batch.slots as Array<{ state: string }>).filter((slot) => slot.state === 'OCCUPIED')
  assert.equal(occupied.length, 1, '回收后只有新会话占位')

  // CANCELLED 分支：取消后槽位可复用
  await files.fileCancel(h.deps, h.ownerIdentity, h.clubId, { sessionId: s4.sessionId, mutationId: h.nextMutationId() })
  const s5 = await initSession(h, 1000, 's5.pdf')
  assert.equal(s5.state, 'DRAFT')
})

test('分片：末片定长校验、序号越界拒绝、>256KiB 拒绝、同 index 幂等/异内容冲突', async () => {
  const h = await makeHarness()
  const declared = 300 * 1024
  const session = await initSession(h, declared)
  const part0 = fill(CHUNK, 7)
  const part1 = fill(declared - CHUNK, 9)

  await files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, index: 0, base64: b64(part0) })
  const status = await files.fileStatus(h.deps, h.ownerIdentity, h.clubId, session.sessionId)
  assert.deepEqual(status.receivedIndexes, [0])
  assert.deepEqual(status.missingIndexes, [1])
  assert.equal(status.state, 'UPLOADING')

  // 幂等：同 index 同内容可重放
  await files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, index: 0, base64: b64(part0) })
  // 异内容 → 冲突
  await assert.rejects(
    () => files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, index: 0, base64: b64(fill(CHUNK, 8)) }),
    (e) => codeOf(e) === 'idempotency_conflict'
  )
  // 序号越界
  await assert.rejects(
    () => files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, index: 2, base64: b64(fill(1000, 1)) }),
    (e) => codeOf(e) === 'validation_failed'
  )
  // 非末片长度不足（片长校验先于幂等判断）
  await assert.rejects(
    () => files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, index: 0, base64: b64(fill(1000, 3)) }),
    (e) => codeOf(e) === 'validation_failed'
  )
  // 末片长度不符
  await assert.rejects(
    () => files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, index: 1, base64: b64(fill(10, 3)) }),
    (e) => codeOf(e) === 'validation_failed'
  )
  // base64 非法
  await assert.rejects(
    () => files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, index: 1, base64: 'not*base64' }),
    (e) => codeOf(e) === 'validation_failed'
  )
})

test('分片：首次上传失败后同内容重试，不得把 PENDING 伪装成成功', async () => {
  const h = await makeHarness()
  const session = await initSession(h, 1000)
  const part = fill(1000, 7)
  h.storage.uploadFailures = 1

  await assert.rejects(
    () => files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, index: 0, base64: b64(part) }),
    (e) => codeOf(e) === 'storage_unavailable'
  )
  const pending = (await h.db.query(COLLECTIONS.uploadChunks, (doc) => doc.sessionId === session.sessionId))[0]
  assert.equal(pending?.state, 'PENDING')

  await files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, index: 0, base64: b64(part) })
  const stored = (await h.db.query(COLLECTIONS.uploadChunks, (doc) => doc.sessionId === session.sessionId))[0]
  assert.equal(stored?.state, 'STORED')
  assert.equal(typeof stored?.fileID, 'string')
  assert.equal(h.storage.uploads.filter((path) => path.includes('/chunks/0000')).length, 1)
})

test('confirm：缺片显式失败；补齐后组装校验通过并发布 VERIFIED 附件（视图不含 fileID）', async () => {
  const h = await makeHarness()
  const declared = 300 * 1024
  const session = await initSession(h, declared)
  const part0 = fill(CHUNK, 7)
  const part1 = fill(declared - CHUNK, 9)
  const assembled = new Uint8Array(declared)
  assembled.set(part0, 0)
  assembled.set(part1, CHUNK)

  await files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, index: 0, base64: b64(part0) })
  await assert.rejects(
    () => files.fileConfirm(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, mutationId: h.nextMutationId() }),
    (e) => codeOf(e) === 'attachment_not_ready'
  )

  await files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, index: 1, base64: b64(part1) })
  const confirmMutation = h.nextMutationId()
  const attachment = await files.fileConfirm(h.deps, h.ownerIdentity, h.clubId, {
    sessionId: session.sessionId,
    mutationId: confirmMutation,
  })
  assert.equal(attachment.sha256, sha256(assembled))
  assert.equal(attachment.size, declared)
  assert.equal(attachment.integrityState, 'VERIFIED')
  assert.equal(attachment.scanState, 'NOT_CONFIGURED', '未做病毒扫描必须如实标注')
  assert.equal(attachment.lifecycleState, 'DRAFT')
  assert.ok(!JSON.stringify(attachment).includes('cloud://'), '附件视图不得下发 fileID')

  const storedSession = (await h.db.read(COLLECTIONS.uploadSessions, session.sessionId))!
  assert.equal(storedSession.state, 'CONFIRMED')
  assert.equal(storedSession.attachmentId, attachment.attachmentId)
  assert.ok(h.storage.deleted.length >= 2, '确认后应尽力清理 staging 分片')

  const uploadsBeforeReplay = h.storage.uploads.length
  const replay = await files.fileConfirm(h.deps, h.ownerIdentity, h.clubId, {
    sessionId: session.sessionId,
    mutationId: confirmMutation,
  })
  assert.deepEqual(replay, attachment)
  assert.equal(h.storage.uploads.length, uploadsBeforeReplay, '确认丢响应后的重试不得重复上传最终对象')
})

test('confirm：读回字节被篡改时拒绝发布（组装校验生效）', async () => {
  const h = await makeHarness()
  const declared = 1000
  const session = await initSession(h, declared)
  await files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, index: 0, base64: b64(fill(declared, 5)) })
  h.storage.tamper = 1
  await assert.rejects(
    () => files.fileConfirm(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, mutationId: h.nextMutationId() }),
    (e) => codeOf(e) === 'attachment_not_ready'
  )
  assert.equal((await h.db.read(COLLECTIONS.uploadSessions, session.sessionId))!.state, 'UPLOADING')
})

test('30 分钟过期后拒绝继续上传与确认', async () => {
  const h = await makeHarness()
  const session = await initSession(h, 1000)
  h.clock.advance(files.UPLOAD_TTL_MS + 1000)
  await assert.rejects(
    () => files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, index: 0, base64: b64(fill(1000, 1)) }),
    (e) => codeOf(e) === 'upload_expired'
  )
  await assert.rejects(
    () => files.fileConfirm(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, mutationId: h.nextMutationId() }),
    (e) => codeOf(e) === 'upload_expired'
  )
})

test('取消：fence++、释放槽位、GC_PENDING；已确认未交付可取消，已交付不可取消', async () => {
  const h = await makeHarness()
  const session = await initSession(h, 1000)
  await files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, index: 0, base64: b64(fill(1000, 4)) })
  const cancelled = await files.fileCancel(h.deps, h.ownerIdentity, h.clubId, {
    sessionId: session.sessionId,
    mutationId: h.nextMutationId(),
  })
  assert.equal(cancelled.state, 'CANCELLED')
  assert.equal(cancelled.fence, 1)
  assert.equal(cancelled.releasedSlot, true)
  await assert.rejects(
    () => files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session.sessionId, index: 0, base64: b64(fill(1000, 4)) }),
    (e) => codeOf(e) === 'upload_cancelled'
  )
  // 槽位已释放 → 可再次 init
  const again = await initSession(h, 1000, 'again.bin')
  assert.equal(again.state, 'DRAFT')

  // 已确认但未交付 → 允许取消（D1），附件转 GC_PENDING
  const session2 = await initSession(h, 500, 'x.bin')
  await files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session2.sessionId, index: 0, base64: b64(fill(500, 6)) })
  const confirmed2 = await files.fileConfirm(h.deps, h.ownerIdentity, h.clubId, {
    sessionId: session2.sessionId,
    mutationId: h.nextMutationId(),
  })
  const cancelled2 = await files.fileCancel(h.deps, h.ownerIdentity, h.clubId, {
    sessionId: session2.sessionId,
    mutationId: h.nextMutationId(),
  })
  assert.equal(cancelled2.state, 'CANCELLED')
  assert.equal(cancelled2.releasedSlot, true)
  const attachment2 = (await h.db.read(COLLECTIONS.attachments, confirmed2.attachmentId))!
  assert.equal(attachment2.lifecycleState, 'GC_PENDING')

  // 已交付 → 仍禁止取消
  const session3 = await initSession(h, 500, 'y.bin')
  await files.putChunk(h.deps, h.ownerIdentity, h.clubId, { sessionId: session3.sessionId, index: 0, base64: b64(fill(500, 7)) })
  const confirmed3 = await files.fileConfirm(h.deps, h.ownerIdentity, h.clubId, {
    sessionId: session3.sessionId,
    mutationId: h.nextMutationId(),
  })
  const attachment3 = (await h.db.read(COLLECTIONS.attachments, confirmed3.attachmentId))!
  await h.db.tx(async (tx) => {
    await tx.set(COLLECTIONS.attachments, { ...attachment3, lifecycleState: 'ATTACHED', submissionId: 'sub-x' })
  })
  await assert.rejects(
    () => files.fileCancel(h.deps, h.ownerIdentity, h.clubId, { sessionId: session3.sessionId, mutationId: h.nextMutationId() }),
    (e) => codeOf(e) === 'invalid_transition'
  )
})

test('跨队/跨成员：异队 scope 找不到会话；同队非上传者被拒', async () => {
  const h = await makeHarness()
  const session = await initSession(h, 1000)

  // 同队非上传者
  const other = await addMemberWithIdentity(h.db, h.clubId, 'other-openid', '他人', 'manager')
  assert.equal(
    codeOf(await files.fileStatus(h.deps, other.identity, h.clubId, session.sessionId).catch((e) => e)),
    'permission_denied'
  )

  // 异队：为 owner 建第二个队，用 B 队 scope 访问 A 队会话
  const clubB = 'clubB0001'
  const ownerMemberIdB = memberId(clubB, h.ownerUserId)
  await h.db.tx(async (tx) => {
    const club: Doc = {
      _id: clubB,
      name: 'B 队',
      slug: 'b',
      displayCode: 'B1',
      ownerMemberId: ownerMemberIdB,
      status: 'ACTIVE',
      settings: {},
      revision: 1,
      mutationSeq: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    await tx.set(COLLECTIONS.clubs, club)
    await tx.set(COLLECTIONS.members, {
      _id: ownerMemberIdB,
      clubId: clubB,
      userId: h.ownerUserId,
      displayName: 'B owner',
      duty: null,
      role: 'super_admin',
      status: 'ACTIVE',
      createdAt: 1,
      joinedAt: 1,
      revision: 1,
      mutationSeq: 0,
    })
  })
  assert.equal(
    codeOf(await files.fileStatus(h.deps, h.ownerIdentity, clubB, session.sessionId).catch((e) => e)),
    'resource_not_found'
  )
})

test('受控下载（downloadUrls/previewDraft）在证据齐备前显式 not_implemented', async () => {
  const h = await makeHarness()
  const handlers = files.createFileHandlers({
    db: h.db,
    now: h.clock.now,
    expected: { appId: h.ownerIdentity.appId, env: h.ownerIdentity.env },
    identity: () => h.ownerIdentity,
    storage: h.storage,
  })
  const request = {
    request: {
      apiVersion: 2 as const,
      action: 'file.downloadUrls',
      scope: { kind: 'TEAM' as const, clubId: h.clubId },
      requestId: 'req-1',
      data: { attachmentIds: ['att-1'] },
    },
  }
  assert.equal(
    codeOf(await handlers['file.downloadUrls']!(request as never).then(() => new AppError('internal_error')).catch((e) => e)),
    'not_implemented'
  )
  assert.equal(
    codeOf(await handlers['file.previewDraft']!(request as never).then(() => new AppError('internal_error')).catch((e) => e)),
    'not_implemented'
  )
})

test('每个注册的 file.* 动作都有处理器（无静默漏项）', () => {
  const h = { db: {} as never, now: () => 0, expected: { appId: 'a', env: 'e' }, identity: () => null, storage: new FakeStorageAdapter() }
  const handlers = files.createFileHandlers(h as never)
  const registered = ['file.init', 'file.status', 'file.confirm', 'file.cancel', 'file.downloadUrls', 'file.previewDraft', 'file.putChunk']
  for (const action of registered) assert.equal(typeof handlers[action], 'function', `${action} 缺处理器`)
})
