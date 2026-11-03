# 提案：Rak 任务交付附件契约

> 状态：待 `rak-auth` 采纳、实现并合入其 `docs/API.md`；本文接口尚未实现。
>
> 目标：成员提交可选文件附件，负责人、同社团管理员和超级管理员可跨设备查看并验收；驳回重提保留旧交付。
>
> 架构：沿用 `rak-auth` 作为任务与权限的业务后端。本地原订阅提醒云函数已于 2026-10-16 移除，附件方案不依赖它们。
>
> 实施教程（本仓库）：[TASK-ATTACHMENTS-GUIDE.md](../TASK-ATTACHMENTS-GUIDE.md)

## 1. 当前能力与待补齐部分

当前小程序在本地演示中能选择、保存、移除附件，提交后可在任务详情打开。本机路径无法供其他手机读取，云环境 ID 也不会自动上传文件或关联任务。

| 部分 | 负责事项 | 当前状态 |
| --- | --- | --- |
| `rak-auth` | 任务鉴权、上传授权、文件确认、交付历史、授权下载 | 本仓库没有此后端源码，需在后端仓库实现 |
| 私有对象存储 | 保存文件内容，提供短期上传和下载能力 | 实际存储、域名及服务端配置尚未确认 |
| 小程序 | 上传进度及重试、远程附件提交、管理者下载查看、交付历史 | 本机演示已实现；远程接入待后端契约通过 |

演示 `Task.submissionAttachments` 只表示最新交付，重提会替换附件并清理旧的本机文件。本文的交付历史与跨设备共享是待开发能力，不能把演示验收视为后端验收。

## 2. 推荐方案与上传协议

建议第一版使用腾讯云 COS 私有存储，业务授权仍由 `rak-auth` 完成。本契约不依赖 CloudBase 环境，上传权限由业务后端显式签发。

固定采用 **HTTPS multipart POST** 直传，适配小程序 `Taro.uploadFile`。后端存储适配层生成存储方支持的签名表单，返回上传 URL、文件字段名和表单字段。不要将 PUT 签名 URL 交给 `uploadFile`；其他存储若仅支持 SDK 上传，应先修订适配契约并联调。

1. 负责人在 `CLAIMED` 或 `REJECTED` 任务中选文件，请求创建上传会话。
2. 后端检查有效成员身份、社团、负责人、任务状态和附件名额，为下一交付轮次预留名额，签发建议有效期 10 分钟的上传授权。
3. 小程序直传到私有临时区，只使用上传授权，不把 Rak 登录令牌发给对象存储。
4. 小程序请求确认；后端验证实际对象、大小、版本、内容和安全扫描结果，保存客户端不能覆盖的正式对象，再标记 `CONFIRMED`。
5. 成员提交说明和已确认附件 ID。后端在同一数据库事务中创建交付、关联附件、将任务改为 `SUBMITTED` 并写审计事件。
6. 管理者查看当前或历史交付，点击文件时请求授权下载；后端重新鉴权，返回建议有效期 5 分钟的下载地址。

上传授权在有效期内通常可重用，不能仅凭随机路径声称“一次性”。临时对象不能直接成为验收文件：须启用临时对象版本追踪或等效不可变策略，确认时锁定实际版本，校验、扫描并复制该版本到仅服务端可写的正式区。客户端重放上传不能更改已确认文件。

## 3. 数据模型与一致性

### 3.1 新增交付记录 `club_task_submissions`

现有任务最新状态字段不足以保存多轮交付，需增加独立记录：

| 字段 | 约束与含义 |
| --- | --- |
| `id` | 服务端生成的交付 ID |
| `task_id` / `club_id` | 任务与社团；社团由服务端从任务推导 |
| `round` | 服务端生成的正整数，`UNIQUE(task_id, round)` |
| `submitted_by` / `note` / `submitted_at` | 实际提交人、说明及服务端时间 |
| `reviewed_by` / `reviewed_at` / `review_outcome` | 本轮验收人、时间及待验收/通过/驳回结果 |
| `quality_grade` / `quality_note` / `reject_reason` | 保留本轮评价与驳回理由 |

已有 `Task` 字段继续表示最新轮次。交付轮次的验收结果不新增任务业务状态。旧数据有说明或提交时间时可迁移为有明确迁移标记的单条记录，不虚构旧轮次。

### 3.2 上传会话及附件 `club_task_submission_attachments`

