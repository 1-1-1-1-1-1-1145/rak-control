# 任务附件上传打通（上传 + 提交绑定）设计

日期：2026-10-18（Asia/Shanghai）。状态：**已获用户批准（含 §4 D1/D2/D3）**，进入实施计划阶段。
真源：brainstorming 结论（范围＝只打通上传+提交绑定；时机＝选择即上传；方案＝A 提交事务内绑定）、多团队 DESIGN `§11`、PLAN `§M5`、现有 `file.*` 与服务端 `task.submit` 实现。

本文件只解决「云模式下任务交付附件选不了、传不上、提交后不落库」这一问题；**不改变**下载/预览的 `not_implemented` 裁决，不新增下载地址或 `expiresAt` 伪造。

---

## 0. 现状核对（已在源码中逐条确认）

| 事实 | 证据 |
|---|---|
| 云端分片上传服务端已完整实现并已部署 | `server/modules/files/index.ts`：`file.init/putChunk/status/confirm/cancel`；`file.downloadUrls/previewDraft` 明确 `not_implemented` |
| 客户端上传编排与云适配已完备 | `src/utils/attachment-upload.ts`（`planChunks`、2 并发、失败 cancel、缺片拦截）、`src/services/cloud/attachment.ts`（`uploadTaskAttachmentFromPath`） |
| 云服务端已具备 `task.submit` 的附件入参通道 | `src/services/cloud/task.ts:81-104` 透传 `attachmentIds`；`server/modules/api-handlers.ts:438-444` 已接收 |
| 但服务端 `task.submit` 收到附件直接拒绝 | `server/modules/tasks/index.ts:315-320`：`attachmentIds.length > 0` → `not_implemented('附件交付将在 M5 提供')` |
| 提交记录固定写空附件 | `server/modules/tasks/index.ts:377`：`attachmentIds: []` |
| batch 契约已是两端共用的哈希 | `server/modules/tasks/index.ts:349` 与 `server/modules/files/index.ts:111-113` 同为 `sha256(['rak-batch-v1', clubId, taskId, targetRound])` |
| 前端能力开关把 cloud 排除在外 | `src/pages/task/detail.tsx:105`：`canPersistAttachments = DEMO_MODE`；cloud 下选择器禁用并提示「服务端暂未支持附件」 |
| 前端选文件只落本机 | `src/pages/task/detail.tsx:128-173`：`chooseMessageFile` → `Taro.saveFile`，从未调用上传 |
| Store 的 cloud 分支主动拒绝附件 | `src/store/index.ts:780-799`：`throw new Error('附件交付将在 M5 提供')`，并固定 `attachmentIds: []` |
| 旧测试固化了「附件 = not_implemented」 | `server/tests/m4-tasks.test.ts:143-165` |
| `file.cancel` 禁止取消已确认会话 | `server/modules/files/index.ts:560-562`；`server/tests/m5-files-chunks.test.ts:309-336` |
| `file.init` 不回收过期/作废槽位 | `server/modules/files/index.ts:278-293`：直接按 `OCCUPIED` 计数并找 `EMPTY` |
| 管理员端无附件元数据读取动作 | `file.downloadUrls` 仍是唯一按附件读取的动作且未实现；`submission.attachmentIds` 只有 id |

**结论**：链路的「上传」一半已经存在且质量达标，缺的是「选择即上传」的前端接线，以及「提交事务内把 VERIFIED/DRAFT 附件绑定到 submission」的服务端逻辑。另有两处服务端可用性缺口（见 §4）会让用户在移除/放弃上传后无法继续。

---

## 1. 目标、范围与成功标准

### 1.1 目标

1. 云模式下，任务负责人（`CLAIMED` / `REJECTED`）在选择文件后**立即分片上传**，上传成功即拿到服务端 `attachmentId`。
2. 提交时把 0..3 个已就绪附件 id 交给 `task.submit`，服务端在**同一事务**内完成归属校验、绑定、未选槽位清理与批次封闭。
3. 提交记录、任务详情、管理员可见的提交摘要中的附件数量**真实反映**本次绑定结果。
4. 失败时给用户可理解、可恢复的提示；任何情况下不把未完成上传当成成功。

