# 任务附件上传打通（上传 + 提交绑定）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让云模式下任务负责人选择文件后立即分片上传，并在 `task.submit` 事务内把 0..3 个已校验附件绑定到本轮交付。

**Architecture:** 复用既有 `function-chunks-v1` 上传链路（前端 `src/utils/attachment-upload.ts` → `rakFiles`），只补「选择即上传」的页面接线与 `task.submit` 的绑定事务；同时补两处可用性缺口：允许取消已确认未交付会话、`file.init` 回收过期槽位。

**Tech Stack:** Taro 4 + React 18 + MobX；Node 20 云函数（wx-server-sdk 4.0.2）；内存数据库/存储替身做单测；PowerShell 5.1。

**规范真源：** `docs/superpowers/specs/2026-10-18-task-attachment-upload-design.md`（已获用户批准，含 D1/D2/D3）。

**用户约束（必须遵守）：**
- 不执行 `git add` / `git commit` / `git reset`；每个任务以门禁命令通过作为完成标志。
- 不索要/不打印密钥；云写入（部署）必须逐次获得用户授权。
- 真实云/真机未执行的项一律标 **NOT_RUN**，不得以本地替身结果替代。

---

## 文件结构

| 文件 | 动作 | 责任 |
|---|---|---|
| `server/modules/files/index.ts` | 修改 | D1 放宽 `file.cancel`；D2 在 `file.init` 回收过期/作废槽位 |
| `server/modules/tasks/index.ts` | 修改 | `task.submit` 附件校验、绑定、未选槽位清理、批次封闭 |
| `server/tests/m5-files-chunks.test.ts` | 修改 | D1/D2 用例 |
| `server/tests/m4-task-attachments.test.ts` | 新建 | 绑定 happy path + 拒绝矩阵 + 幂等 |
| `server/tests/m4-tasks.test.ts` | 修改 | 删除「附件 = not_implemented」旧用例 |
| `src/utils/attachment-upload.ts` | 修改 | 返回 `sessionId`；新增 `collectAttachmentIds` |
| `tests/attachment-upload.test.ts` | 修改 | 新增纯函数用例 + `sessionId` 断言 |
| `src/types/domain.ts` | 修改 | `Task` 增加可选 `revision` |
| `src/services/cloud/legacy-view.ts` | 修改 | `toLegacyTask` 透出 `revision` |
| `src/store/index.ts` | 修改 | `TaskStore.submit` 接收 `cloudAttachmentIds` |
| `src/pages/task/detail.tsx` | 修改 | 附件三态、选择即上传、移除/离开取消、提交校验 |
| `docs/verification/m8-execution-log-2026-10-18.md` | 修改 | 追加 §30 执行记录 |
| `docs/verification/cloudbase-capabilities-2026-10-17.md` | 修改 | 记录本轮函数重新部署与资源变更 |

---

## Task 1: D1 — 允许取消「已确认但未交付」的附件会话

**Files:**
- Modify: `server/modules/files/index.ts:559-562`
- Test: `server/tests/m5-files-chunks.test.ts:309-336`

- [ ] **Step 1: 改测试（先写失败用例）**

把 `server/tests/m5-files-chunks.test.ts` 的 L309-336 整段替换为：

```ts
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
```

- [ ] **Step 2: 运行测试，确认失败**

```powershell
node --experimental-strip-types --test server/tests/m5-files-chunks.test.ts
```

预期：包含 `否：已确认未交付可取消` 的用例 FAIL（当前 `file.cancel` 对任何 `CONFIRMED` 都抛 `invalid_transition`）。

- [ ] **Step 3: 修改实现**

`server/modules/files/index.ts` 中 `fileCancel` 事务内，把：

```ts
      const fence = ((session.fence as number) ?? 0) + 1
      if (session.state === 'CONFIRMED') {
        throw new AppError('invalid_transition', '已确认的附件不可取消')
      }
```

替换为：

```ts
      const fence = ((session.fence as number) ?? 0) + 1
      if (session.state === 'CONFIRMED') {
        // 已确认但尚未被任何交付绑定：允许丢弃（释放批次槽位）
        const attachment =
          typeof session.attachmentId === 'string'
            ? await tx.get(COLLECTIONS.attachments, session.attachmentId)
            : null
        const discardable =
          attachment !== null && attachment.lifecycleState === 'DRAFT' && !attachment.submissionId
        if (!discardable) throw new AppError('invalid_transition', '已交付的附件不可取消')
      }
```

- [ ] **Step 4: 运行测试，确认通过**

```powershell
node --experimental-strip-types --test server/tests/m5-files-chunks.test.ts
```

预期：全部 PASS。

---

## Task 2: D2 — `file.init` 回收过期/作废批次槽位

**Files:**
- Modify: `server/modules/files/index.ts:278-293`
- Test: `server/tests/m5-files-chunks.test.ts`（在 init 用例后新增）

- [ ] **Step 1: 写失败测试**

