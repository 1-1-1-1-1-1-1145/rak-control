# 云-v2 接口契约（cloud-v2.md）

本文件是云-v2 协议的**单一来源**：信封、scope、动作注册表、错误码、DTO 字段投影、游标与命令语义。
代码侧 `server/contracts/*`、`infra/cloudbase/*` 与本文件保持一致；不一致以代码 + 本文件同时修正。

状态：**M1–M6 已落地并本地验证（M6：公告/ROI/绩效/社团摘要/所有本队列表；附件 file.* 与真实云入口仍未实现，返回 `not_implemented`）**。
依据：多团队 DESIGN §5–§11；BASE-DESIGN §8/§9.2/§10。ADR：[adr-0006](../adr/adr-0006-cloudbase-multiteam-backend.md)。

## 1. 信封（apiVersion=2）

```ts
type RequestScope = { kind: 'GLOBAL' } | { kind: 'TEAM'; clubId: string }

type CloudRequest<T> = {
  apiVersion: 2
  action: string              // 仅注册表常量
  scope: RequestScope         // TEAM 必须带 clubId；该字段不授予权限
  requestId: string           // 仅诊断，不做幂等
  mutationId?: string         // UUIDv7；命令幂等键的一部分
  expectedRevision?: number   // 明确业务资源的期望版本
  data: T
}

type CloudResponse<T> =
  | { ok: true;  requestId: string; scope: RequestScope; data: T; serverTime: string }
  | { ok: false; requestId: string; scope: RequestScope | null; error: AppErrorShape; serverTime: string }
```

- `requestId` 与 `mutationId` **不可混用**：前者诊断，后者幂等。
- 校验失败（信封/注册表/scope）返回 `ok:false`；scope 解析前的失败 `scope=null`、`requestId=''`。
- 响应 `scope` 必须等于发起时捕获的请求 scope；客户端据此校验。

## 2. 拒绝规则（fail-closed）

- `apiVersion !== 2` → `validation_failed`。
- `action` 未注册 → `validation_failed`（无默认泛 CRUD）。
- scope 种类与动作声明不符 → `scope_mismatch`；TEAM 缺 clubId → `scope_mismatch`。
- `data` 任意层级出现归属/自报授权字段（`clubId/teamId/tenantId/companyId/userId/openid/actorRole/actorId/permissions`）→ `validation_failed`。
- 动作被发到错误函数（如 `file.*` → rakApi）→ `validation_failed`。
- 已注册但未实现 → `not_implemented`（发布门禁禁止所需动作长期停留此状态）。

## 3. 动作注册表（fn / scope）

| 动作 | 函数 | scope |
|---|---|---|
| `auth.bootstrap` `auth.me` `account.provisioningReference` | api | GLOBAL |
| `team.listMine` `team.resolveJoinTarget` | api | GLOBAL |
| `team.enter` `team.joinLink.rotate` | api | TEAM |
| `join.mine` `join.status` `join.submit` `invite.redeem` | api | GLOBAL |
| `command.status` | api | EITHER（与原命令同 scope） |
| `member.updateMyProfile` `member.updateProfile` `member.list` `member.setRole` `member.setStatus` | api | TEAM |
| `join.list` `join.approve` `join.reject` | api | TEAM |
| `invite.list` `invite.create` `invite.revoke` `invite.qr` | api | TEAM |
| `club.get` `club.update` `club.dashboard` `profile.summary` | api | TEAM |
| `task.list/get/create/update/claim/submit/approve/reject/archive` | api | TEAM |
| `submission.list` `submission.get` | api | TEAM |
| `announcement.*`（list/get/create/update/publish/archive） | api | TEAM |
| `roi.*`（list/get/create/update/delete/overview） | api | TEAM |
| `performance.mine` `performance.list` | api | TEAM |
| `file.init/status/confirm/cancel/downloadUrls/previewDraft/putChunk` | files | TEAM |

细化的逐动作 schema/角色/资源关系见 [action-matrix-2026-10-17.md](../verification/action-matrix-2026-10-17.md)。

## 4. 错误码

见 `server/contracts/errors.ts`（`ERROR_CODES`）。语义分组：身份/环境、开通/入会、授权/资源、校验/并发、幂等/限流、能力/未知。
统一约定：异队/不存在一律 `resource_not_found`（不泄露存在性）；`result_unknown`/`rate_limited`/`storage_unavailable`/`stats_unavailable`/`internal_error` 可重试。
`not_implemented` 仅限开发期，生产门禁禁止所需动作保留它。

## 5. DTO

- `AccountView`：`backend/env/appId/accountKey/securityState/asOf`，**无**团队角色/姓名/职务。
- `TeamSession`：`club{id,name,displayCode,status}`、`member{id,displayName,duty,role,status,revision}`、`permissions`、`asOf`。
- `TeamListItem`：`clubId/name/displayCode/role/status/canEnter`（仅最小队摘要，无各队业务统计）。
- `JoinTargetView`：`clubId/name/displayCode/joinTargetToken/expiresAt`（仅被有意分享的最小目标）。
- `Page<T>`：`items/nextCursor/hasMore/asOf`。
- 业务参与者字段用 memberId（`assigneeMemberId`/`createdByMemberId`/`authorMemberId`/`submittedByMemberId`/`reviewedByMemberId`），不把 memberId 硬塞旧 `userId`。
- `TaskView`：`taskId/clubId/title/description/category/repo/acceptanceCriteria/status/assigneeMemberId/claimedAt/submittedAt/currentRound/revision/createdByMemberId/createdAt/updatedAt`；公共视图**不含**他人 `note`/`attachmentIds`。
- `SubmissionView`：`submissionId/clubId/taskId/round/submittedByMemberId/note/attachmentIds/status/reviewGrade/reviewNote/reviewedByMemberId/reviewedAt/createdAt`（仅负责人与 manager+ 可读）。
- `MemberView`：`memberId/displayName/duty/role/status/joinedAt/revision`（无全局 userId/openid）。

