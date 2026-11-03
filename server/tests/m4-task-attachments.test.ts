import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { AppError } from '../contracts/errors.ts'
import { COLLECTIONS } from '../repositories/collections.ts'
import type { StorageAdapter, StorageDeletionResult, StorageObjectRef } from '../storage/adapter.ts'
import type { StorageCapabilities } from '../storage/capabilities.ts'
import * as files from '../modules/files/index.ts'
import * as tasks from '../modules/tasks/index.ts'
import { addMemberWithIdentity, mutationFactory, seedTeam, type SeedResult } from './helpers.ts'

/**
 * 附件绑定到任务交付（task.submit）。
 * 替身层：内存数据库 + 内存存储；不代表真实云鉴权/真实字节传输。
 */

class FakeStorage implements StorageAdapter {
  private objects = new Map<string, Uint8Array>()
  private byFileID = new Map<string, string>()

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
    this.objects.set(objectPath, new Uint8Array(bytes))
    const fileID = this.fileIdForPath(objectPath)
    this.byFileID.set(fileID, objectPath)
    return { fileID }
  }

  async downloadObject(fileID: string): Promise<Uint8Array> {
    const path = this.byFileID.get(fileID)
    const bytes = path ? this.objects.get(path) : undefined
    if (!bytes) throw new AppError('attachment_not_ready', '替身层：对象不存在')
    return new Uint8Array(bytes)
  }

  async deleteObjects(fileIDs: string[]): Promise<StorageDeletionResult[]> {
    return fileIDs.map((fileID) => ({ fileID, status: 0 }))
  }

  fileIdForPath(objectPath: string): string {
    return `cloud://test-env.test-bucket/${objectPath}`
  }
}

function b64(size: number, value = 5): string {
  return Buffer.from(new Uint8Array(size).fill(value)).toString('base64')
}

function codeOf(error: unknown): string | undefined {
  return error instanceof AppError ? error.code : undefined
}

interface Harness extends SeedResult {
  filesDeps: files.FilesDeps
  taskId: string
  revision: number
  nextMutationId: () => string
}

async function makeHarness(): Promise<Harness> {
  const seed = await seedTeam()
  const taskDeps = { db: seed.db, now: seed.clock.now }
  const nextMutationId = mutationFactory(seed.clock)
  const created = await tasks.createTask(taskDeps, seed.ownerIdentity, seed.clubId, {
    title: '交片',
    description: '交原片',
      category: 'content',
    mutationId: nextMutationId(),
  })
  const claimed = await tasks.claimTask(taskDeps, seed.ownerIdentity, seed.clubId, {
    taskId: created.taskId,
    expectedRevision: created.revision,
    mutationId: nextMutationId(),
  })
  return {
    ...seed,
    filesDeps: { db: seed.db, now: seed.clock.now, storage: new FakeStorage() },
    taskId: created.taskId,
    revision: claimed.revision,
    nextMutationId,
  }
}

async function upload(h: Harness, size = 1000, name = 'a.pdf'): Promise<string> {
  const session = await files.fileInit(h.filesDeps, h.ownerIdentity, h.clubId, {
    taskId: h.taskId,
    expectedTaskRevision: h.revision,
    name,
    declaredSize: size,
    mutationId: h.nextMutationId(),
  })
  await files.putChunk(h.filesDeps, h.ownerIdentity, h.clubId, {
    sessionId: session.sessionId,
    index: 0,
    base64: b64(size),
  })
  const attachment = await files.fileConfirm(h.filesDeps, h.ownerIdentity, h.clubId, {
    sessionId: session.sessionId,
    mutationId: h.nextMutationId(),
  })
  return attachment.attachmentId
}

function submit(h: Harness, attachmentIds: string[], mutationId = h.nextMutationId(), note = '完成') {
  return tasks.submitTask({ db: h.db, now: h.clock.now }, h.ownerIdentity, h.clubId, {
    taskId: h.taskId,
    note,
    attachmentIds,
    expectedRevision: h.revision,
    mutationId,
  })
}