### 1.2 成功标准

- 云模式真机：选 1 个 100KB PDF → 列表显示「上传中 → 已上传」→ 提交成功 → 退出重进详情页仍显示「交付附件 1 个」。
- 选 3 个文件（含一个 >10MB、一个上传中）→ 非法文件被拒且不占位；上传中提交被拦截；移除失败项后可正常提交。
- 附件归属不符、已过期、非本人、跨队、跨任务、未 VERIFIED、非 DRAFT、不在本批槽位 → 服务端逐项拒绝且给出稳定错误码。
- 旧行为回归：0 附件提交、驳回后重交、多轮历史、审核/归档全部不受影响。
- 门禁：`test`、`test:server`、server/root `tsc`、`verify:release` 全绿。

### 1.3 明确不做（本阶段非目标）

- `file.downloadUrls` / `file.previewDraft` 保持 `not_implemented`；端内不提供已上传附件的跨设备打开。
- 不新增附件元数据列表动作（因此管理员端只能看到**数量**，看不到名称/大小；见 §4 D3）。
- 不做病毒扫描（`scanState=NOT_CONFIGURED` 如实保留）、不做物理删除 worker、不做断点续传 UI。
- 不改 `src/**` 现有配色、字号、图标与布局；状态文案复用现有 `text-caption` / `attachment-row__action`。
- 不改 legacy（非 cloud、非 demo）路径：该路径仍不支持附件。

---

## 2. 前端设计

### 2.1 能力判定改为三态

`src/pages/task/detail.tsx` 删除 `canPersistAttachments = DEMO_MODE`，改为：

```ts
const attachmentMode: 'cloud' | 'local' | 'unsupported' =
  authStore.isCloud ? 'cloud' : DEMO_MODE ? 'local' : 'unsupported'
```

| 模式 | 选择文件 | 存储/上传 | 提示 |
|---|---|---|---|
| `cloud` | 允许（仅 `CLAIMED`/`REJECTED` 且本人） | `saveFile` → `uploadTaskAttachmentFromPath` | 「附件上传到团队私有空间；当前版本暂不支持在端内打开已上传附件」 |
| `local` | 允许 | 现有 `saveFile` 本地保存，行为不变 | 现有「附件由提交者设备提供」文案 |
| `unsupported` | 禁用 | — | 保留现有「当前连接的 Rak 服务端尚未接入附件上传」文案 |

注意：`attachmentMode` 只决定"能否选/怎么存"；"能否提交"仍由现有 `canSubmit`（本人 + `CLAIMED`/`REJECTED`）决定。

### 2.2 附件行模型（页面本地类型）

```ts
type AttachmentRowStatus = 'UPLOADING' | 'READY' | 'FAILED'

interface AttachmentRow extends TaskSubmissionAttachment {
  status: AttachmentRowStatus   // local 模式恒为 READY（无 attachmentId）
  attachmentId?: string         // cloud + READY 必有
  sessionId?: string            // cloud + 已 init 成功才有，用于移除/离开时取消
  progressDone?: number
  progressTotal?: number
  errorMessage?: string
}
```

- `local`：`attachments` 现有结构补 `status: 'READY'`，其余字段不填。
- `cloud`：行在**开始上传前**就以 `UPLOADING` 入列，保证用户立刻看到反馈与占位。

### 2.3 选择即上传流程（`onChooseAttachments`）

