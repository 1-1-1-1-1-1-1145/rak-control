import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CHUNK_BYTES,
  MAX_ATTACHMENT_BYTES,
  MAX_CONCURRENCY,
  collectAttachmentIds,
  planChunks,
  uploadTaskAttachment,
  type AttachmentSummary,
  type AttachmentTransport,
  type ChunkSource,
  type UploadSession,
} from '../src/utils/attachment-upload.ts'

/**
 * 客户端分片上传编排用例（PLAN §M5；协议 = function-chunks-v1）。
 *
 * 纯逻辑替身：不触网、不读真实文件系统。真实字节与真机在 M8/M9。
 */

function session(overrides: Partial<UploadSession> = {}): UploadSession {
  const size = overrides.declaredSize ?? 1000
  const planned = planChunks(size)
  return {
    sessionId: 'ups-1',
    declaredSize: size,
    chunkBytes: CHUNK_BYTES,
    totalChunks: planned.length,
    uploadExpiresAt: new Date(0).toISOString(),
    missingIndexes: [],
    ...overrides,
  }
}

interface Recorder {
  calls: string[]
  putIndexes: number[]
  maxInFlight: number
  confirmCalled: boolean
  cancelCalled: boolean
}

function makeTransport(opts: {
  sessionOverrides?: Partial<UploadSession>
  statusMissing?: number[]
  failIndex?: number
  confirmError?: string
} = {}): { transport: AttachmentTransport; rec: Recorder } {
  const rec: Recorder = { calls: [], putIndexes: [], maxInFlight: 0, confirmCalled: false, cancelCalled: false }
  let inFlight = 0
  const transport: AttachmentTransport = {
    async init(input) {
      rec.calls.push('init')
      // 默认回显调用方声明的大小（除非用例显式给出不一致的覆盖值）
      return session({ declaredSize: input.declaredSize, ...opts.sessionOverrides })
    },
    async putChunk(input) {
      rec.calls.push(`put:${input.index}`)
      rec.putIndexes.push(input.index)
      inFlight += 1
      rec.maxInFlight = Math.max(rec.maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      if (opts.failIndex === input.index) throw new Error('putChunk 失败')
      return { index: input.index, size: input.base64.length, sha256: 'x' }
    },
    async status() {
      rec.calls.push('status')
      return session({ ...opts.sessionOverrides, missingIndexes: opts.statusMissing ?? [] })
    },
    async confirm() {
      rec.calls.push('confirm')
      rec.confirmCalled = true
      if (opts.confirmError) throw new Error(opts.confirmError)
      const result: AttachmentSummary = {
        attachmentId: 'att-1',
        name: 'a.bin',
        size: 1000,
        sha256: 'deadbeef',
        integrityState: 'VERIFIED',
        scanState: 'NOT_CONFIGURED',
        lifecycleState: 'DRAFT',
      }
      return result
    },
    async cancel() {
      rec.calls.push('cancel')
      rec.cancelCalled = true
    },
  }
  return { transport, rec }
}

function makeSource(readError = false): ChunkSource {
  return {
    async readBase64(_offset: number, length: number) {
      if (readError) throw new Error('读取失败')
      return 'A'.repeat(Math.ceil(length / 3) * 4)
    },
  }
}

test('planChunks：分片数学（含边界与超限拒绝）', () => {
  assert.deepEqual(planChunks(1), [{ index: 0, offset: 0, length: 1 }])
  assert.equal(planChunks(CHUNK_BYTES).length, 1)
  const two = planChunks(CHUNK_BYTES + 1)
  assert.equal(two.length, 2)
  assert.deepEqual(two[1], { index: 1, offset: CHUNK_BYTES, length: 1 })
  const full = planChunks(MAX_ATTACHMENT_BYTES)
  assert.equal(full.length, 40)
  assert.equal(full[39].length, CHUNK_BYTES)
  assert.throws(() => planChunks(0), /附件大小需在/)
  assert.throws(() => planChunks(MAX_ATTACHMENT_BYTES + 1), /附件大小需在/)
})

test('编排：init → 全部分片 → status 对账 → confirm，并发受限且不新占资源', async () => {
  const { transport, rec } = makeTransport({ sessionOverrides: { declaredSize: CHUNK_BYTES + 500 } })
  const progress: number[] = []
  const result = await uploadTaskAttachment({
    taskId: 'task-1',
    expectedTaskRevision: 3,
    name: 'a.bin',
    size: CHUNK_BYTES + 500,
    transport,
    source: makeSource(),
    onProgress: (done) => progress.push(done),
  })
  assert.equal(result.integrityState, 'VERIFIED')
  assert.equal(result.sessionId, 'ups-1')
  assert.equal(rec.calls[0], 'init')
  assert.deepEqual([...rec.putIndexes].sort((a, b) => a - b), [0, 1])
  assert.equal(rec.putIndexes.length, 2, '每个分片只提交一次')
  assert.deepEqual(rec.calls.slice(-2), ['status', 'confirm'])
  assert.ok(rec.maxInFlight <= MAX_CONCURRENCY, `并发不得超过 ${MAX_CONCURRENCY}`)
  assert.deepEqual(progress.sort((a, b) => a - b), [1, 2])
  assert.equal(rec.cancelCalled, false)
})

test('分片失败：重试一次后仍失败 → 取消并显式抛出，且不进入确认', async () => {
  const { transport, rec } = makeTransport({ failIndex: 0 })
  const attempts = () => rec.putIndexes.filter((i) => i === 0).length
  await assert.rejects(
    () =>
      uploadTaskAttachment({
        taskId: 'task-1',
        expectedTaskRevision: 3,
        name: 'a.bin',
        size: 500,
        transport,
        source: makeSource(),
      }),
    /putChunk 失败/
  )
  assert.equal(attempts(), 2, '同片重试一次（幂等，不新占资源）')
  assert.equal(rec.cancelCalled, true)
  assert.equal(rec.confirmCalled, false, '失败不得伪造成功')
})

test('status 对账发现缺片 → 取消并抛出，不进入确认', async () => {
  const { transport, rec } = makeTransport({ statusMissing: [2] })
  await assert.rejects(
    () =>
      uploadTaskAttachment({
        taskId: 'task-1',
        expectedTaskRevision: 3,
        name: 'a.bin',
        size: 500,
        transport,
        source: makeSource(),
      }),
    /分片未全部就绪/
  )
  assert.equal(rec.cancelCalled, true)
  assert.equal(rec.confirmCalled, false)
})

test('服务端回显与本地计划不一致（分片长度/总数/大小）→ 拒绝继续', async () => {
  const cases: Array<Partial<UploadSession>> = [
    { chunkBytes: 1024 },
    { totalChunks: 99 },
    { declaredSize: 7 },
  ]
  for (const sessionOverrides of cases) {
    const { transport, rec } = makeTransport({ sessionOverrides: { declaredSize: 500, ...sessionOverrides } })
    await assert.rejects(
      () =>
        uploadTaskAttachment({
          taskId: 'task-1',
          expectedTaskRevision: 3,
          name: 'a.bin',
          size: 500,
          transport,
          source: makeSource(),
        }),
      /不一致/
    )
    assert.deepEqual(rec.putIndexes, [], '契约不符时不得开始上传')
    assert.equal(rec.confirmCalled, false)
  }
})

test('读取文件失败 → 取消并抛出', async () => {
  const { transport, rec } = makeTransport()
  await assert.rejects(
    () =>
      uploadTaskAttachment({
        taskId: 'task-1',
        expectedTaskRevision: 3,
        name: 'a.bin',
        size: 500,
        transport,
        source: makeSource(true),
      }),
    /读取失败/
  )
  assert.equal(rec.cancelCalled, true)
  assert.equal(rec.confirmCalled, false)
})

test('大小超限在编排前即拒绝（不发起任何调用）', async () => {
  const { transport, rec } = makeTransport()
  await assert.rejects(
    () =>
      uploadTaskAttachment({
        taskId: 'task-1',
        expectedTaskRevision: 3,
        name: 'a.bin',
        size: MAX_ATTACHMENT_BYTES + 1,
        transport,
        source: makeSource(),
      }),
    /附件大小需在/
  )
  assert.deepEqual(rec.calls, [])
})

test('collectAttachmentIds：只收集 READY，UPLOADING/FAILED 阻断', () => {
  assert.deepEqual(collectAttachmentIds([]), { ids: [], blocker: null })
  assert.deepEqual(
    collectAttachmentIds([
      { status: 'READY', attachmentId: 'att-1' },
      { status: 'READY', attachmentId: 'att-2' },
    ]),
    { ids: ['att-1', 'att-2'], blocker: null }
  )
  assert.deepEqual(collectAttachmentIds([{ status: 'UPLOADING' }]), { ids: [], blocker: 'UPLOADING' })
  assert.deepEqual(collectAttachmentIds([{ status: 'FAILED' }]), { ids: [], blocker: 'FAILED' })
  assert.deepEqual(collectAttachmentIds([{ status: 'READY' }]), { ids: [], blocker: 'FAILED' })
  assert.deepEqual(
    collectAttachmentIds([{ status: 'UPLOADING' }, { status: 'FAILED' }]),
    { ids: [], blocker: 'UPLOADING' }
  )
})