| 字段 | 约束与含义 |
| --- | --- |
| `id` | 服务端生成的附件/会话 ID |
| `task_id` / `club_id` / `round` | 绑定任务和预留轮次；不能由客户端任意指定 |
| `uploaded_by` | 获得上传授权的用户，与提交人一致 |
| `submission_id` | 草稿时为空，提交后关联交付记录 |
| `task_revision` | 预留时的任务修订标记，确认与提交时检查失效 |
| `staging_object_key` / `staging_version` | 临时对象内部定位及存储侧版本 |
| `final_object_key` / `final_version` | 仅服务端可写的正式对象定位 |
| `original_name` | 展示名称，不作为对象路径 |
| `declared_mime_type` / `detected_mime_type` | 客户端声明类型与服务端检测类型 |
| `declared_size_bytes` / `verified_size_bytes` | 声明大小与存储侧实际大小 |
| `verified_checksum_sha256` / `scan_result` | 服务端验证的摘要及扫描结果 |
| `status` / `expires_at` / `created_at` / `confirmed_at` | 会话状态及记录时间 |

数据库通过外键及组合约束保证关联的交付与附件任务、社团、轮次、上传人一致。对象 key 唯一，逻辑分区至少含社团、任务、轮次和附件 ID；路径不代替权限校验。最终迁移遵循 `rak-auth` 的 Flyway 和 schema 规范。

### 3.3 状态、名额与事务

```text
PENDING_UPLOAD → VERIFYING → CONFIRMED → ATTACHED
        ↓            ↓           ↓
 CANCELLED / EXPIRED / BLOCKED（终态，释放草稿名额）
```

- 每轮最多 3 件，每件最多 **10 MiB = 10,485,760 字节**，空文件拒绝；与当前 UI 标注 10 MB 对应。
- `init` 锁定任务并原子计算当前轮次有效会话数量；`PENDING_UPLOAD`、`VERIFYING`、`CONFIRMED` 均占名额，并发不得突破 3 件。
- 后端确定下一轮，不接受客户端递增。`task_revision` 表示任务状态、负责人等影响提交的业务修订；创建其他上传会话或无关字段更新不得令它递增，避免第 2 个文件使第 1 个文件失效。负责人、任务状态或提交权限改变时旧会话失效；确认和提交检查任务修订及实时权限。
- `confirm` 原子取得处理权，避免并发扫描/复制；重复确认返回同一状态，失败文件不能提交。异步处理完成只能条件更新 `VERIFYING → CONFIRMED`，已取消、过期或阻断的会话绝不复活；清理对象前重新检查数据库状态，不得删除已 `ATTACHED` 对象。
- `submit` 锁定任务和附件，校验数量、去重、同轮、同任务、同用户、`CONFIRMED` 且未失效，在同一事务中创建交付、标记 `ATTACHED`、迁移任务状态和记录审计。
- `approve` / `reject` 同步更新当前交付评价及原有任务状态；重提创建新轮次，旧交付及附件保留；归档仍沿用 `DONE`。
- 无附件提交合法。未选中的草稿会话在提交后关闭，不跨轮复用。已关联附件不能被重复使用。
- 存储复制与数据库不能跨系统原子提交，需用确定的正式 key、幂等处理及补偿清理处理孤立对象；`ATTACHED` 对象不参与草稿回收。

建议上传确认窗口 30 分钟、已确认草稿有效期 24 小时；取消/过期临时对象在 24 小时内清理。正式附件保留、备份和删除周期由社团及运维定稿，不能沿用草稿删除策略。

## 4. API 草案

沿用 `/api/v1/clubs/{clubId}/tasks/{taskId}`。业务接口使用 Rak 认证，错误沿用 RFC 7807 + 稳定 `code`。社团 ID 仅用于定位，权限来自有效成员及任务关系。

`init`、`confirm`、`submit`、`cancel` 使用 `Idempotency-Key`，同一操作重试复用原键。键绑定用户、操作路由、任务和请求摘要，同键不同 body 返回冲突。建议自动重试 24 小时、结果查询 7 天、幂等记录保留 30 天，最终由后端统一落仓确认；过期授权及取消/过期会话不能因重放而复活。

### 4.1 创建上传会话

```http
POST /api/v1/clubs/{clubId}/tasks/{taskId}/submission-attachments/init
Idempotency-Key: <uuid>
Content-Type: application/json
```

```json
{ "fileName": "活动方案.pdf", "sizeBytes": 245760, "mimeType": "application/pdf" }
```

```json
{
  "attachmentId": "uuid",
  "round": 1,
  "status": "PENDING_UPLOAD",
  "upload": {
    "kind": "multipart-post",
    "url": "https://<private-storage-upload-domain>/",
    "fileFieldName": "file",
    "formData": { "key": "<server-generated-staging-key>", "<provider-signature-field>": "<short-lived-value>" },
    "headers": {},
    "expiresAt": "2026-10-12T12:10:00Z"
  },
  "confirmExpiresAt": "2026-10-12T12:30:00Z",
  "maxBytes": 10485760
}
```