1. 前置：`remaining = MAX_TASK_ATTACHMENTS - attachments.length`；`remaining <= 0` 直接提示。
2. `Taro.chooseMessageFile({ count: remaining, type: 'all' })`。
3. 选择器返回后立即做**双重栅栏**（沿用现有写法）：`generation !== loadGeneration.current` 或 `authStore.isCloud && clubIdNow() !== clubBefore` → 直接 return，不读文件、不上传。
4. 对每个 `tempFile`：
   1. `validateTaskAttachment(file.name, file.size)`；错误 → toast 并跳过（不占位）。
   2. `local`：现有 `Taro.saveFile` 逻辑，成功后 push `status:'READY'` 行。
   3. `cloud`：
      1. push 一行 `status:'UPLOADING'`（先占位，避免连点与计数错乱）。
      2. **不调用 `Taro.saveFile`**：微信本地文件存储配额约 10MB，单个 10MB 附件即触顶；直接用选择器返回的临时路径 `file.path` 作为上传源（上传立即开始，临时文件在本次前台会话内有效）。
      3. 以**选择时捕获**的 `task.revision` 作为 `expectedTaskRevision`，调用
         `uploadTaskAttachmentFromPath({ clubId, taskId, expectedTaskRevision, name, size, filePath: file.path, onProgress })`。
      4. `onProgress(done,total)` → 仅当 `generation` 与 `clubId` 仍匹配时更新该行 `progressDone/progressTotal`。
      5. 成功 → 该行 `status:'READY'`、写入 `attachmentId`、`sessionId`（见 §2.7 返回值改造）；清理 `errorMessage`。
      6. 失败 → 该行 `status:'FAILED'`，展示 `errorMessage`；**不**从列表移除（用户可自行移除）。
5. 串行处理文件（`for...of` + `await`），与现有实现一致；`attachmentBusy` 在整批期间为 true。

校验常量保持单一来源：`MAX_TASK_ATTACHMENTS=3`、`MAX_TASK_ATTACHMENT_SIZE=10MB`（`src/utils/task-attachment-policy.js`）。

### 2.4 移除与离开页面

- **移除 READY（cloud 且有 `sessionId`）**：先本地移除该行，再 `cloudAttachmentCancel(clubId, sessionId).catch(() => undefined)`，释放服务端槽位并让未交付附件转 `GC_PENDING`（依赖 §4 D1）。
- **移除 UPLOADING**：禁止（行内「移除」在 `status==='UPLOADING'` 时不响应点击，显示「上传中」）；批次结束后才可移除，避免上传继续但槽位无人释放。
- **移除 FAILED**：本地移除；有 `sessionId` 则同样尽力 cancel；无则纯本地。
- **离开页面**：`useUnload` 中对所有 `cloud && READY && sessionId` 的行尽力 cancel（`void ...catch()`），避免遗留占位。失败不影响任何已完成操作（服务端另有 §4 D2 回收）。
- **local 模式**：保持现有 `Taro.removeSavedFile` 行为；`cloud` 模式的 `localPath` 是临时路径，**不**调用 `removeSavedFile`。

### 2.5 提交前置校验与 id 收集

在 `src/utils/attachment-upload.ts` 新增纯函数（可单测，不依赖 Taro）：

```ts
export interface AttachmentRowState {
  status: 'UPLOADING' | 'READY' | 'FAILED'
  attachmentId?: string
}

/** 返回可提交的附件 id；存在阻塞项时 blocker 非空，ids 不得使用。 */
export function collectAttachmentIds(rows: AttachmentRowState[]): {
  ids: string[]
  blocker: 'UPLOADING' | 'FAILED' | null
}
```

规则：任一 `UPLOADING` → `blocker='UPLOADING'`；否则任一 `FAILED` → `blocker='FAILED'`；否则 `READY` 行必须都有 `attachmentId`，按列表顺序返回；缺 id 按 `FAILED` 处理（防御内部状态不一致）。

`onSubmit`：

1. 现有「交付说明必填」校验不变。
2. `cloud`：`collectAttachmentIds(rows)`；`blocker==='UPLOADING'` → toast「附件仍在上传，请稍候」；`blocker==='FAILED'` → toast「请移除上传失败的附件后再提交」。
3. `local` / `unsupported`：保持现有提示与行为。
4. 调用 `taskStore.submit(task.id, note, rows, cloudIds)`。
5. 成功后：`local` 模式清理本次 `rows` 的 `localPath`（`removeSavedFile`）；`cloud` 模式的临时路径无需清理。随后清空 `submitNote` 与 `attachments`；沿用现有 `clubId` 栅栏，切队后不写本页状态。

