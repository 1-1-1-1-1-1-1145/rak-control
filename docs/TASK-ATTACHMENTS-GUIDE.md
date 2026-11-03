# Rak 任务交付附件实施教程

> 依据：`docs/proposals/rak-auth-task-attachments-contract.md`（下称“契约”）。本教程只列执行步骤；设计理由见契约，不重复。
> 执行顺序：准备 → 后端（`rak-auth`）→ 小程序（本仓库 `rak-control`）→ 微信平台配置 → 验收发布。
> 分工：第 1 章交 `rak-auth` 维护者（或对应开发会话）；第 2–4 章由小程序侧执行。后端接口部署前，第 2.3 节联调无法开始。

## 0. 准备

| # | 准备项 | 具体要求 | 负责 |
| --- | --- | --- | --- |
| 0.1 | rak-auth 仓库 | 本机可构建（JDK 25、Maven、`.env` 就绪），已完成 V6 club 迁移 | 后端 |
| 0.2 | 对象存储 | 腾讯云 COS 私有桶，或支持 multipart POST 直传的等价私有存储 | 后端/运维 |
| 0.3 | 微信公众平台管理权 | 可配置 request / uploadFile / downloadFile 合法域名 | 小程序负责人 |
| 0.4 | 隔离测试环境 | 测试社团 + member / manager / super_admin 三套测试身份 | 后端 |
| 0.5 | 小程序环境 | Node + pnpm + 微信开发者工具，`pnpm install` 可跑通 | 小程序 |

不要在代码、仓库或聊天中写入 AppSecret、COS 密钥、API key、access token。

附件使用 `rak-auth` 与私有对象存储方案，不依赖 CloudBase 云函数。本地原订阅提醒云函数已于 2026-10-16 移除，不影响本文附件实施方案。

`rak-auth` 尚未落地 club 业务（任务、成员、权限）时，先执行 `docs/superpowers/plans/2026-09-19-rak-auth-club-backend.md`，再回到本教程。

## 1. 后端（rak-auth）

### 1.1 合入契约与 ADR

1. 把契约 §3–§4 合入 `rak-auth/docs/API.md`：新增「任务交付附件」章节，含 7 个端点（契约 §4）、DTO、错误码。
2. 新建 `rak-auth/docs/adr/adr-XXXX-task-submission-attachments.md`（编号取现有最大 +1），记录决策：COS 私有桶、multipart POST 直传、交付/附件两张新表 + Idempotency-Key 机制、确认前扫描。
3. 提交：

```bash
git add docs && git commit -m "docs: 任务交付附件契约与 ADR"
```

完成标准：API.md 的端点路径、字段名与本教程一致，后续代码以它收口。

### 1.2 数据库迁移

新建 `rak-auth-app/src/main/resources/db/migration/V7__task_submission_attachments.sql`（编号按仓库当前最大版本 +1 顺延）。