在 `server/tests/m5-files-chunks.test.ts` 的 `test('init 的授权：…')` 之后新增：

```ts
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
```

- [ ] **Step 2: 运行测试，确认失败**

```powershell
node --experimental-strip-types --test server/tests/m5-files-chunks.test.ts
```

预期：新用例 FAIL（回收未实现，`initSession` 仍抛 `validation_failed`）。

- [ ] **Step 3: 修改实现**

`server/modules/files/index.ts` 的 `fileInit` 中，把：

```ts
      const slots = (batch.slots as BatchSlot[] | undefined) ?? emptySlots()
      if (slots.filter((slot) => slot.state === 'OCCUPIED').length >= MAX_ATTACHMENTS) {
```

替换为：

```ts
      let slots = (batch.slots as BatchSlot[] | undefined) ?? emptySlots()
      // 回收过期/作废占位：否则放弃上传后本批会在 TTL 内无法继续添加
      for (const slot of [...slots]) {
        if (slot.state !== 'OCCUPIED' || typeof slot.sessionId !== 'string') continue
        const session = await tx.get(COLLECTIONS.uploadSessions, slot.sessionId)
        let release = false
        if (!session || session.state === 'CANCELLED' || session.state === 'EXPIRED') {
          release = true
        } else if (
          (session.state === 'DRAFT' || session.state === 'UPLOADING') &&
          typeof session.uploadExpiresAt === 'number' &&
          now > session.uploadExpiresAt
        ) {
          const totalChunks = (session.totalChunks as number) ?? 0
          for (let i = 0; i < totalChunks; i += 1) {
            const chunk = await tx.get(COLLECTIONS.uploadChunks, chunkDocId(clubId, slot.sessionId, i))
            if (chunk) await tx.set(COLLECTIONS.uploadChunks, { ...chunk, state: 'GC_PENDING', updatedAt: now })
          }
          await tx.set(COLLECTIONS.uploadSessions, {
            ...session,
            state: 'EXPIRED',
            fence: ((session.fence as number) ?? 0) + 1,
            updatedAt: now,
          })
          release = true
        } else if (session.state === 'CONFIRMED' && typeof session.attachmentId === 'string') {
          const attachment = await tx.get(COLLECTIONS.attachments, session.attachmentId)
          const expired =
            attachment !== null &&
            typeof attachment.confirmedUntil === 'number' &&
            now > attachment.confirmedUntil
          if (attachment && attachment.lifecycleState === 'DRAFT' && expired) {
            await tx.set(COLLECTIONS.attachments, { ...attachment, lifecycleState: 'GC_PENDING', updatedAt: now })
            await tx.set(COLLECTIONS.uploadSessions, {
              ...session,
              state: 'EXPIRED',
              fence: ((session.fence as number) ?? 0) + 1,
              updatedAt: now,
            })
            release = true
          }
        }
        if (release) {
          slots = slots.map((item) =>
            item.index === slot.index ? { ...item, sessionId: null, state: 'EMPTY' as const } : item
          )
        }
      }
      if (slots.filter((slot) => slot.state === 'OCCUPIED').length >= MAX_ATTACHMENTS) {
```

注意：后续 `nextSlots` 的计算与 `tx.set` 使用 `slots`（已被回收修正），`revision` 保持既有 `existing ? +1 : 1` 逻辑不变。

- [ ] **Step 4: 运行测试，确认通过**

```powershell
node --experimental-strip-types --test server/tests/m5-files-chunks.test.ts
```

预期：全部 PASS（含既有 init/confirm/cancel 用例）。

---

## Task 3: `task.submit` 事务内绑定附件

**Files:**
- Modify: `server/modules/tasks/index.ts:301-413`
- Modify: `server/tests/m4-tasks.test.ts:143-165`（删除旧用例）
- Test: `server/tests/m4-task-attachments.test.ts`（新建）

- [ ] **Step 1: 删除旧断言**

删除 `server/tests/m4-tasks.test.ts` L143-165 整个 `test('带附件交付在 M5 前明确 not_implemented（不静默忽略）', …)` 块（0 附件路径已由其他用例覆盖）。

- [ ] **Step 2: 写新测试文件（先失败）**

新建 `server/tests/m4-task-attachments.test.ts`：

```ts
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { AppError } from '../contracts/errors.ts'
import { COLLECTIONS } from '../repositories/collections.ts'
import type { Doc } from '../repositories/store.ts'
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
    category: 'photo',
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

test('拒绝：未 VERIFIED / 非 DRAFT / 会话未确认 → attachment_not_ready', async () => {
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
```

- [ ] **Step 3: 运行测试，确认失败**

```powershell
node --experimental-strip-types --test server/tests/m4-task-attachments.test.ts
```

预期：除「0 附件」「重复/超限」「无批次」「非负责人」外，其余 FAIL（当前一律 `not_implemented`）。

- [ ] **Step 4: 修改实现**

在 `server/modules/tasks/index.ts` 顶部 import 区加入：