### 2.6 Store 改造（`src/store/index.ts` · `TaskStore.submit`）

签名扩为：

```ts
submit(
  id: string,
  note: string,
  attachments?: TaskSubmissionAttachment[],
  cloudAttachmentIds?: string[]
)
```

- `authStore.isCloud`：
  - `ids = cloudAttachmentIds ?? []`；`ids.length > 3` → `throw new Error('附件最多 3 个')`（与旧提示一致）。
  - 若 `attachments?.length` 与 `ids.length` 不一致 → `throw new Error('附件尚未上传完成，请稍候或移除失败项')`（不静默丢弃）。
  - `cloudTaskSubmit(clubId, { taskId:id, note, attachmentIds: ids, expectedRevision: await currentRevision(...), mutationId })`。
- legacy：`taskService.submitTask(id, note, attachments)` 不变（`cloudAttachmentIds` 忽略）。

页面调用点仅一处（`detail.tsx:209`），无其他调用方（已全库确认）。

### 2.7 上传编排返回值补 `sessionId`

`uploadTaskAttachment` 目前只返回 `AttachmentSummary`，但移除/离开需要 `sessionId` 才能取消。改为：

```ts
export interface UploadedAttachment extends AttachmentSummary { sessionId: string }
```

`uploadTaskAttachment(...): Promise<UploadedAttachment>` 在 `confirm` 成功后返回 `{ ...summary, sessionId: session.sessionId }`；`uploadTaskAttachmentFromPath` 同步更新返回类型。协议与网络调用不变。

### 2.8 展示

- 选择区：`attachment-row__action` 按状态显示 `上传中 2/5` / `已上传` / `上传失败`（FAILED 行下方用现有 `text-caption` 显示 `errorMessage`，不加新样式）。
- 选择按钮文案：`attachmentBusy ? '正在上传文件…' : attachments.length >= 3 ? '已达到附件数量上限' : attachments.length ? '继续添加文件' : '选择交付文件'`。
- 提交按钮：`taskStore.submitting || attachmentBusy` 时禁用（沿用现有 `btn-primary--disabled`）。
- 已提交展示：cloud 下保留「交付附件 N 个」，文案改为**如实**：「暂不支持在端内打开已上传附件」。删除「跨设备打开依赖附件能力（M5）」这类进度性表述。
- 不新增 UI 组件、不改 scss。

---

## 3. 服务端设计（`server/modules/tasks/index.ts` · `submitTask`）

### 3.1 入参校验（事务外，进入 `runIdempotent` 之前）

```ts
const attachments = Array.isArray(input.attachmentIds) ? input.attachmentIds : []
if (attachments.length > MAX_ATTACHMENTS) throw new AppError('validation_failed', '附件最多 3 个')
if (attachments.some((id) => typeof id !== 'string' || id.length === 0)) {
  throw new AppError('validation_failed', '附件 id 非法')
}
if (new Set(attachments).size !== attachments.length) {
  throw new AppError('validation_failed', '附件重复')
}
```

重复 id **显式拒绝**而非静默去重：客户端若重复计数，说明行状态与提交集合不一致，静默去重会掩盖缺陷。
`MAX_ATTACHMENTS` 从 `../files/index.ts` 导入（单一来源，值 3），不复制字面量。
`runIdempotent` 的 `data` 继续记录 `attachmentIds: attachments`（保持幂等键稳定）。

### 3.2 事务内步骤

保留现有结构（`resolveTenant` → 读 task → revision/状态/负责人校验 → `round = currentRound + 1` → `targetRound` 校验 → batch 处理 → 写 submission/task → 栅栏 → 审计），仅把「batch 处理」与 `attachmentIds` 落库替换为下述逻辑：