async function mutate(h: Harness, collection: string, id: string, patch: Record<string, unknown>) {
  const doc = (await h.db.read(collection, id))!
  await h.db.tx(async (tx) => {
    await tx.set(collection, { ...doc, ...patch })
  })
}

test('0 附件：提交成功且 attachmentIds=[]（回归）', async () => {
  const h = await makeHarness()
  const result = await submit(h, [])
  assert.equal(result.task.status, 'SUBMITTED')
  assert.deepEqual(result.submission.attachmentIds, [])
})

test('绑定 2 个 VERIFIED 附件：ATTACHED、batch CLOSED、task revision 只 +1', async () => {
  const h = await makeHarness()
  const ids = [await upload(h, 1000, 'a.pdf'), await upload(h, 1200, 'b.pdf')]
  const result = await submit(h, ids)
  assert.equal(result.task.status, 'SUBMITTED')
  assert.equal(result.task.revision, h.revision + 1)
  assert.deepEqual(result.submission.attachmentIds, ids)
  assert.equal(result.submission.round, 1)

  for (const id of ids) {
    const attachment = (await h.db.read(COLLECTIONS.attachments, id))!
    assert.equal(attachment.lifecycleState, 'ATTACHED')
    assert.equal(attachment.submissionId, result.submission.submissionId)
  }
  const batchId = createHash('sha256')
    .update(JSON.stringify(['rak-batch-v1', h.clubId, h.taskId, 1]))
    .digest('hex')
  const batch = (await h.db.read(COLLECTIONS.uploadBatches, batchId))!
  assert.equal(batch.state, 'CLOSED')
})

test('部分选中：未选槽位会话 CANCELLED、草稿附件 GC_PENDING', async () => {
  const h = await makeHarness()
  const keep = await upload(h, 1000, 'keep.pdf')
  const drop = await upload(h, 1000, 'drop.pdf')
  const result = await submit(h, [keep])
  assert.deepEqual(result.submission.attachmentIds, [keep])

  const dropped = (await h.db.read(COLLECTIONS.attachments, drop))!
  assert.equal(dropped.lifecycleState, 'GC_PENDING')
  const droppedSession = (await h.db.read(COLLECTIONS.uploadSessions, dropped.sessionId as string))!
  assert.equal(droppedSession.state, 'CANCELLED')
  assert.equal(droppedSession.fence, 1)
})

test('拒绝：跨队/跨任务/他人上传 → attachment_forbidden 且不落库', async () => {
  const h = await makeHarness()
  const att = await upload(h)

  await mutate(h, COLLECTIONS.attachments, att, { clubId: 'club-other' })
  assert.equal(codeOf(await submit(h, [att]).catch((e) => e)), 'attachment_forbidden')

  await mutate(h, COLLECTIONS.attachments, att, { clubId: h.clubId, taskId: 'task-other' })
  assert.equal(codeOf(await submit(h, [att]).catch((e) => e)), 'attachment_forbidden')

  await mutate(h, COLLECTIONS.attachments, att, { taskId: h.taskId, uploadedByMemberId: 'member-other' })
  assert.equal(codeOf(await submit(h, [att]).catch((e) => e)), 'attachment_forbidden')

  await mutate(h, COLLECTIONS.attachments, att, { uploadedByMemberId: h.ownerMemberId })
  const task = (await h.db.read(COLLECTIONS.tasks, h.taskId))!
  assert.equal(task.status, 'CLAIMED', '失败提交不得改变任务状态')
  assert.equal(task.revision, h.revision)
})