```ts
import { MAX_ATTACHMENTS } from '../files/index.ts'
```

在 `TasksDeps` 下方新增：

```ts
interface BatchSlot {
  index: number
  sessionId: string | null
  state: 'EMPTY' | 'OCCUPIED'
}
```

把 `submitTask` 从 `const now = deps.now()` 到函数末尾整段替换为：

```ts
  const now = deps.now()
  const attachments = Array.isArray(input.attachmentIds) ? input.attachmentIds : []
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new AppError('validation_failed', `附件最多 ${MAX_ATTACHMENTS} 个`)
  }
  if (attachments.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new AppError('validation_failed', '附件 id 非法')
  }
  if (new Set(attachments).size !== attachments.length) {
    throw new AppError('validation_failed', '附件重复')
  }

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: actorIdentityId(trusted),
      action: 'task.submit',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data: { taskId: input.taskId, note: input.note, attachmentIds: attachments, targetRound: input.targetRound ?? null },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      const task = await tx.get(COLLECTIONS.tasks, input.taskId)
      if (!task || task.clubId !== clubId) throw new AppError('resource_not_found')
      if ((task.revision as number) !== input.expectedRevision) throw new AppError('revision_conflict')
      if (task.status !== 'CLAIMED' && task.status !== 'REJECTED') {
        throw new AppError('invalid_transition', '当前状态不可交付')
      }
      if (task.assigneeMemberId !== tenant.member._id) {
        throw new AppError('permission_denied', '仅当前负责人可交付')
      }

      const round = ((task.currentRound as number) ?? 0) + 1
      if (input.targetRound !== undefined && input.targetRound !== round) {
        throw new AppError('revision_conflict', 'targetRound 与当前任务轮次不符')
      }

      const submissionId = randomId('sub')
      const batchId = sha256Hex(JSON.stringify(['rak-batch-v1', clubId, input.taskId, round]))
      const batch = await tx.get(COLLECTIONS.uploadBatches, batchId)
      const slots = (batch?.slots as BatchSlot[] | undefined) ?? []
      const slotSessionIds = new Set<string>()
      for (const slot of slots) {
        if (slot.state === 'OCCUPIED' && typeof slot.sessionId === 'string') slotSessionIds.add(slot.sessionId)
      }

      // 先完成全部附件校验（任一失败 → 整个事务回滚，不产生"绑了一半"）
      const selectedSessions = new Set<string>()
      if (attachments.length > 0) {
        if (!batch || batch.state !== 'OPEN') {
          throw new AppError('attachment_forbidden', '本轮附件批次不存在或已封闭')
        }
        for (const attachmentId of attachments) {
          const attachment = await tx.get(COLLECTIONS.attachments, attachmentId)
          if (!attachment || attachment.clubId !== clubId || attachment.taskId !== input.taskId) {
            throw new AppError('attachment_forbidden', '附件不属于本任务')
          }
          if (attachment.uploadedByMemberId !== tenant.member._id) {
            throw new AppError('attachment_forbidden', '只能绑定本人上传的附件')
          }
          if (attachment.integrityState !== 'VERIFIED') {
            throw new AppError('attachment_not_ready', '附件尚未完成校验')
          }
          if (attachment.lifecycleState !== 'DRAFT') {
            throw new AppError('attachment_forbidden', '附件已被其他交付绑定或待回收')
          }
          const confirmedUntil = attachment.confirmedUntil
          if (typeof confirmedUntil !== 'number' || now > confirmedUntil) {
            throw new AppError('upload_expired', '附件已过期，请重新上传')
          }
          const sessionId = attachment.sessionId as string
          const session = await tx.get(COLLECTIONS.uploadSessions, sessionId)
          if (!session || session.clubId !== clubId || session.taskId !== input.taskId) {
            throw new AppError('attachment_forbidden', '附件会话不属于本任务')
          }
          if (session.state !== 'CONFIRMED' || session.attachmentId !== attachmentId) {
            throw new AppError('attachment_not_ready', '附件会话尚未确认')
          }
          if ((session.targetRound as number) !== round || !slotSessionIds.has(sessionId)) {
            throw new AppError('attachment_forbidden', '附件不在本轮批次内')
          }
          selectedSessions.add(sessionId)
        }
      }

      // 绑定选中附件
      for (const attachmentId of attachments) {
        const attachment = (await tx.get(COLLECTIONS.attachments, attachmentId)) as Doc
        await tx.set(COLLECTIONS.attachments, {
          ...attachment,
          lifecycleState: 'ATTACHED',
          submissionId,
          updatedAt: now,
        })
      }

      // 未选中的槽位：终结会话 + 未交付附件转 GC_PENDING；随后封闭批次
      if (batch && batch.state !== 'CLOSED') {
        for (const slot of slots) {
          const sessionId = typeof slot.sessionId === 'string' ? slot.sessionId : null
          if (!sessionId || selectedSessions.has(sessionId)) continue
          const session = await tx.get(COLLECTIONS.uploadSessions, sessionId)
          if (!session) continue
          if (session.state !== 'CANCELLED') {
            await tx.set(COLLECTIONS.uploadSessions, {
              ...session,
              state: 'CANCELLED',
              fence: ((session.fence as number) ?? 0) + 1,
              updatedAt: now,
            })
          }
          if (typeof session.attachmentId === 'string') {
            const attachment = await tx.get(COLLECTIONS.attachments, session.attachmentId)
            if (attachment && attachment.lifecycleState === 'DRAFT') {
              await tx.set(COLLECTIONS.attachments, { ...attachment, lifecycleState: 'GC_PENDING', updatedAt: now })
            }
          }
        }
        await tx.set(COLLECTIONS.uploadBatches, {
          ...batch,
          state: 'CLOSED',
          revision: ((batch.revision as number) ?? 0) + 1,
          updatedAt: now,
        })
      }

      const submission: Doc = {
        _id: submissionId,
        clubId,
        taskId: input.taskId,
        round,
        submittedByMemberId: tenant.member._id,
        note: input.note,
        attachmentIds: attachments,
        taskRevisionAtSubmit: task.revision,
        status: 'SUBMITTED',
        reviewGrade: null,
        reviewNote: null,
        reviewedByMemberId: null,
        reviewedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.taskSubmissions, submission)

      const next: Doc = {
        ...task,
        status: 'SUBMITTED',
        submittedAt: now,
        currentRound: round,
        lastSubmissionId: submissionId,
        revision: (task.revision as number) + 1,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.tasks, next)
      await bumpClubFence(tx, tenant.club, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'task.submit',
        resourceType: 'submission',
        resourceId: submissionId,
        seed: input.mutationId,
        now,
      })
      return { task: toTaskView(next), submission: toSubmissionView(submission) }
    }
  )
  return run.result
}
```