```ts
const submissionId = randomId('sub')                       // 提前生成，供绑定使用
const batchId = sha256Hex(JSON.stringify(['rak-batch-v1', clubId, input.taskId, round]))
const batch = await tx.get(COLLECTIONS.uploadBatches, batchId)

const slotSessionIds = new Set<string>()                   // 本批 3 槽内的会话
if (batch) {
  for (const slot of (batch.slots as BatchSlot[] | undefined) ?? []) {
    if (slot.state === 'OCCUPIED' && slot.sessionId) slotSessionIds.add(slot.sessionId)
  }
}

const selectedSessions = new Set<string>()

if (attachments.length > 0) {
  if (!batch || batch.state !== 'OPEN') {
    throw new AppError('attachment_forbidden', '本轮附件批次不存在或已封闭')
  }
  for (const attachmentId of attachments) {
    const att = await tx.get(COLLECTIONS.attachments, attachmentId)
    // 跨队/他人/他任务一律同一错误码，避免探测
    if (!att || att.clubId !== clubId || att.taskId !== input.taskId) {
      throw new AppError('attachment_forbidden', '附件不属于本任务')
    }
    if (att.uploadedByMemberId !== tenant.member._id) {
      throw new AppError('attachment_forbidden', '只能绑定本人上传的附件')
    }
    if (att.integrityState !== 'VERIFIED') {
      throw new AppError('attachment_not_ready', '附件尚未完成校验')
    }
    if (att.lifecycleState !== 'DRAFT') {
      throw new AppError('attachment_forbidden', '附件已被其他交付绑定或待回收')
    }
    const confirmedUntil = att.confirmedUntil
    if (typeof confirmedUntil !== 'number' || now > confirmedUntil) {
      throw new AppError('upload_expired', '附件已过期，请重新上传')
    }
    const sessionId = att.sessionId as string
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

  for (const attachmentId of attachments) {
    const att = (await tx.get(COLLECTIONS.attachments, attachmentId))!
    await tx.set(COLLECTIONS.attachments, {
      ...att,
      lifecycleState: 'ATTACHED',
      submissionId,
      updatedAt: now,
    })
  }
}

// 未选中的槽位：终结会话 + 未交付附件转 GC_PENDING
if (batch && batch.state !== 'CLOSED') {
  for (const slot of (batch.slots as BatchSlot[] | undefined) ?? []) {
    const sessionId = slot.sessionId as string | undefined
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
      const att = await tx.get(COLLECTIONS.attachments, session.attachmentId)
      if (att && att.lifecycleState === 'DRAFT') {
        await tx.set(COLLECTIONS.attachments, { ...att, lifecycleState: 'GC_PENDING', updatedAt: now })
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
```

随后：

- `submission.attachmentIds = attachments`（原顺序，不排序）。
- task：`status='SUBMITTED'`、`submittedAt`、`currentRound=round`、`lastSubmissionId`、`revision+1`（**只加 1**；附件不额外递增 task revision）。
- `bumpClubFence` + `writeAudit(action:'task.submit')` 不变。
- 返回 `{ task: toTaskView(next), submission: toSubmissionView(submission) }`。

不变量：

- 选中附件：`DRAFT → ATTACHED` 且 `submissionId` 指向本次提交；session 保持 `CONFIRMED`。
- 未选中：session `CANCELLED`（`fence+1`），附件 `DRAFT → GC_PENDING`；**不**物理删除对象（与现有 `file.cancel` 一致）。
- batch 只递增自身 revision，`CLOSED` 后本轮不可再 init。
- 事务内只做 doc 读写，无网络/存储副作用（沿用既有约束）。
- 附件校验全部在任何写入之前完成：任一失败 → 整个事务回滚，不会出现"绑了一半"。

### 3.3 错误映射（服务端 → 客户端文案）