```sql
-- 业务修订号：仅在影响提交的变更（认领/提交/验收/驳回/归档/改派）时 +1
ALTER TABLE club_tasks ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;

CREATE TABLE club_task_submissions (
  id             uuid PRIMARY KEY,
  task_id        uuid NOT NULL REFERENCES club_tasks(id) ON DELETE CASCADE,
  club_id        uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  round          int  NOT NULL,
  submitted_by   uuid NOT NULL REFERENCES users(id),
  note           text,
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_by    uuid REFERENCES users(id),
  reviewed_at    timestamptz,
  review_outcome varchar(16) NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | REJECTED
  quality_grade  varchar(1),
  quality_note   text,
  reject_reason  text,
  UNIQUE (task_id, round)
);
CREATE INDEX idx_club_submissions_task ON club_task_submissions (task_id, round DESC);

CREATE TABLE club_task_submission_attachments (
  id                       uuid PRIMARY KEY,
  club_id                  uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  task_id                  uuid NOT NULL REFERENCES club_tasks(id) ON DELETE CASCADE,
  round                    int  NOT NULL,
  submission_id            uuid REFERENCES club_task_submissions(id) ON DELETE SET NULL,
  uploaded_by              uuid NOT NULL REFERENCES users(id),
  task_revision            bigint NOT NULL,
  staging_object_key       text NOT NULL,
  staging_version          text,
  final_object_key         text,
  final_version            text,
  original_name            varchar(255) NOT NULL,
  declared_mime_type       varchar(255),
  detected_mime_type       varchar(255),
  declared_size_bytes      bigint NOT NULL,
  verified_size_bytes      bigint,
  verified_checksum_sha256 char(64),
  scan_result              varchar(16),   -- PENDING | CLEAN | BLOCKED | UNSCANNABLE
  status                   varchar(16) NOT NULL DEFAULT 'PENDING_UPLOAD',
  expires_at               timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  confirmed_at             timestamptz,
  UNIQUE (staging_object_key)
);
CREATE UNIQUE INDEX uq_attachment_final_key
  ON club_task_submission_attachments (final_object_key)
  WHERE final_object_key IS NOT NULL;
CREATE INDEX idx_attachment_draft
  ON club_task_submission_attachments (task_id, status)
  WHERE status IN ('PENDING_UPLOAD', 'VERIFYING', 'CONFIRMED');
CREATE INDEX idx_attachment_submission
  ON club_task_submission_attachments (submission_id);

-- 幂等键：同一用户 + 同一操作只允许一个键记录；命中后校验 task_id 与请求哈希，不一致按 409 处理
CREATE TABLE club_idempotency_keys (
  id              uuid PRIMARY KEY,
  scope           varchar(32) NOT NULL,   -- init | confirm | cancel | submit
  idem_key        varchar(64) NOT NULL,
  user_id         uuid NOT NULL REFERENCES users(id),
  task_id         uuid NOT NULL REFERENCES club_tasks(id) ON DELETE CASCADE,
  request_hash    char(64) NOT NULL,
  response_status int  NOT NULL,
  response_body   text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,   -- 保留 30 天
  UNIQUE (scope, idem_key, user_id)
);
```

1. RLS/租户策略：照 V6 中 `club_tasks` 的既有写法为三张新表启用（ENABLE + FORCE + 同款策略），不引入新写法。若仓库已有等价幂等设施，可复用并跳过 `club_idempotency_keys`。
2. 验证迁移：

```bash
source .env
mvn -pl rak-auth-app -am package -DskipTests -q
java -jar rak-auth-app/target/*.jar --spring.profiles.active=dev
# 期望日志：Migrating schema "auth" to version "7"
```

3. 提交：

```bash
git add rak-auth-app/src/main/resources/db/migration
git commit -m "feat: 任务交付附件与交付历史表"
```

完成标准：迁移成功、重启无报错；三张新表与 `club_tasks.revision` 存在。

### 1.3 对象存储

1. 创建 COS 桶：私有读写、与后端同地域、开启版本控制。
2. 固定对象前缀：
   - 临时区 `staging/clubs/{clubId}/tasks/{taskId}/round-{n}/{attachmentId}`
   - 正式区 `final/clubs/{clubId}/tasks/{taskId}/round-{n}/{attachmentId}`
3. 生命周期：`staging/` 前缀 1 天自动删除；`final/` 不设自动删除（保留期限另行定稿）。
4. 密钥：新建子账号，只授权本桶 `PutObject / GetObject / HeadObject / DeleteObject`，禁止 ListBucket；密钥只放服务端环境变量或密钥管理。
5. 扫描实现二选一，结果写入 ADR：数据万象内容审核 + 类型魔数检测；或自建 ClamAV。压缩包限制展开深度与总大小；无法扫描的结果记为 `UNSCANNABLE`，按受限处理，不算通过。
6. 记录两个域名备用：上传域名、下载域名（默认 `https://{bucket}.cos.{region}.myqcloud.com`，或自定义域名）。

完成标准：匿名 GET/HEAD 被拒；用服务端凭证完成一次上传、下载、删除连通测试。

### 1.4 core 层

新增（包路径跟随现有 `core` 模块规范）：