同时把文件顶部注释中「有 attachmentIds 时明确报 not_implemented」改为「有 attachmentIds 时在提交事务内校验并绑定（DRAFT→ATTACHED）」。

- [ ] **Step 5: 运行测试，确认通过**

```powershell
node --experimental-strip-types --test server/tests/m4-task-attachments.test.ts
node --experimental-strip-types --test server/tests/m4-tasks.test.ts
node --experimental-strip-types --test server/tests/m5-files-chunks.test.ts
```

预期：三个文件全部 PASS。

- [ ] **Step 6: 服务端全量回归**

```powershell
corepack pnpm test:server
corepack pnpm exec tsc -p server/tsconfig.json --noEmit
```

预期：测试 0 fail；tsc 0 error。

---

## Task 4: 前端纯逻辑 — `sessionId` 返回与 `collectAttachmentIds`

**Files:**
- Modify: `src/utils/attachment-upload.ts:51-59,111-146`
- Test: `tests/attachment-upload.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/attachment-upload.test.ts` 的 import 中加入 `collectAttachmentIds` 与 `UploadedAttachment`（类型不需要单独导入）：

```ts
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
```

在「编排：init → 全部分片 → status 对账 → confirm」用例的断言中追加：

```ts
  assert.equal(result.sessionId, 'ups-1')
```

在文件末尾新增：

```ts
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
```

- [ ] **Step 2: 运行测试，确认失败**

```powershell
node --experimental-strip-types --test tests/attachment-upload.test.ts
```

预期：编译/导入失败（`collectAttachmentIds` 未导出）或断言失败（无 `sessionId`）。

- [ ] **Step 3: 实现**

在 `src/utils/attachment-upload.ts` 的 `AttachmentSummary` 之后加入：

```ts
/** 已发布附件 + 会话 id（移除/离开页面时需要取消会话释放槽位）。 */
export interface UploadedAttachment extends AttachmentSummary {
  sessionId: string
}

export interface AttachmentRowState {
  status: 'UPLOADING' | 'READY' | 'FAILED'
  attachmentId?: string
}

/**
 * 提交前的唯一附件集合出口：只收集 READY；存在 UPLOADING/FAILED 时返回阻断原因。
 * READY 缺 attachmentId 视为 FAILED（防御内部状态不一致）。
 */
export function collectAttachmentIds(rows: AttachmentRowState[]): {
  ids: string[]
  blocker: 'UPLOADING' | 'FAILED' | null
} {
  if (rows.some((row) => row.status === 'UPLOADING')) return { ids: [], blocker: 'UPLOADING' }
  if (rows.some((row) => row.status === 'FAILED')) return { ids: [], blocker: 'FAILED' }
  const ids: string[] = []
  for (const row of rows) {
    if (typeof row.attachmentId !== 'string' || row.attachmentId.length === 0) {
      return { ids: [], blocker: 'FAILED' }
    }
    ids.push(row.attachmentId)
  }
  return { ids, blocker: null }
}
```

把 `uploadTaskAttachment` 的返回类型改为 `Promise<UploadedAttachment>`，并把末尾：