| 场景 | code | 客户端表现 |
|---|---|---|
| 附件 >3 / 空 id / 重复 id | `validation_failed` | 提交前已拦截；兜底 toast |
| 批次不存在 / 已封闭 | `attachment_forbidden` | 「本轮附件已失效，请重新添加」 |
| 跨队 / 他人 / 他任务 / 已绑定 / 不在槽位 | `attachment_forbidden` | 「附件不可用于本次提交，请移除后重试」 |
| 未 VERIFIED / 会话未确认 | `attachment_not_ready` | 「附件尚未上传完成，请稍后重试」 |
| `confirmedUntil` 过期 | `upload_expired` | 「附件已过期，请重新上传」 |
| task revision 变化 / targetRound 不符 | `revision_conflict` | 「任务已变化，请刷新后重试」 |
| 当前状态不可交付 / 非负责人 | `invalid_transition` / `permission_denied` | 现有文案 |

---

## 4. 补充决策（已获用户确认）

> 以下三项在 2026-10-18 spec 审阅时由用户明确接受。D1、D2 会改动 `rakFiles`，因此本轮需要**重新部署 `rakFiles` + `rakApi`**（第 2 节主方案原本只预期部署 `rakApi`）。

### D1. 允许取消「已确认但未交付」的附件（`file.cancel`）

**问题**：`file.confirm` 成功后 session 为 `CONFIRMED`，而 `file.cancel` 目前一律 `invalid_transition`。用户在提交前移除一个已上传文件时，无法释放批次槽位；移除 1 个后再选第 4 个会被 `file.init` 以「附件最多 3 个」拒绝，形成死锁。

**决策**：仅当 `session.state === 'CONFIRMED'` 且其附件 `lifecycleState === 'DRAFT'` 且 `submissionId === null` 时允许取消；取消后：附件 → `GC_PENDING`、session → `CANCELLED`（`fence+1`）、释放槽位（现有逻辑已具备）。附件一旦 `ATTACHED` 仍禁止取消。

**影响**：`server/tests/m5-files-chunks.test.ts:309-336` 的「已确认不可取消」拆成两个用例（未交付可取消 / 已交付不可取消）。

**降级后果**：不接受则前端移除只能"隐藏"，槽位仍被占用，用户在一轮内最多成功上传 3 次且无法替换。

### D2. `file.init` 回收过期/作废占位

**问题**：用户上传后直接退出页面、或上传中断，槽位会长期 `OCCUPIED`；`file.init` 不清理，30 分钟后仍无法新增。三次意外即可让本轮附件功能不可用。

**决策**：`file.init` 在计算 `OCCUPIED` 前，对本批每个 `OCCUPIED` 槽位做一次判定（事务内，最多 3 个 session）。凡判定为"释放"，一律把该槽位写回 `{ index, sessionId: null, state: 'EMPTY' }`；batch revision 仍按既有规则在新会话落库时 +1，不因回收额外递增：

- session 不存在 / `state === 'CANCELLED'` / `state === 'EXPIRED'` → 释放；
- `state === 'DRAFT' | 'UPLOADING'` 且 `now > uploadExpiresAt` → session → `EXPIRED`、其 chunk 文档（最多 `totalChunks` 个）→ `GC_PENDING`、释放；
- `state === 'CONFIRMED'` 且 `attachmentId` 对应附件为 `DRAFT` 且 `now > confirmedUntil` → attachment → `GC_PENDING`、session → `EXPIRED`、释放；
- `state === 'CONFIRMED'` 且未过期 → 保留占位。

**影响**：`file.init` 内新增有界读取与写入；新增测试覆盖四种分支。不改变正常路径（未过期时行为完全一致）。

**降级后果**：不接受则 30 分钟内的"放弃后重来"会失败；前端 `useUnload` 只能覆盖正常返回，覆盖不了杀进程/断网。

### D3. 管理员端只显示附件数量（不新增元数据动作）

`submission.attachmentIds` 只有 id，且 `file.downloadUrls` 仍 `not_implemented`。本阶段管理员在验收界面只能看到「附件 N 个（暂不支持在端内打开）」，**看不到名称/大小**。

**决策**：接受该限制，不新增 `file.list*` 动作（避免扩大协议面）；在执行日志与验收记录中如实标注「附件元数据展示 NOT_RUN/未实现」。后续若需要，再单独设计只读元数据动作（不下发 URL）。