- domain：`TaskSubmission`、`TaskSubmissionAttachment`、`TaskAttachmentStatus`（7 态枚举：PENDING_UPLOAD / VERIFYING / CONFIRMED / ATTACHED / CANCELLED / EXPIRED / BLOCKED）、`ScanResult`（PENDING / CLEAN / BLOCKED / UNSCANNABLE）
- port：`TaskSubmissionRepositoryPort`、`TaskAttachmentRepositoryPort`、`TaskAttachmentStoragePort`、`IdempotencyPort`
- service：`TaskAttachmentService`（接口 + 实现）

`TaskAttachmentStoragePort` 建议接口：

```java
public interface TaskAttachmentStoragePort {
    UploadForm createStagingUploadForm(String stagingKey, long maxBytes, long expiresInSeconds);
    StoredObject head(String key);                      // size、contentType、etag、versionId
    void copyToFinal(String stagingKey, String versionId, String finalKey);
    String presignDownload(String finalKey, String downloadName, long expiresInSeconds);
    void deleteStaging(String stagingKey, String versionId);
}
```

`TaskAttachmentService` 实现要点（对照契约 §3.3）：

1. `init`：`SELECT ... FOR UPDATE` 锁任务行；校验当前用户 = 负责人且状态 ∈ {CLAIMED, REJECTED}；统计有效会话（PENDING_UPLOAD / VERIFYING / CONFIRMED）< 3；`round` = 当前交付最大轮 + 1；写附件行（`task_revision` = `club_tasks.revision`）；返回上传表单与 `confirmExpiresAt`（30 分钟内有效）。
2. `confirm`：CAS `PENDING_UPLOAD → VERIFYING`，重复调用直接返回当前态；`head` 校验对象存在、非空、大小 ≤ 10 MiB（10,485,760 字节）且与声明一致、检测真实类型；扫描通过后复制版本到正式区并 CAS `VERIFYING → CONFIRMED`，记录 `verified_*` 与 `scan_result`；扫描未完成返回 202 `VERIFYING`。
3. `cancel`：仅上传者本人；`PENDING_UPLOAD | VERIFYING | CONFIRMED → CANCELLED`，安排删除 staging 对象；`ATTACHED` 不可取消。
4. `submit`（改造 `ClubTaskService`）：锁任务与附件；校验数量 ≤ 3、去重、同 task、同 round、同用户、`CONFIRMED` 且 `task_revision` 未失效；同一事务内建 submission（`round` 同上）、附件 `→ ATTACHED` 并写 `submission_id`、任务迁移到 `SUBMITTED`、`revision += 1`。
5. `approve` / `reject`：同步写当前 submission 的 `review_outcome`、`reviewed_by/at`、`quality_*` 或 `reject_reason`。
6. `download-url`：实时复检权限（实际提交人、当前负责人、同社团 manager/super_admin，且成员状态有效）→ 返回 5 分钟签名地址；仅 `ATTACHED` 且 `scan_result = CLEAN` 可下载。
7. 幂等：`init/confirm/cancel/submit` 统一走 `IdempotencyPort`。同键同请求哈希返回原响应；命中记录但 `task_id` 或请求哈希不一致 → 409 `idempotency_conflict`；`submit` 另加数据库唯一约束兜底；窗口沿用已确认值：自动重试 24 小时、结果可查 7 天、幂等记录保留 30 天。
8. 过期与清理：`CONFIRMED` 草稿超 24 小时 → `EXPIRED`；定时任务清理 `PENDING_UPLOAD / VERIFYING / CANCELLED / EXPIRED` 的 staging 对象，删除前复查状态，绝不删除 `ATTACHED` 对象。

`Task` 响应扩展：`submissionId`、`submissionRound`、`attachmentCount`（最新轮附件数）。

### 1.5 infrastructure 层