```ts
  return input.transport.confirm(session.sessionId)
```

替换为：

```ts
  const summary = await input.transport.confirm(session.sessionId)
  return { ...summary, sessionId: session.sessionId }
```

把 `src/services/cloud/attachment.ts` 的 `uploadTaskAttachmentFromPath` 返回类型改为 `Promise<UploadedAttachment>`，并在 import 中加入 `type UploadedAttachment`。

- [ ] **Step 4: 运行测试，确认通过**

```powershell
node --experimental-strip-types --test tests/attachment-upload.test.ts
```

预期：全部 PASS。

---

## Task 5: 暴露任务 `revision` 给详情页

**Files:**
- Modify: `src/types/domain.ts:102-126`
- Modify: `src/services/cloud/legacy-view.ts:93-119`

- [ ] **Step 1: 扩展类型**

`src/types/domain.ts` 的 `Task` 接口末尾加：

```ts
  /** 云端任务乐观并发版本；legacy 后端可能不提供。 */
  revision?: number
```

- [ ] **Step 2: 适配层透出**

`src/services/cloud/legacy-view.ts` 的 `toLegacyTask` 返回对象中，`updatedAt: view.updatedAt,` 之后加：

```ts
    revision: view.revision,
```

- [ ] **Step 3: 类型检查**

```powershell
corepack pnpm exec tsc --noEmit --pretty false --skipLibCheck
```

预期：0 error。

---

## Task 6: `TaskStore.submit` 接收云端附件 id

**Files:**
- Modify: `src/store/index.ts:780-799`

- [ ] **Step 1: 修改实现**

把 `submit` 方法整段替换为：

```ts
  submit(
    id: string,
    note: string,
    attachments?: TaskSubmissionAttachment[],
    cloudAttachmentIds?: string[]
  ) {
    if (authStore.isCloud) {
      return this.action(async () => {
        const ids = cloudAttachmentIds ?? []
        if (ids.length > 3) throw new Error('附件最多 3 个')
        if ((attachments?.length ?? 0) !== ids.length) {
          throw new Error('附件尚未上传完成，请稍候或移除失败项')
        }
        const clubId = this.cloudClubOrThrow()
        await cloudTaskSubmit(clubId, {
          taskId: id,
          note,
          attachmentIds: ids,
          expectedRevision: await this.currentRevision(clubId, id),
          mutationId: createMutationId(),
        })
      }, '已提交，等待验收')
    }
    return this.action(
      () => taskService.submitTask(id, note, attachments),
      '已提交，等待验收'
    )
  }
```

- [ ] **Step 2: 类型检查**

```powershell
corepack pnpm exec tsc --noEmit --pretty false --skipLibCheck
```

预期：0 error。

---

## Task 7: 任务详情页接线上传

**Files:**
- Modify: `src/pages/task/detail.tsx`

- [ ] **Step 1: 改 import 与本地类型**

把 `import Taro, { useDidShow } from '@tarojs/taro'` 改为：

```tsx
import Taro, { useDidShow, useUnload } from '@tarojs/taro'
```

新增 import：

```tsx
import { cloudAttachmentCancel, uploadTaskAttachmentFromPath } from '@/services/cloud/attachment'
import { collectAttachmentIds } from '@/utils/attachment-upload'
```

在组件外（`function TaskDetail()` 之前）加入：

```tsx
type AttachmentStatus = 'UPLOADING' | 'READY' | 'FAILED'

interface AttachmentRow extends TaskSubmissionAttachment {
  status: AttachmentStatus
  attachmentId?: string
  sessionId?: string
  progressDone?: number
  progressTotal?: number
  errorMessage?: string
}

function attachmentStatusText(attachment: AttachmentRow): string {
  if (attachment.status === 'READY') return '已上传'
  if (attachment.status === 'FAILED') return '上传失败'
  return `上传中 ${attachment.progressDone ?? 0}/${attachment.progressTotal ?? 0}`
}
```

- [ ] **Step 2: 改状态与能力判定**

把：

```tsx
  const [attachments, setAttachments] = useState<TaskSubmissionAttachment[]>([])
```

改为：

```tsx
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const attachmentsRef = useRef<AttachmentRow[]>([])
```

在 `const canPersistAttachments = DEMO_MODE` 处替换为：

```tsx
  const attachmentMode: 'cloud' | 'local' | 'unsupported' = authStore.isCloud
    ? 'cloud'
    : DEMO_MODE
      ? 'local'
      : 'unsupported'
  const uploading = attachments.some((item) => item.status === 'UPLOADING')
  attachmentsRef.current = attachments

  const updateAttachment = (id: string, patch: Partial<AttachmentRow>) => {
    setAttachments((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }
```

在所有 hook 之后（`useDidShow` 之后）加入：