---

## 5. 前端错误处理

| 场景 | 处理 |
|---|---|
| 选择器取消 | 静默（沿用现状） |
| 文件 >10MB / 空文件 / 文件名非法 | toast「文件名：原因」，跳过该文件，不占位 |
| `saveFile` 失败（仅 `local` 模式） | 该行 `FAILED`，提示本机空间问题；可移除 |
| `file.init` 失败（`revision_conflict`） | 该行 `FAILED`，提示「任务已变化，请刷新后重试」；刷新按钮沿用页面重进 |
| 分片失败 | 编排内部 cancel 一次后抛出；该行 `FAILED`；移除可再 cancel（幂等容忍） |
| 对账缺片 | 编排 cancel 并抛「分片未全部就绪」；行 `FAILED` |
| `confirm` 响应丢失 | 行 `FAILED`；用户移除（D1 释放槽位）后重新选择；**不**把未知结果当成功 |
| 提交时存在 `UPLOADING` | 前端拦截 toast；不发请求 |
| 提交时存在 `FAILED` | 前端拦截 toast；不发请求 |
| 提交返回 `attachment_*` / `upload_expired` | `taskStore.action` 现有 toast；刷新详情后重试 |
| 提交成功但刷新失败 | 现有 `runAction` 行为：提交已成功，列表刷新失败不回滚提示 |
| 切队 / 页面重载 | 所有异步回调沿用 `generation` + `clubId` 双栅栏，迟到结果不写新队 |
| 管理员端 | 只显示数量并提示暂不可打开（D3），不伪造可下载 |

---

## 6. 测试计划

### 6.1 服务端（`server/tests`，Node test runner）

**M4 任务（改造 `m4-tasks.test.ts`）**

1. 替换旧用例「附件 = not_implemented」为：0 附件提交仍成功且 `submission.attachmentIds=[]`。
2. 1..3 个合法附件：提交成功；submission 记录原顺序 id；附件 `ATTACHED` + `submissionId` 正确；session 仍 `CONFIRMED`；batch `CLOSED` 且 revision 递增；task revision 只 +1。
3. 部分选中（上传 3 个、提交 2 个）：被选中的 `ATTACHED`；未选中的 session `CANCELLED`（fence+1）且附件 `GC_PENDING`；batch `CLOSED`。
4. 拒绝矩阵：跨队附件、他人上传、其他任务、`integrityState=PENDING`、`lifecycleState=ATTACHED`、`confirmedUntil` 过期、session 不在本批槽位、session 未 `CONFIRMED` → 分别断言错误码；断言事务回滚（task 仍 `CLAIMED`、submission 未创建、附件仍 `DRAFT`）。
5. 重复 id、超过 3 个、非字符串 id → `validation_failed`。
6. 有 id 但 batch 不存在 / batch 已 `CLOSED` → `attachment_forbidden`。
7. 同一 `mutationId` 重放 → 返回同一结果（不重复绑定、不重复递增 revision）。
8. revision 变化 / `targetRound` 不符 → `revision_conflict`（保持现有用例）。

**M5 文件（改造 `m5-files-chunks.test.ts`）**

9. D1：已确认未交付 → cancel 成功（槽位释放、附件 `GC_PENDING`、fence+1）；已 `ATTACHED` → `invalid_transition`。
10. D2：四种槽位回收分支各一例；未过期 `CONFIRMED` 不被回收。

### 6.2 前端纯函数（`tests/attachment-upload.test.ts`）

11. `collectAttachmentIds`：全 READY 且有序；含 `UPLOADING` → blocker；含 `FAILED` → blocker；READY 缺 `attachmentId` → 视为 FAILED；空列表 → `{ids:[], blocker:null}`。
12. `uploadTaskAttachment` 返回值含 `sessionId`（用现有替身 transport 断言）。

### 6.3 门禁