1. 实体与仓库：`TaskSubmissionEntity`、`TaskAttachmentEntity`、`IdempotencyKeyEntity` + 对应 JPA 仓库。
2. Adapter：每个方法先 `tenantGucBinder.bindCurrentTransaction()`（照 `UserRepositoryAdapter`）；名额统计、状态迁移、幂等写入都用条件 UPDATE（`WHERE status = ...` / `WHERE ...`）保证并发安全。
3. `ClubTaskRepositoryAdapter`：认领、提交、通过、驳回、归档、改派时执行 `revision = revision + 1`。
4. 新建 `infra/storage/CosTaskAttachmentStorageAdapter implements TaskAttachmentStoragePort`：
   - 上传表单用 COS POST Object 直传表单（`key`、`policy`、`Signature`、`x-cos-security-token` 等，具体字段以 COS 官方 POST Object 文档为准）；policy 条件锁定 key 前缀与 `content-length-range` ≤ 10 MiB。
   - 下载用 `generatePresignedUrl`（5 分钟），附 `response-content-disposition=attachment; filename*=UTF-8''<urlencoded>`。
5. 编译：`mvn -q -pl rak-auth-infrastructure -am compile`

### 1.6 api 层

新建 `rak-auth-api/.../api/rest/club/ClubTaskAttachmentController.java`；修改 `ClubTaskController.java` 与 `ClubTaskService` 接线。路径前缀 `/api/v1/clubs/{clubId}`；下表除标注 `GET` 外均为 `POST`：

| 端点 | 权限 | 说明 |
| --- | --- | --- |
| `.../tasks/{taskId}/submission-attachments/init` | 负责人 | 契约 §4.1，返回上传表单 |
| `.../{attachmentId}/confirm` | 上传者 | 200 已确认 / 202 处理中 / 失败带稳定 code |
| `GET .../{attachmentId}` | 有查看权 | 响应丢失后的状态恢复 |
| `.../{attachmentId}/cancel` | 上传者 | 释放名额 |
| `.../tasks/{taskId}/submit` | 负责人 | body 改 `{ note, attachmentIds }`，省略 = 无附件 |
| `GET .../tasks/{taskId}/submissions` | 有查看权 | 交付历史分页，任务详情 `submissionAttachments` 只给最新轮 |
| `.../{attachmentId}/download-url` | 提交人/负责人/manager/super_admin | 5 分钟签名地址 |

1. 变更端点读取 `Idempotency-Key` 头；缺失时的处理方式写入 API.md 并保持一致。
2. 错误码按契约 §5 登记进全局错误表；HTTP 状态按仓库现有异常体系映射（`InvalidRequestException` / `ForbiddenException` / `ResourceNotFoundException` / `DuplicateResourceException`），最终以 API.md 为准。
3. 本地冒烟（Windows PowerShell，`curl.exe`；`$token` 来自测试账号登录，不要写入脚本文件）：

```powershell
$clubId = '<测试社团>'; $taskId = '<已认领任务>'
# 1) init
curl.exe -s -X POST "http://localhost:8080/api/v1/clubs/$clubId/tasks/$taskId/submission-attachments/init" -H "Authorization: Bearer $token" -H "Content-Type: application/json" -H "Idempotency-Key: $([guid]::NewGuid())" -d '{"fileName":"冒烟.pdf","sizeBytes":1024,"mimeType":"application/pdf"}'
# 2) 直传（字段取自 init 响应的 upload.formData / upload.url）
curl.exe -s -F "key=<formData.key>" -F "policy=<formData.policy>" -F "Signature=<formData.Signature>" -F "file=@C:\Temp\冒烟.pdf" "<upload.url>"
# 3) confirm → 4) submit（attachmentIds）→ 5) download-url → 6) 下载后 Get-FileHash 比对
```

完成标准：七个端点冒烟通过；用无权限账号请求 `download-url` 返回 403。

### 1.7 后端集成测试

新建 `rak-auth-app/src/test/java/.../TaskAttachmentIntegrationTest.java`（继承 `IntegrationTestBase`），用例与契约 §7 对齐：

1. init → 直传 → confirm → submit 全链路；返回 `submissionId`、`submissionRound`、`attachmentCount`。
2. 非负责人 init → 403；跨社团 token → 403。
3. A 任务附件 ID 提交到 B 任务 → 拒绝（按 API.md 的 code）。
4. 并发第 4 件 → 仅一个成功，另一个 `attachment_limit_exceeded`。
5. 0 字节、> 10 MiB、伪造 MIME/扩展名 → 明确错误码或受限结果。
6. 重复 confirm（同键）→ 同响应；同键不同 body → `idempotency_conflict`。
7. 同键重试 submit → 返回原 submission，不新增轮次。
8. 驳回 → 重提：旧轮附件仍可下载，旧附件不能用于新轮。
9. 停用成员 `download-url` → 403；过期会话 confirm → `attachment_session_expired`。
10. 对已确认 key 重放直传后再次下载，内容仍与首次确认一致；重放不改写已确认版本。