```tsx
  useUnload(() => {
    if (!authStore.isCloud) return
    const clubId = authStore.cloudActiveTeam?.clubId
    if (!clubId) return
    for (const row of attachmentsRef.current) {
      if (row.status === 'READY' && row.sessionId) {
        void cloudAttachmentCancel(clubId, row.sessionId).catch(() => undefined)
      }
    }
  })
```

- [ ] **Step 3: 替换选择/移除/提交逻辑**

把 `onChooseAttachments`、`onRemoveAttachment`、`onSubmit` 三个函数整段替换为：

```tsx
  const onChooseAttachments = async () => {
    const generation = loadGeneration.current
    const clubBefore = clubIdNow()
    const remaining = MAX_TASK_ATTACHMENTS - attachments.length
    if (remaining <= 0) {
      toast(`最多添加 ${MAX_TASK_ATTACHMENTS} 个附件`)
      return
    }
    setAttachmentBusy(true)
    try {
      const result = await Taro.chooseMessageFile({ count: remaining, type: 'all' })
      // 选择器返回后二次校验本页 ctx：切队/重载后不再读文件或上传
      if (generation !== loadGeneration.current) return
      if (authStore.isCloud && clubIdNow() !== clubBefore) return

      if (attachmentMode === 'cloud') {
        const clubId = clubBefore
        if (!clubId) return
        const expectedTaskRevision = task.revision ?? 0
        for (const file of result.tempFiles) {
          const error = validateTaskAttachment(file.name, file.size)
          if (error) {
            toast(`${file.name}：${error}`)
            continue
          }
          const rowId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          setAttachments((current) =>
            [
              ...current,
              {
                id: rowId,
                name: file.name,
                size: file.size,
                localPath: file.path,
                status: 'UPLOADING' as const,
                progressDone: 0,
                progressTotal: 0,
              },
            ].slice(0, MAX_TASK_ATTACHMENTS)
          )

          // 不调用 saveFile：微信本地存储配额约 10MB，直接使用选择器临时路径上传
          try {
            const uploaded = await uploadTaskAttachmentFromPath({
              clubId,
              taskId: task.id,
              expectedTaskRevision,
              name: file.name,
              size: file.size,
              filePath: file.path,
              onProgress: (done, total) => {
                if (generation !== loadGeneration.current) return
                if (authStore.cloudActiveTeam?.clubId !== clubId) return
                updateAttachment(rowId, { progressDone: done, progressTotal: total })
              },
            })
            if (generation !== loadGeneration.current) return
            if (authStore.cloudActiveTeam?.clubId !== clubId) return
            updateAttachment(rowId, {
              status: 'READY',
              attachmentId: uploaded.attachmentId,
              sessionId: uploaded.sessionId,
              errorMessage: undefined,
            })
          } catch (e) {
            if (generation !== loadGeneration.current) return
            updateAttachment(rowId, {
              status: 'FAILED',
              errorMessage: e instanceof Error ? e.message : '上传失败',
            })
          }
        }
        return
      }

      // local（demo）/ unsupported：保持既有本地保存行为
      const saved: AttachmentRow[] = []
      for (const file of result.tempFiles) {
        const error = validateTaskAttachment(file.name, file.size)
        if (error) {
          toast(`${file.name}：${error}`)
          continue
        }
        try {
          const persisted = await Taro.saveFile({ tempFilePath: file.path })
          if (generation !== loadGeneration.current) return
          if (!('savedFilePath' in persisted) || !persisted.savedFilePath) {
            toast(`${file.name} 保存失败`)
            continue
          }
          saved.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name,
            size: file.size,
            localPath: persisted.savedFilePath,
            status: 'READY',
          })
        } catch {
          toast(`${file.name} 保存失败，可能是本机文件空间不足`)
        }
      }
      if (generation !== loadGeneration.current) return
      setAttachments((current) => [...current, ...saved].slice(0, MAX_TASK_ATTACHMENTS))
    } catch {
      // The picker is dismissed by the user.
    } finally {
      setAttachmentBusy(false)
    }
  }

  const onRemoveAttachment = async (attachment: AttachmentRow) => {
    setAttachments((current) => current.filter((item) => item.id !== attachment.id))
    if (attachmentMode === 'cloud' && attachment.sessionId) {
      const clubId = clubIdNow()
      if (clubId) await cloudAttachmentCancel(clubId, attachment.sessionId).catch(() => undefined)
    }
    // cloud 的 localPath 是临时路径，无需清理；local 才清理本页保存的文件
    if (attachmentMode !== 'cloud') {
      await Taro.removeSavedFile({ filePath: attachment.localPath }).catch(() => undefined)
    }
  }

  const finishSubmitted = async () => {
    const clubBefore = clubIdNow()
    if (attachmentMode !== 'cloud') {
      await Promise.all(
        attachments.map((attachment) => Taro.removeSavedFile({ filePath: attachment.localPath }).catch(() => undefined))
      )
    }
    // 交付清理只清本页新建的本地文件；切队后不再改本页表单状态
    if (authStore.isCloud && clubIdNow() !== clubBefore) return
    setSubmitNote('')
    setAttachments([])
    attachmentsRef.current = []
  }

  const onSubmit = async () => {
    const note = submitNote.trim()
    if (!note) {
      toast('请填写交付说明')
      return
    }
    if (attachmentMode === 'cloud') {
      const { ids, blocker } = collectAttachmentIds(attachments)
      if (blocker === 'UPLOADING') {
        toast('附件仍在上传，请稍候')
        return
      }
      if (blocker === 'FAILED') {
        toast('请移除上传失败的附件后再提交')
        return
      }
      if (await runAction(taskStore.submit(task.id, note, attachments, ids))) await finishSubmitted()
      return
    }
    if (attachments.length && attachmentMode === 'unsupported') {
      toast('当前连接的 Rak 服务端尚未支持附件上传，请先移除附件再提交')
      return
    }
    if (await runAction(taskStore.submit(task.id, note, attachments))) await finishSubmitted()
  }
```