```bash
corepack pnpm test
corepack pnpm test:server
corepack pnpm exec tsc --noEmit --pretty false --skipLibCheck          # 根
corepack pnpm exec tsc -p server/tsconfig.json --noEmit                # server
corepack pnpm verify:release
corepack pnpm build:cloud                                              # 三函数产物
```

预期：`test` 89 → ≥91；`test:server` 149 → ≥160（以实际新增为准）；类型检查 0 错；发布校验 35 路由全绿。

---

## 7. 真机验收（体验版，逐条记录结果）

1. 负责人打开 `CLAIMED` 任务 → 选择 1 个 100KB PDF → 行内出现「上传中」→「已上传」。
2. 继续选择 2 个（累计 3 个）→ 第 4 次点选择被「已达到附件数量上限」拦截。
3. 移除其中 1 个 → 可再选 1 个并上传成功（验证 D1 槽位释放）。
4. 上传过程中点提交 → 被「附件仍在上传」拦截。
5. 填交付说明 + 3 个 READY 附件 → 提交成功；退出登录/杀进程 → 重进详情页 → 显示「交付附件 3 个」。
6. 换另一台设备/另一成员查看该任务 → 同样显示数量，点击无下载入口（如实提示）。
7. 管理员验收通过/驳回 → 轮次历史与附件数量仍正确；驳回后重新上传新附件 → 新一轮绑定不串旧附件。
8. 选择 >10MB 文件 → 被拒且不占位；随后正常上传不受影响。
9. 弱网/飞行模式上传 → 行显示失败；恢复网络后移除并重传成功。

未在真实云环境/真机执行的项目一律标 **NOT_RUN**，不以本地替身结果替代。

---

## 8. 防复发

1. **能力判定单一化**：附件可上传性只由 `attachmentMode`（cloud/local/unsupported）决定，删除分散的 `DEMO_MODE` 直判；`canSubmit` 只决定业务状态。
2. **契约测试固化**：`batchId` 算法、`targetRound = currentRound+1`、附件 6 项归属校验、未选槽位清理，全部由服务端用例固定；两端若改算法必须同时改测试。
3. **提交集合与 UI 一致**：`collectAttachmentIds` 是唯一出口，禁止在页面内手写 `filter/map` 拼 ids；`ids.length` 必须等于 UI 行数，否则提交前报错。
4. **不静默、不伪造**：服务端对附件错误逐项返回稳定码；前端未知结果一律 `FAILED`；下载/预览继续 `not_implemented`；执行日志与验收表如实记录 NOT_RUN 项。
5. **占位自愈**：D2 的 init 回收 + 前端 `useUnload` 双保险，避免槽位泄漏导致功能"越用越不可用"。

---

## 9. 实施与部署顺序

1. 服务端：`tasks/index.ts` 绑定逻辑 + `files/index.ts`（D1/D2）→ 补/改测试 → `test:server` 全绿。
2. 前端：`attachment-upload.ts`（返回 `sessionId` + `collectAttachmentIds`）→ `store/index.ts` → `detail.tsx` → 前端测试 + 根 tsc。
3. 文档：执行日志新增「附件上传打通」章节；能力报告记录本轮资源/函数变更。
4. `build:cloud` → 逐次授权部署 **`rakApi` 与 `rakFiles`**（两者都有改动）。
5. 用户重新上传体验版 → 按 §7 真机验收；结果写入执行日志（含 NOT_RUN 标注）。

---

## 10. 自审记录（四问）

| 检查项 | 结论 |
|---|---|
| 占位符 | 无 TBD/TODO；所有字段名、错误码、函数签名均来自现有源码或本文件显式定义 |
| 内部一致性 | 第 1/2 节与第 3 节一致；D1/D2 只补充"移除/放弃"路径，不改变已批准的提交主流程；§2.7 的返回类型与 §2.4 使用的 `sessionId` 对应 |
| 范围 | 仅上传 + 提交绑定；下载/预览、元数据列表、病毒扫描、物理 GC 明确列为非目标 |
| 歧义 | 三处原方案未明确项已单列为 §4 D1/D2/D3，并写明推荐、影响与降级后果，等待审阅确认 |