```bash
source .env && mvn -pl rak-auth-app -am test
git add . && git commit -m "feat: 任务交付附件（上传会话、交付历史、授权下载）"
```

完成标准：全部用例通过后再交付联调。

## 2. 小程序（rak-control）

前置：第 1 章的七个端点已在隔离环境可用。

### 2.1 类型、请求层与上传适配

1. `src/types/domain.ts`：
   - 新增 `RemoteTaskAttachment { id; name; size; mimeType?: string | null; submissionId: string; submissionRound: number; createdAt: string }`。
   - 新增 `TaskSubmission { id; round; note?; submittedByName?; submittedAt; reviewOutcome: 'PENDING' | 'APPROVED' | 'REJECTED'; qualityGrade?; rejectReason?; attachments: RemoteTaskAttachment[] }`。
   - 新增本地选择类型 `PickedFile { tempFilePath; name; size }`（`tempFilePath` 取自 `chooseMessageFile` 的 `file.path`）；原 `TaskSubmissionAttachment` 改名为演示专用（如 `DemoTaskAttachment`），远程流程一律用新类型。
   - `Task` 增加 `submissionId?: string`、`submissionRound?: number`、`attachmentCount?: number`。
2. `src/utils/request.ts`：
   - `RequestOptions` 增加 `headers?: Record<string, string>` 与 `idempotencyKey?: string`；发送时合并为 `Idempotency-Key` 头；401 静默续登重放沿用同一 options，键不变。
   - `CODE_MESSAGES` 增补：`attachment_limit_exceeded`、`attachment_too_large`、`attachment_session_expired`、`attachment_not_confirmed`、`attachment_content_mismatch`、`attachment_scan_blocked`、`idempotency_conflict`（文案见附录 A）。
3. 新建 `src/services/task-attachment-upload.ts`：

```ts
export interface UploadProgress { loaded: number; total: number }

// 依赖注入以便 Node 测试；真实 Taro API 由 src/services/task.ts 组装时传入
export function createTaskAttachmentUpload(deps: {
  request: ServiceRequest
  uploadFile: typeof Taro.uploadFile
  downloadFile: typeof Taro.downloadFile
}): {
  uploadTaskAttachment(taskId: string, file: PickedFile, onProgress?: (p: UploadProgress) => void): Promise<RemoteTaskAttachment>
  cancelTaskAttachment(taskId: string, attachmentId: string): Promise<void>
  downloadTaskAttachment(taskId: string, attachmentId: string): Promise<{ filePath: string; name: string }>
}
```

   实现顺序：`init`（带幂等键）→ `deps.uploadFile({ url, filePath: file.tempFilePath, name: fileFieldName, formData, header })`（禁止带 Rak token）→ `confirm`；返回 202 时每 2 秒重试同一 confirm（复用幂等键），60 秒未完成按失败处理、允许用户重试。

   下载顺序：`download-url` → `deps.downloadFile({ url })` → 校验 `statusCode` 与 `filePath`；地址过期（403/过期码）自动重取一次，仍失败按 `ApiError` 抛出。

### 2.2 领域服务、演示模式与页面

1. `src/services/domain-entry.ts` + `src/services/task.ts`：
   - 新增并导出：`initAttachmentUpload`、`confirmAttachmentUpload`、`fetchTaskAttachment`、`cancelTaskAttachment`、`fetchTaskSubmissions`、`uploadTaskAttachment`（组合 init → 直传 → confirm）、`downloadTaskAttachment`。
   - `submitTask(id, note, attachmentIds: string[] = [])`：API 模式请求体改为 `{ note, attachmentIds }`；删除现有“含附件直接报错”分支。
   - `src/store/index.ts` 的任务 store `submit` 同步改为 `(id, note, attachmentIds?: string[])`，移除对 `TaskSubmissionAttachment` 的导入。
   - 上传适配层只被任务领域入口调用，页面不直接拼签名或存储字段。