- [ ] **Step 4: 改渲染**

把选择区按钮与提示的 JSX（原 L406-426）整段替换为：

```tsx
                <View
                  className={`btn-secondary submission-form__pick ${attachmentBusy || attachmentMode === 'unsupported' || attachments.length >= MAX_TASK_ATTACHMENTS ? 'submission-form__pick--disabled' : ''}`}
                  onClick={attachmentBusy || attachmentMode === 'unsupported' || attachments.length >= MAX_TASK_ATTACHMENTS
                    ? undefined
                    : onChooseAttachments}
                >
                  <Text>
                    {attachmentBusy
                      ? attachmentMode === 'cloud'
                        ? '正在上传文件…'
                        : '正在保存文件…'
                      : attachmentMode === 'unsupported'
                        ? '服务端暂未支持附件'
                        : attachments.length >= MAX_TASK_ATTACHMENTS
                          ? '已达到附件数量上限'
                          : attachments.length
                            ? '继续添加文件'
                            : '选择交付文件'}
                  </Text>
                </View>
                {attachmentMode === 'cloud' ? (
                  <Text className='submission-form__notice'>附件将上传到团队私有空间；当前版本暂不支持在端内打开已上传附件。</Text>
                ) : attachmentMode === 'unsupported' ? (
                  <Text className='submission-form__notice'>当前连接的 Rak 服务端尚未接入附件上传。完善服务端接口后，成员提交的附件才能供管理员跨设备验收。</Text>
                ) : null}
```

把附件行渲染（原 L393-405）整段替换为：

```tsx
                {attachments.length ? (
                  <View className='attachment-list'>
                    {attachments.map((attachment) => (
                      <View key={attachment.id} className='attachment-row'>
                        <View className='attachment-row__copy'>
                          <Text className='attachment-row__name'>{attachment.name}</Text>
                          <Text className='text-caption'>
                            {formatTaskAttachmentSize(attachment.size)}
                            {attachmentMode === 'cloud' ? ` · ${attachmentStatusText(attachment)}` : ''}
                          </Text>
                          {attachment.status === 'FAILED' && attachment.errorMessage ? (
                            <Text className='text-caption'>{attachment.errorMessage}</Text>
                          ) : null}
                        </View>
                        <Text
                          className='attachment-row__remove'
                          onClick={attachment.status === 'UPLOADING' ? undefined : () => void onRemoveAttachment(attachment)}
                        >
                          {attachment.status === 'UPLOADING' ? '上传中' : '移除'}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
```

把提交按钮（原 L427-432）整段替换为：

```tsx
                <View
                  className={`btn-primary pressable ${taskStore.submitting || attachmentBusy || uploading ? 'btn-primary--disabled' : ''}`}
                  onClick={taskStore.submitting || attachmentBusy || uploading ? undefined : onSubmit}
                >
                  <Text>{task.status === 'REJECTED' ? '修改后重新提交' : '提交验收'}</Text>
                </View>
```

把「交付记录」里旧的 `!canPersistAttachments` 说明（原 L316-318）替换为：

```tsx
                {attachmentMode === 'local' ? (
                  <Text className='text-caption'>附件保存在本机，仅提交者设备可见。</Text>
                ) : null}
```

把 cloud 附件计数文案（原 L321-327）替换为：

```tsx
            {authStore.isCloud && cloudAttachmentCount > 0 ? (
              <View className='detail-block'>
                <Text className='text-caption'>
                  交付附件 {cloudAttachmentCount} 个：暂不支持在端内打开已上传附件。
                </Text>
              </View>
            ) : null}
```

- [ ] **Step 5: 类型检查与构建**

```powershell
corepack pnpm exec tsc --noEmit --pretty false --skipLibCheck
corepack pnpm build:weapp
```

预期：tsc 0 error；构建退出码 0。

- [ ] **Step 6: 客户端全量回归**

```powershell
corepack pnpm test
```

预期：全部 PASS。

---

## Task 8: 文档、门禁、构建与部署