实际签名字段由存储适配层提供，示例不能直接用于生产。授权严格限定临时 key、有效期和大小范围，不授予列表、删除或读取其他对象的权限。表单中的 key 是上传必需的内部定位，普通附件元数据不返回 object key。

### 4.2 确认及查询上传结果

```http
POST /api/v1/clubs/{clubId}/tasks/{taskId}/submission-attachments/{attachmentId}/confirm
Idempotency-Key: <uuid>
```

确认只需要会话 ID，不接受客户端指定存储路径或宣称扫描成功。后端验证对象实际版本、大小和内容；文件名、MIME、大小、ETag 均不作为客户端可信声明，ETag 不等同于 SHA-256。

- 扫描处理中：`202` + `{ "attachmentId": "uuid", "status": "VERIFYING" }`，轮询期间不可提交。
- 成功：`200` + `{ "id": "uuid", "name": "活动方案.pdf", "size": 245760, "status": "CONFIRMED", "round": 1, "expiresAt": "2026-10-13T12:00:00Z" }`。
- 校验失败：稳定错误码；不可覆盖失败结论，需重新创建会话。

```http
GET /api/v1/clubs/{clubId}/tasks/{taskId}/submission-attachments/{attachmentId}
```

仅返回有权查看的会话状态或附件元数据，用于响应丢失后的恢复。失效及内容不符必须有明确结果。

### 4.3 移除未提交附件

```http
POST /api/v1/clubs/{clubId}/tasks/{taskId}/submission-attachments/{attachmentId}/cancel
Idempotency-Key: <uuid>
```

仅上传者可取消自己的草稿。后端原子改为 `CANCELLED`、释放名额并安排清理；`ATTACHED` 不可经此接口删除，验收时不提供直接删除交付文件的入口。

### 4.4 提交交付

保持现有路径，body 增加附件 ID；省略或空数组表示无附件：

```http
POST /api/v1/clubs/{clubId}/tasks/{taskId}/submit
Idempotency-Key: <uuid>
Content-Type: application/json
```

```json
{ "note": "已完成并附上最终方案", "attachmentIds": ["uuid"] }
```

执行 §3.3 事务校验，返回更新后的 `Task`，包括最新 `submissionId`、`submissionRound` 和有权限查看的附件元数据。同键重复提交返回原交付结果，不产生新轮次。

### 4.5 交付历史和附件元数据

```http
GET /api/v1/clubs/{clubId}/tasks/{taskId}/submissions?page=0&size=20
```

分页返回交付 ID、轮次、说明、提交人/时间、该轮验收结果及附件。任务详情的 `submissionAttachments` 仅返回最新一轮。

```json
{
  "id": "uuid",
  "name": "活动方案.pdf",
  "size": 245760,
  "mimeType": "application/pdf",
  "submissionId": "uuid",
  "submissionRound": 1,
  "createdAt": "2026-10-12T12:00:00Z"
}
```

元数据不含 `localPath`、存储 key、签名或永久链接。仅实际提交人、当前负责人及同社团有任务验收权限的 `manager` / `super_admin` 可查看，均须有效成员身份。普通非负责人最多看附件数量，不得返回文件名、交付内容和历史详情。

### 4.6 授权下载

```http
POST /api/v1/clubs/{clubId}/tasks/{taskId}/submission-attachments/{attachmentId}/download-url
```

```json
{ "url": "https://<private-storage-download-domain>/<short-lived-signed-url>", "expiresAt": "2026-10-12T12:05:00Z" }
```

每次签发重新检查用户启用状态、社团成员状态、任务/交付关系、角色和权限。仅 `ATTACHED` 且扫描通过的文件可下载，不接受客户端指定 key。

5 分钟签名有效期内，链接持有者可能仍能下载，成员停用不能立即撤销已签出的链接；若要求即时撤销，改用服务端鉴权下载代理，并补充容量和限流配置。

## 5. 文件格式与安全处理

选择器保持 `chooseMessageFile({ type: 'all' })`，不按扩展名硬性排除格式；来源和可见文件仍受微信平台限制。“可选择和下载”不等于“能在微信内预览”。

- 图片/视频用微信支持的预览，PDF/Office 用 `openDocument`；压缩包、工程源文件和其他格式提供下载/保存提示，不假装能直接打开。
- 文件名限制长度并拒绝控制字符和非法路径内容，展示按普通文本处理。扩展名和 MIME 不可信，由服务端检测实际类型。
- 私有存储禁止匿名读写，关闭网页静态托管。下载使用安全的 `Content-Disposition: attachment` 文件名处理；HTML/SVG/脚本不得作为网页内联运行。
- 确认前隔离扫描，限制扫描资源和压缩包展开深度/大小。加密包或无法扫描的文件有明确受限结果，不能标成安全；是否人工复核后放行须上线前定稿。
- 上传、存储及查询设限流和社团容量配额。审计记录操作者和附件 ID，日志隐藏签名 URL、授权字段与令牌。