2. 演示模式对齐（`src/demo/adapter.ts`、`src/demo/services.ts`）：
   - 任务增加 `submissions` 历史数组；`submitTask` 追加一轮（round 递增），`submissionAttachments` 取最新轮。
   - 演示上传：选择文件后 `Taro.saveFile` 到本机并登记草稿（id / name / size / localPath）；`submitTask(ids)` 按 id 取回写入本轮，未知 id 报错；移除草稿时 `Taro.removeSavedFile`。
   - `approveTask` / `rejectTask` 写回对应轮次；恢复演示数据时一并清空。
3. `src/pages/task/detail.tsx`：
   - 选择文件后立即逐个上传；每个文件显示状态：上传中（带进度）/ 校验中 / 已就绪 / 失败（可重试、可移除）。移除已上传项调用 `cancelTaskAttachment`。
   - 提交按钮门禁：存在上传中、校验中或失败的附件时不可提交；提交幂等键在首次点击时生成，页面 state 保存，失败重试复用，成功或离开页面后清空。
   - 最新交付附件改为渲染远程元数据；点击时调用 `downloadTaskAttachment`（下载授权 + 下载 + 过期重试都在适配层），再按既有分支预览（图片/视频/文档判断复用 `src/utils/task-attachments.ts`）；其他格式提示已下载及保存位置。
   - 提交成功后的清理只针对本机缓存与演示数据；不再删除上一轮附件（远程对象由服务端保管，契约 §6.8）。
   - 新增「交付历史」区块：轮次、说明、结果（待验收/通过/驳回及原因）、每轮附件列表与下载入口。
   - 删除 `canPersistAttachments` 门禁与“当前连接的 Rak 服务端尚未支持附件上传，请先移除附件再提交”提示。
4. 列表徽标：`src/pages/task/pool.tsx` 与 `src/subpackage-admin/pages/admin/review.tsx` 在任务卡片显示 `attachmentCount`（>0 时）。
5. 测试（主改 `tests/demo-services.test.ts`；seam 保持领域服务入口，沿用现有写法，其中“API 模式含附件报错”“重提替换附件”的旧断言按新行为改写）：
   - API 模式 `submitTask(id, note, ['a1'])` 上报 `{ note, attachmentIds: ['a1'] }`。
   - 上传适配：用 fake `request` / `uploadFile` 调 `createTaskAttachmentUpload`（测试不引入 Taro）；成功路径返回 `RemoteTaskAttachment`，失败路径不产生“已就绪”且可重试。
   - `attachment_*` 与 `idempotency_conflict` 错误码映射为用户文案。
   - 演示模式：驳回重提后历史保留两轮、最新轮附件正确。

```powershell
pnpm test
pnpm build:weapp
```

完成标准：两条命令通过；演示模式与 API 模式行为都覆盖。

### 2.3 联调

1. 构建指向测试 API 的开发版（本机后端才允许 HTTP）：

```powershell
$env:TARO_APP_DEMO = 'false'
$env:TARO_APP_API_BASE = 'http://localhost:8080'   # 模拟器联调用；真机换成可达的 https://<测试 API 域名>
pnpm build:weapp
Remove-Item Env:TARO_APP_DEMO, Env:TARO_APP_API_BASE
```

2. 微信开发者工具导入 `rak-control` 根目录；开发期可关闭域名校验，联调结束前打开复测一次（见 `docs/WECHAT-DEVTOOLS-GUIDE.md`）。
3. 双设备真机流程：
   - 成员：认领任务 → 选 2 个文件（PDF + 压缩包）→ 上传 → 提交。
   - 管理员（另一台设备、manager 或 super_admin）：打开同一任务 → 逐个下载附件，SHA256 与原文件一致（`Get-FileHash -Algorithm SHA256`）。
   - 管理员驳回 → 成员上传替换文件重提 → 历史中旧轮 2 个文件仍可打开。
4. 完成标准：契约 §7 场景全部通过；任一失败先在对应侧修复，不放行发布。