### 5.1 M6 DTO 投影

- `AnnouncementView`：`announcementId/clubId/title/body/pinned/status(DRAFT|PUBLISHED|ARCHIVED)/authorMemberId/publishedAt/revision/createdAt/updatedAt`；普通成员仅见 `PUBLISHED`。
- `AnnouncementSummary`：`announcementId/title/pinned/publishedAt/createdAt`（首页/dashboard 最小摘要，无正文）。
- `RoiItemView`：`roiId/clubId/title/category/costCents/revenueCents/participants/periodStart/periodEnd/accountingDate/status/notes/roiRatio/createdByMemberId/createdAt/updatedAt/revision`。
  **金额为人民币分整数（CNY_CENTS）**；输入为元十进制字符串（`0..999999999.99`，最多 2 位小数）。`accountingDate` 为上海业务日 `YYYY-MM-DD`。
- `RoiOverviewView`：`period/totalCost/totalRevenue/net/roiRatio/itemCount/series[{label,cost,revenue}]/seriesWindow:'last6'/includesCancelled:true/currencyUnit:'CNY_CENTS'/asOf`。
  口径：同 `clubId`、`deletedAt==null`、含 `PLANNING/ACTIVE/DONE/CANCELLED`；`cost==0 → roiRatio=null`；趋势窗口固定为相对当前月的最近 6 个自然月并缺月补 0，`period=all` 时总额覆盖全部但 `seriesWindow` 仍为 `last6`。
- `PerformanceView`：`memberId/displayName/duty/role/claimedCount/approvedCount/rejectedCount/inProgressCount/completionRate/avgQualityScore/compositeScore`。
  口径：`rejectedCount` 为曾有 REJECTED 交付的**去重 task 数**；等级分 A/B/C/D=90/75/60/40；`completionRate=approved/claimed`（无认领为 0）；`compositeScore=round(completionRate×均分)`，缺均分按 0。超扫描预算返回 `stats_unavailable`。
- `ClubView`：`clubId/name/slug/displayCode/status/settings/revision/createdAt/updatedAt`（**不含** legacy `tenantId`）。可写白名单：`name/description/logoUrl` + `settings{memberDirectoryVisible:boolean}`。
- `ClubDashboardView`：`clubId/activeMemberCount/openTaskCount/myInProgressCount/mySubmittedCount/latestPublishedAnnouncements/asOf`；manager+ 额外 `pendingReviewCount/topPerformers(≤5)`。**不输出 `total`**；名册关闭仍返回授权在册总数，无成员明细。
- `ProfileSummaryView`：`clubId/memberId/taskCounts{claimed,approved,rejected,inProgress}/performance/asOf`（仅本人）。

## 6. 游标

`cursor = base64url({ v:1, action, clubId|null, fingerprint, sort[] })`。
解码时校验 action/clubId/fingerprint；不符 → `cursor_scope_mismatch`。账户级列表（team.listMine/join.mine）`clubId=null` 绑定 account。
分页失败不推进游标；筛选/身份/环境变化即清空。

## 7. 命令与结果未知

- 命令键 = `hash(canonical(scope), actorIdentityId, action, mutationId)`；A/B 两队同 mutationId 属不同命名空间。
- `inputHash` = `hash(canonicalJson({apiVersion, action, scope, data, expectedRevision}))`，**排除** requestId。
- 窗口：重试 24h / 完整结果 7 天 / 幂等保留 30 天；UUIDv7 内嵌时间做年龄门禁（未来偏差 ≤5 分钟）。
- `command.status` 状态：`SUCCEEDED` / `DETERMINISTIC_REJECTED` / `ACCEPTED_JOB` / `ABSENT_IN_WINDOW` / `EXPIRED`。查不到但仍在窗口内 = `ABSENT_IN_WINDOW`（不是失败），只能原键 + 同 payload 有限重试。

## 8. 与前端的关系

- 前端不出现 DB SDK；经 `cloud.callFunction(rakApi/rakFiles)`。`src/` 由 `pnpm verify:no-client-db` 门禁。
- 客户端校验响应 scope 等于发起时捕获的 scope；A→B→A 用 epoch 而非 clubId 区分。
- 临时上传/下载凭证不作为通用 command 结果缓存。

## 9. 生成与部署产物

`pnpm build:cloud` → `cloudfunctions/{rakApi,rakFiles,rakMaintenance}/`（自包含，含 `index.js` + `package.json` + 编译后的 `contracts/`/`shared/`/`entrypoints/`）。
`pnpm verify:cloud:artifacts` 校验结构/哈希/无禁用串；`pnpm verify:cloud:config` 校验 infra 清单一致。
SDK 版本以 M0 锁版结论为准（当前骨架未引入运行时依赖）。