**Files:**
- Modify: `docs/verification/m8-execution-log-2026-10-18.md`（追加 §30）
- Modify: `docs/verification/cloudbase-capabilities-2026-10-17.md`（资源/函数变更记录）

- [ ] **Step 1: 追加执行日志**

在 `docs/verification/m8-execution-log-2026-10-18.md` 末尾追加 `## 30. 追加（2026-10-18，经用户授权）：任务附件上传打通（上传 + 提交绑定）`，内容至少包含：

```markdown
- 真源：`docs/superpowers/specs/2026-10-18-task-attachment-upload-design.md`；计划：`docs/superpowers/plans/2026-10-18-task-attachment-upload.md`。
- 变更：`server/modules/tasks/index.ts`（task.submit 绑定）、`server/modules/files/index.ts`（D1 cancel / D2 init 回收）、`src/utils/attachment-upload.ts`、`src/services/cloud/attachment.ts`、`src/store/index.ts`、`src/pages/task/detail.tsx`、`src/types/domain.ts`、`src/services/cloud/legacy-view.ts`。
- 测试：`test:server` __PASS__，`test` __PASS__，根/服务端 tsc 0 error（填实际数字）。
- 部署：`rakApi`、`rakFiles` __已部署/未部署（NOT_RUN）__；部署时间与版本号。
- 真机验收：§7 的 9 步逐条填 PASS/NOT_RUN；下载/预览仍 `not_implemented`，如实标注。
```

- [ ] **Step 2: 记录能力/资源变更**

在 `docs/verification/cloudbase-capabilities-2026-10-17.md` 的资源变更处追加一行：本轮新增对 `rak_attachments / rak_upload_batches / rak_upload_sessions / rak_upload_chunks` 的**写入绑定**（`task.submit` 绑定附件、`file.cancel` 丢弃草稿），无新增集合与索引。

- [ ] **Step 3: 全量门禁**

```powershell
corepack pnpm test
corepack pnpm test:server
corepack pnpm exec tsc --noEmit --pretty false --skipLibCheck
corepack pnpm exec tsc -p server/tsconfig.json --noEmit
corepack pnpm verify:release
corepack pnpm build:cloud
```

预期：测试 0 fail；两处 tsc 0 error；发布校验 35 路由全绿；`cloudfunctions/` 三函数产物生成。

- [ ] **Step 4: 请求授权并部署（需用户逐次确认）**

先报告 `build:cloud` 的 manifest digest，再向用户请求部署授权；获授权后：

```powershell
node $env:TEMP\rak-cli-run.mjs fn deploy rakApi --force --install-dependency true
node $env:TEMP\rak-cli-run.mjs fn deploy rakFiles --force --install-dependency true
```

若包装脚本不存在，按既有执行日志中的 CLI 入口（`@cloudbase/cli` standalone `cli.js`）以 argv 数组方式调用；**不得**在日志中打印任何密钥。未获授权时本步骤标 **NOT_RUN**。

- [ ] **Step 5: 交付给用户复验**

提示用户重新上传体验版，并按 spec §7 的 9 步真机验收；把结果补写进 §30。

---

## 自审（写完计划后执行）

**1. Spec coverage**

| Spec 章节 | 覆盖任务 |
|---|---|
| §2.1 能力三态 | Task 7 Step 2/4 |
| §2.2 行模型 | Task 7 Step 1 |
| §2.3 选择即上传 | Task 7 Step 3 |
| §2.4 移除/离开 | Task 7 Step 2/3 |
| §2.5 提交前校验 | Task 4 + Task 7 Step 3 |
| §2.6 Store 改造 | Task 6 |
| §2.7 返回 sessionId | Task 4 |
| §2.8 展示 | Task 7 Step 4 |
| §3.1/3.2 服务端绑定 | Task 3 |
| §3.3 错误映射 | Task 3 Step 4（错误码逐项断言） |
| §4 D1 | Task 1 |
| §4 D2 | Task 2 |
| §4 D3 | Task 7 Step 4（只显示数量） |
| §6 测试计划 | Task 1/2/3/4 |
| §6.3 门禁 | Task 8 Step 3 |
| §7 真机验收 | Task 8 Step 5 |
| §8 防复发 | Task 4（唯一出口）+ Task 8（文档） |

**2. Placeholder scan**：无 TBD/TODO；所有代码块可直接落地；`__PASS__` 是执行时填写的占位符——已在 Step 1 明确要求填实际数字，不属于未定义实现。

**3. Type consistency**：`UploadedAttachment.sessionId` 在 Task 4 定义、Task 7 使用；`AttachmentRowState` 与 `collectAttachmentIds` 签名一致；`Task.revision?` 在 Task 5 定义、Task 7 用 `?? 0` 读取；`BatchSlot` 在 Task 3 内定义且仅在本文件使用。

**4. 用户约束**：计划中没有 `git add/commit`；部署步骤显式标注需授权；NOT_RUN 规则已写入 Task 8。