## 3. 微信公众平台配置

1. 登录公众平台 → 开发管理 → 开发设置 → 服务器域名：
   - request 合法域名：API 域名。
   - uploadFile 合法域名：COS 上传域名。
   - downloadFile 合法域名：COS 下载域名。
2. 域名要求：HTTPS、已备案、默认 443 端口、证书有效；不能填 IP 或 localhost。
3. 「用户隐私保护指引」中声明“选中的文件”用途（交付附件上传）。
4. 配置完成 → 开发者工具重新编译并开启域名校验 → 真机复测上传与下载各一次。

## 4. 发布顺序

1. 先发后端：新端点向后兼容，旧版小程序（不带 `attachmentIds`）不受影响。
2. 域名生效后发小程序体验版，按 2.3 完成两台真机验收。
3. 验收通过后提审发布；`final/` 对象与交付历史数据保留。
4. 回滚：小程序回退上一版本即可；后端保留接口与数据，staging 由生命周期自动清理。

## 5. 最终验收清单

- [ ] 后端集成测试全绿（1.7 的 10 组用例）
- [ ] `pnpm test`、`pnpm build:weapp`、`pnpm build:weapp:prod` 通过
- [ ] 跨设备上传 → 下载 SHA256 一致
- [ ] 非负责人 / 跨社团 / 停用成员访问 → 403；过期签名地址失效
- [ ] 3 件上限、10 MiB 上限、0 字节、伪造扩展名均有明确结果
- [ ] 驳回重提：旧轮历史与附件完整保留，旧附件不能复用
- [ ] 开启合法域名校验后真机全流程通过
- [ ] 隐私指引包含“选中的文件”

## 附录 A：错误码 → 小程序文案

| code | 场景 | CODE_MESSAGES 文案建议 |
| --- | --- | --- |
| attachment_limit_exceeded | 每轮第 4 件 | 每轮最多 3 个附件 |
| attachment_too_large | 超 10 MiB | 单个附件不能超过 10 MB |
| attachment_session_expired | 上传会话过期 | 上传已过期，请重新选择文件 |
| attachment_not_confirmed | 未确认即提交 | 附件尚未准备好，请稍后重试 |
| attachment_content_mismatch | 内容与声明不符 | 文件校验未通过，请重新上传 |
| attachment_scan_blocked | 扫描拦截 | 该文件未通过安全扫描 |
| idempotency_conflict | 同键不同请求 | 操作冲突，请刷新后重试 |
| task_invalid_transition | 状态不允许（已有） | 任务当前状态不允许此操作 |

## 附录 B：涉及文件

| 仓库 | 文件 | 动作 |
| --- | --- | --- |
| rak-auth | `docs/API.md`、`docs/adr/adr-XXXX-task-submission-attachments.md` | 修改 / 新建 |
| rak-auth | `rak-auth-app/src/main/resources/db/migration/V7__task_submission_attachments.sql` | 新建 |
| rak-auth | `rak-auth-core` 的 domain / repository port / service | 新建 |
| rak-auth | `rak-auth-infrastructure` 的 entity / repo / adapter / `CosTaskAttachmentStorageAdapter` | 新建 |
| rak-auth | `rak-auth-api` 的 `ClubTaskAttachmentController`、`ClubTaskController`、`ClubTaskService` | 新建 / 修改 |
| rak-auth | `rak-auth-app/src/test/java/.../TaskAttachmentIntegrationTest.java` | 新建 |
| rak-control | `src/types/domain.ts`、`src/utils/request.ts` | 修改 |
| rak-control | `src/services/task-attachment-upload.ts` | 新建 |
| rak-control | `src/services/domain-entry.ts`、`src/services/task.ts`、`src/store/index.ts` | 修改 |
| rak-control | `src/demo/adapter.ts`、`src/demo/services.ts` | 修改 |
| rak-control | `src/pages/task/detail.tsx`、`src/pages/task/pool.tsx`、`src/subpackage-admin/pages/admin/review.tsx` | 修改 |
| rak-control | `tests/` 新增或扩展用例 | 新建 / 修改 |