test('拒绝：未 VERIFIED / 非 DRAFT / 会话未确认', async () => {
  const h = await makeHarness()
  const att = await upload(h)
  const attachment = (await h.db.read(COLLECTIONS.attachments, att))!

  await mutate(h, COLLECTIONS.attachments, att, { integrityState: 'PENDING' })
  assert.equal(codeOf(await submit(h, [att]).catch((e) => e)), 'attachment_not_ready')

  await mutate(h, COLLECTIONS.attachments, att, { integrityState: 'VERIFIED', lifecycleState: 'ATTACHED' })
  assert.equal(codeOf(await submit(h, [att]).catch((e) => e)), 'attachment_forbidden')

  await mutate(h, COLLECTIONS.attachments, att, { lifecycleState: 'DRAFT' })
  await mutate(h, COLLECTIONS.uploadSessions, attachment.sessionId as string, { state: 'CANCELLED' })
  assert.equal(codeOf(await submit(h, [att]).catch((e) => e)), 'attachment_not_ready')
})

test('拒绝：附件已过期 → upload_expired', async () => {
  const h = await makeHarness()
  const att = await upload(h)
  h.clock.advance(25 * 60 * 60 * 1000)
  assert.equal(codeOf(await submit(h, [att]).catch((e) => e)), 'upload_expired')
})

test('拒绝：附件安全扫描状态未知或被阻断', async () => {
  const h = await makeHarness()
  const att = await upload(h)
  await mutate(h, COLLECTIONS.attachments, att, { scanState: 'BLOCKED' })
  assert.equal(codeOf(await submit(h, [att]).catch((e) => e)), 'attachment_not_ready')
  await mutate(h, COLLECTIONS.attachments, att, { scanState: 'UNKNOWN' })
  assert.equal(codeOf(await submit(h, [att]).catch((e) => e)), 'attachment_not_ready')
})

test('拒绝：会话不在本轮批次 → attachment_forbidden', async () => {
  const h = await makeHarness()
  const att = await upload(h)
  const attachment = (await h.db.read(COLLECTIONS.attachments, att))!
  await mutate(h, COLLECTIONS.uploadSessions, attachment.sessionId as string, { targetRound: 2 })
  assert.equal(codeOf(await submit(h, [att]).catch((e) => e)), 'attachment_forbidden')
})

test('拒绝：重复 id / 超过 3 个 / 空 id → validation_failed', async () => {
  const h = await makeHarness()
  assert.equal(codeOf(await submit(h, ['att-1', 'att-1']).catch((e) => e)), 'validation_failed')
  assert.equal(codeOf(await submit(h, ['a', 'b', 'c', 'd']).catch((e) => e)), 'validation_failed')
  assert.equal(codeOf(await submit(h, ['']).catch((e) => e)), 'validation_failed')
})

test('拒绝：无批次却传 id → attachment_forbidden', async () => {
  const h = await makeHarness()
  assert.equal(codeOf(await submit(h, ['att-x']).catch((e) => e)), 'attachment_forbidden')
})

test('幂等：同 mutationId 重放返回同一提交且不重复绑定', async () => {
  const h = await makeHarness()
  const att = await upload(h)
  const mutationId = h.nextMutationId()
  const first = await submit(h, [att], mutationId)
  const replay = await submit(h, [att], mutationId)
  assert.equal(replay.submission.submissionId, first.submission.submissionId)
  assert.equal(replay.task.revision, first.task.revision)
  const attachment = (await h.db.read(COLLECTIONS.attachments, att))!
  assert.equal(attachment.lifecycleState, 'ATTACHED')
})

test('多人视角：非负责人提交带附件被拒', async () => {
  const h = await makeHarness()
  const att = await upload(h)
  const other = await addMemberWithIdentity(h.db, h.clubId, 'other-openid', '他人', 'member')
  const error = await tasks
    .submitTask({ db: h.db, now: h.clock.now }, other.identity, h.clubId, {
      taskId: h.taskId,
      note: 'x',
      attachmentIds: [att],
      expectedRevision: h.revision,
      mutationId: h.nextMutationId(),
    })
    .catch((e) => e)
  assert.equal(codeOf(error), 'permission_denied')
})