建议错误码沿用 Rak 的小写命名：`attachment_limit_exceeded`、`attachment_too_large`、`attachment_session_expired`、`attachment_not_confirmed`、`attachment_content_mismatch`、`attachment_scan_blocked`、`task_invalid_transition`、`idempotency_conflict`。身份及权限错误沿用 Rak 规则，最终以合入的 `docs/API.md` 为准。

## 6. 小程序与任务管理接入

集中在任务领域入口及上传适配层实现，不把签名、轮询和权限散落页面：

1. 演示 `{ id, name, size, localPath }` 与远程附件 DTO 分开建模。远程详情不能打开提交者本机路径，`fileName/sizeBytes` 到 `name/size` 的映射集中处理。
2. 统一 HTTP 层加入受控 `idempotencyKey`，登录刷新和网络重试复用原键。对象存储上传单独封装，不带 Rak token。
3. 封装创建会话 → `Taro.uploadFile({ url, filePath, name: fileFieldName, formData, header: headers })` → 确认/轮询，提供进度、失败、重试及取消。
4. 上传或扫描未完成时禁止提交，确认后提交附件 ID。提交响应丢失使用原键恢复，不立即创建新轮次；未实施接口不伪装成功。
5. 管理员和超级管理员待验收列表显示附件数量，详情显示名称、大小、说明及下载入口；普通非负责人只看允许公开的信息。
6. 详情增加交付历史，逐轮显示说明、附件、通过/驳回记录，后端验收接口同步写入对应轮次。
7. 点击远程文件先请求授权，再 `Taro.downloadFile`，检查 HTTP 状态和下载结果后预览/保存；过期重新授权，无权限明确提示。
8. 重提只清本机草稿或下载缓存，移除现有“重提成功删除旧轮附件”的生产路径。客户端不得删除已提交远程对象。

当前 API 模式禁止带本机附件提交并提示服务端未接入；保护行为待真实接口完成后再切换。

## 7. 联调与验收

小程序已确认的测试位置是领域服务入口。现有自动化验证本机演示和 API 未接入时拒绝本机附件，不能证明存储及后端安全通过。

后端实施后，通过真实认证入口、私有测试存储及任务 API 验证：

- 成员上传、提交后，另一设备管理员和超级管理员能下载原文件，内容一致。
- 普通非负责人、跨社团、停用及退出成员无法读取元数据、历史或请求下载授权。
- A 任务、其他上传者、旧轮次及未确认附件不能用于 B 任务或新交付。
- 并发第 3/4 个名额只能一个成功；取消释放名额，与确认/提交竞争不会产生错误可下载对象。
- 0 字节、10 MiB 边界、超限、虚假大小/MIME、扫描失败及恶意压缩包得到明确结果。
- 上传重放不能替换已确认/已交付文件，临时 key、匿名访问、过期 URL 不绕过鉴权。
- 重复确认/提交、响应丢失和事务失败不产生重复轮次，可恢复或清理孤立对象。
- 驳回重提保留旧轮说明、附件和评价；最新信息对应新轮，归档不公开文件。
- 启用微信域名检查，在真机验证上传/下载及支持的预览，未知格式给出保存提示。

## 8. 需要你协助的配置

| 事项 | 如何完成 |
| --- | --- |
| 后端代码或维护者 | 提供真正的 `rak-auth` 源码仓库/目录，或将本文交给维护者；前端仓库无法修改未提供的后端 |
| 隔离测试环境 | 后端实现后提供测试 API 地址、测试社团和成员/管理员/超级管理员身份，登录走正常流程 |
| 私有存储 | 后端运维配置 bucket、签名、扫描、临时/正式区权限、版本保护与清理；密钥仅在服务端 |
| 微信域名 | 有权限的公众平台账号配置 API request 域名、实际存储 uploadFile/downloadFile HTTPS 域名，并核查证书与地域要求 |
| 保留与特殊文件 | 确认正式附件保留/删除期限、容量和无法扫描加密包处理；建议沿用最多 3 件、单件 10 MiB |

已有 AppID `wxa8bf102dcfdcec4c`、环境 `cloud1-d4g36r8z6a8908540` 不需要重索取，它们不代替后端代码、存储权限或合法域名。无需将 AppSecret、存储密钥、API key 或 access token 发到聊天或写进小程序。

交付顺序：后端实现并更新 `docs/API.md` → 私有存储与 HTTPS 域名配置 → 小程序及任务管理接入 → 两种管理角色及跨设备真机验收。全部通过后才将真实附件共享标为完成。
