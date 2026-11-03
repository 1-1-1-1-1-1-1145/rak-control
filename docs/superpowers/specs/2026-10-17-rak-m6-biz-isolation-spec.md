# M6 规格：其余全部业务的本队隔离与统计

日期：2026-10-17（Asia/Shanghai）。状态：**规格待确认；确认后按 tasks 执行**。
真源（复用，不重复定义）：[多团队隔离设计](2026-10-17-rak-multi-team-isolation-design.md) §10/§11、
[云化基线设计](2026-10-16-rak-cloudbase-multiuser-design.md) §9.2/§10、
[多团队实施计划](2026-10-17-rak-multi-team-isolation-plan.md) §M6。
本文件只把 M6 细化到"文件/函数/校验/验收"可执行粒度，不改动上述真源。

## 1. 范围

实现 M6 阶段服务端与本队客户端：公告、ROI、绩效、社团（设置/摘要）四类业务，
全部固定 `clubId` 作用域、稳定排序游标、服务端白名单与审计，**无遗留 HTTP 业务旁路**。
不实现：附件（M5）、页面守卫/切队（M7）、真实云部署（M8/M9）。

## 2. 硬约束（继承 plan §2，M6 逐条落实）

1. 所有业务文档显式 `clubId`；缺归属即拒绝，不默认当前队。异队/不存在统一 `resource_not_found`。
2. 所有读写经 `resolveTenant(tx, trusted, clubId)` 授权；不接受 `actorRole`/`userId`/任意集合名。
3. 关键写：`runIdempotent(db, now, { scope:{kind:'TEAM',clubId}, actorIdentityId, action, mutationId, expectedRevision?, data }, body)`；
   同事务写审计并递增 `club.mutationSeq`（ROI 另递增 actor `member.mutationSeq` 写栅栏）。
4. 列表统一 `{items,nextCursor,hasMore,asOf}`；cursor 绑定 `action/clubId/查询指纹/排序值`；
   A 队 cursor 给 B 队 → `cursor_scope_mismatch`；失败不推进游标（本轮不缓存失败游标）。
5. 空云返回合法空态，不注入演示内容。
6. 文本规则（BASE-DESIGN §7.3）：单行拒绝全部控制字符；多行先将 CRLF/CR 规范化为 LF，
   仅允许 LF，其余 NUL/控制字符拒绝；长度按 Unicode 码点计数；先 trim 再校验。
7. 金额规则（BASE-DESIGN §10.1）：持久化人民币**分**的安全整数；输入为十进制元字符串
   `0..999999999.99`、最多 2 位小数、无符号/无千分位/无科学计数；输出分整数（客户端适配器负责显示）。
8. 日期规则：`accountingDate` 为上海业务日 `YYYY-MM-DD`（UTC+8 固定偏移，中国大陆无夏令时）；
   周期边界左闭右开；`createdAt/updatedAt` 仍为 UTC 毫秒。

## 3. 数据模型（新增集合，登记于 collections.ts）

| 集合键 | 集合名 | 关键字段 |
|---|---|---|
| `announcements` | `rak_announcements` | `_id=announcementId, clubId, authorMemberId, status(DRAFT/PUBLISHED/ARCHIVED), pinned, title, body, revision, publishedAt, createdAt, updatedAt` |
| `roiItems` | `rak_roi_items` | `_id=roiId, clubId, createdByMemberId, title, category, costCents, revenueCents, participants, periodStart, periodEnd, accountingDate, status, notes, deletedAt, deletedByMemberId, revision, createdAt, updatedAt` |

`rak_stats` **不启用**：M6 绩效在服务端有界扫描内计算，超预算返回 `stats_unavailable`（见 §7.3）。
集合名登记集中在 `server/repositories/collections.ts`（新增集合必须登记，否则视为遗漏）。

## 4. 新增/修改文件

### 4.1 服务端共享工具（新建）

- `server/shared/text.ts`
  - `normalizeSingleLine(raw, {min,max,field})`：非字符串即 `validation_failed`；拒 `[\u0000-\u001F\u007F]`；trim；码点长度 `[min,max]`。
  - `normalizeMultiLine(raw, {min,max,field})`：`\r\n|\r` → `\n`；拒除 `\n` 外的控制字符；trim；码点长度。
- `server/shared/money.ts`
  - `parseYuanToCents(raw, field)`：仅接受字符串；正则 `^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$`；去小数点转整数分；`Number.isSafeInteger` 校验；越界/非法 → `validation_failed`。
  - `centsToYuanText(cents)`：仅用于展示层/文档示例，业务 DTO 一律回分整数。
- `server/shared/shanghai-date.ts`
  - `toShDay(ms)`：返回 `YYYY-MM-DD`（`new Date(ms + 8h)` 的 UTC 日期部分）。
  - `SH_OFFSET_MS = 8 * 3600 * 1000`（常量，中国大陆无 DST）。
  - `periodRange(period, nowMs)`：`month|quarter|year` → `{start, endExclusive}`（`YYYY-MM-DD`，左闭右开）；`all` → `null`。
  - `lastSixMonthKeys(nowMs)`：返回升序 6 个 `YYYY-MM`。

### 4.2 服务端模块（新建，每个 `index.ts`）

- `server/modules/announcements/index.ts`：`listAnnouncements / getAnnouncement / createAnnouncement / updateAnnouncement / publishAnnouncement / archiveAnnouncement`。
- `server/modules/roi/index.ts`：`listRoiItems / getRoiItem / createRoiItem / updateRoiItem / deleteRoiItem / roiOverview`。
- `server/modules/performance/index.ts`：`myPerformance / listPerformance`。
- `server/modules/club/index.ts`：`getClub / updateClub / clubDashboard / profileSummary`。

### 4.3 服务端整合（修改）

- `server/repositories/collections.ts`：新增 `announcements`、`roiItems`。
- `server/contracts/actions.ts`：为 M6 动作补 `ACTION_DATA_SCHEMAS`（见 §6 字段白名单）。
- `server/modules/api-handlers.ts`：注册 M6 动作 → 模块函数（TEAM scope、expectedRevision、mutationId）。
- `server/contracts/dtos.ts`：新增 M6 DTO 类型（公告/ROI/绩效/社团/摘要），字段与 docs/api/cloud-v2.md 单一来源一致。

### 4.4 客户端（新建/修改）

- `src/services/cloud/dto.ts`：追加 M6 DTO（与 server DTO 投影一致）。
- `src/services/cloud/club.ts`（新建）：`club.get / club.update / club.dashboard / profile.summary` + `announcement.*`。
- `src/services/cloud/roi.ts`（新建）：`roi.*`。
- `src/services/cloud/performance.ts`（新建）：`performance.mine / performance.list`
  （计划地图未列此文件，属"命名小幅调整"；理由：绩效与 ROI 职责不同，独立成文件更清晰）。

### 4.5 测试（新建）

- `server/tests/m6-announcements.test.ts`
- `server/tests/m6-roi.test.ts`
- `server/tests/m6-performance.test.ts`
- `server/tests/m6-club-summary.test.ts`

### 4.6 文档

- `docs/api/cloud-v2.md`：追加 M6 动作与 DTO 投影、错误码使用说明。
- `docs/verification/m6-execution-log-2026-10-17.md`：执行日志（步骤/时间/命令/结果/自检）。

## 5. 行为规格

### 5.1 公告（BASE-DESIGN §9.2）

- 状态机：`DRAFT → PUBLISHED → ARCHIVED`；**仅 DRAFT 可 publish**（PUBLISHED 重发 → `invalid_transition`）；已归档不可编辑/发布。
- `create`：manager+；`title` 单行 1..60；`body` 多行 1..10000；`pinned` 布尔（缺省 false）；`status=DRAFT`；`authorMemberId=actor.member._id`；`revision=1`。
- `update`：manager+；`ARCHIVED` → `invalid_transition`；`expectedRevision` 必须匹配；白名单仅 `title/body/pinned`。
- `publish` / `archive`：manager+；`expectedRevision` 校验；`publishedAt` 由服务端写。
- `list`：普通成员仅 `PUBLISHED`；manager+ 可见全部（可按 `status` 过滤）；排序 `(pinned desc, createdAt desc, _id desc)`；cursor 携 `[pinned,createdAt,_id]`；pageSize 默认 20 最大 50。
- `get`：普通成员仅 `PUBLISHED`，否则 `resource_not_found`；manager+ 任意状态。
- DTO 不含全局 `userId/openid`，作者用 `authorMemberId`。

### 5.2 ROI（BASE-DESIGN §10.1）

- `create`：manager+；`cost/revenue` 元字符串 → 分整数（§2.7）；`accountingDate = periodStart ?: toShDay(now)`；`periodEnd >= periodStart` 否则 `validation_failed`；`status` 白名单 `PLANNING/ACTIVE/DONE/CANCELLED` 缺省 `PLANNING`；`participants` 整数 0..999999。
- `update`：manager+；`periodStart` 为空时**沿用原 accountingDate**（不因编辑改月份）；`expectedRevision`。
- `delete`：manager+；**软删**（`deletedAt/deletedByMemberId`），保留审计。
- `list`：成员可读；过滤 `clubId` 且 `deletedAt==null`；可选 `status/category/keyword`（keyword 字面量、转义、≤80 字、仅 title/notes）；排序 `(createdAt desc, _id desc)`；cursor 绑定指纹。
- `overview(period)`：一次服务端聚合给出 `totalCost/totalRevenue/net/roiRatio/itemCount`；
  **口径**：`clubId` 一致、`deletedAt==null`、**包含 PLANNING/ACTIVE/DONE/CANCELLED**（明确"全部未删除项目，含已取消"）；
  `roiRatio = cost==0 ? null : (revenue-cost)/cost`；
  `series`：窗口=相对当前月的最近 6 个自然月，按 `accountingDate` 月份归集，缺月补 0；
  `period=all` 时总额覆盖全部但 series 仍只 6 月，响应用 `seriesWindow:'last6'` 显式标注该差别。

### 5.3 绩效（BASE-DESIGN §10.2）

- 取数仅本队 `clubId` 的 tasks/submissions；**不信客户端传分**。
- `claimedCount` = `assigneeMemberId==m && claimedAt!=null` 的任务数。
- `approvedCount` = `assigneeMemberId==m && status∈{APPROVED,DONE}`。
- `rejectedCount` = `assigneeMemberId==m` 且其交付历史中存在 `status==REJECTED` 的**去重 task 数**（同一 task 多轮计 1）。
- `inProgressCount` = `assigneeMemberId==m && status∈{CLAIMED,SUBMITTED,REJECTED}`。
- 等级分：`A=90,B=75,C=60,D=40`；`avgQualityScore` = 该成员 `status==APPROVED` 交付的 `reviewGrade` 均分，无则 `null`。
- `completionRate` = `claimedCount==0 ? 0 : approvedCount/claimedCount`。
- `compositeScore` = `Math.round(completionRate × (avgQualityScore ?? 0))`。
- `mine`：仅本人（从 ctx.memberId 计算，不接收他人/DTO 不含全局 userId）。
- `list`：仅 manager+；仅 `ACTIVE` 成员；排序 `(compositeScore desc, memberId asc)`；cursor 携 `[score,memberId]`；pageSize 默认 20 最大 50。
- 扫描预算：`MAX_SCAN = 20000`（tasks+submissions 命中条数）；超预算返回 `stats_unavailable`，**不返回部分榜单伪成功**。

### 5.4 社团与摘要（BASE-DESIGN §10.3）

- `club.get`：任意 ACTIVE 成员；返回 `clubId,name,slug,displayCode,status,settings,revision,createdAt,updatedAt`；**不含 `tenantId`**。
- `club.update`：manager+；白名单 `name`(1..60 单行)、`description`(0..2000 多行)、`logoUrl`(0..500 单行, 空值或 `http(s)://`)、`settings`(仅允许键 `memberDirectoryVisible:boolean`)；未知键/未知设置键 → `validation_failed`；`expectedRevision`；`club.mutationSeq`++。
- `club.dashboard`：**显式摘要，不伪造 `fetchTasks(size:1).total`**；返回
  `activeMemberCount`（本队 ACTIVE 计数）、`openTaskCount`、`myInProgressCount`、`mySubmittedCount`、
  `latestPublishedAnnouncements`（最多 3 条 PUBLISHED 摘要）、`asOf`；
  manager+ 额外 `pendingReviewCount`（任务 `SUBMITTED`）与 `topPerformers`（§5.3 前 5）。
- `profile.summary`：仅本人；返回本人任务计数（claimed/approved/rejected/inProgress）与本人 `performance` 摘要、`asOf`。
- 名册关闭（`memberDirectoryVisible=false`）：非 manager 的 `member.list` 仍拒绝（M3 已实现），
  但 `club.dashboard.activeMemberCount` **仍返回授权在册总数**，不含任何成员明细。

## 6. ACTION_DATA_SCHEMAS（新增，信封层拒绝多余字段）

```
announcement.list    allowed:[status,cursor,pageSize]
announcement.get     allowed:[announcementId]                  required:[announcementId]
announcement.create  allowed:[title,body,pinned]               required:[title,body]
announcement.update  allowed:[announcementId,title,body,pinned] required:[announcementId]
announcement.publish allowed:[announcementId]                  required:[announcementId]
announcement.archive allowed:[announcementId]                  required:[announcementId]
roi.list             allowed:[status,category,keyword,cursor,pageSize]
roi.get              allowed:[roiId]                           required:[roiId]
roi.create           allowed:[title,category,cost,revenue,participants,periodStart,periodEnd,status,notes]
                                                               required:[title,category,cost,revenue]
roi.update           allowed:[roiId,title,category,cost,revenue,participants,periodStart,periodEnd,status,notes]
                                                               required:[roiId]
roi.delete           allowed:[roiId]                           required:[roiId]
roi.overview         allowed:[period]
performance.mine     allowed:[]
performance.list     allowed:[cursor,pageSize]
club.get             allowed:[]
club.update          allowed:[name,description,logoUrl,settings]
club.dashboard       allowed:[]
profile.summary      allowed:[]
```

## 7. 验收（出口）

### 7.1 测试覆盖（新增用例，A/B 两队明显不同 fixture）

- 公告：草稿越权（普通成员 list/get DRAFT → 拒绝/不可见）、发布流转、归档后不可编辑/发布、`(pinned,createdAt,id)` 三值游标跨页不漏重、异队 cursor → `cursor_scope_mismatch`。
- ROI：`0.10+0.20` 精确分、上限/非法小数/负数拒绝、`cost=0 → ratio null`、上海跨月/跨季边界左闭右开、含 CANCELLED 口径、软删后列表/概览不含、编辑空 periodStart 不改月份。
- 绩效：曾驳回按 task 去重、同分按 memberId asc、`mine` 不含他人、`list` 对 member 拒绝、超预算 → `stats_unavailable`。
- 社团/摘要：设置白名单（未知键拒绝）、名册关闭仍返回在册总数、dashboard/profile.summary 不伪造 total、club.update 未知字段拒绝。

### 7.2 门禁命令（全部 PASS 方可进入 M7）

```powershell
corepack pnpm test:server
corepack pnpm test
corepack pnpm exec tsc -p server/tsconfig.json --noEmit
corepack pnpm exec tsc --noEmit --pretty false --skipLibCheck
corepack pnpm build:cloud
corepack pnpm verify:release
```

`--skipLibCheck` 与 PLAN §4 记录的现行命令一致：根 `tsc` 不加该参数会因 `node_modules` 中
Taro/mobx/webpack 的类型声明缺陷报错（错误全部位于 `node_modules/.pnpm/**`，与源码无关）。
该参数不放宽 `src/`/`server/` 源码检查；`server` 侧使用自带 tsconfig，无需该参数。

### 7.3 自检清单

- [x] 无 `not_implemented` 遗留 M6 动作；无 HTTP 业务旁路。
- [x] 所有列表 `clubId` 过滤 + 游标指纹 + 稳定排序；异队 cursor 拒绝。
- [x] 所有写经幂等命令 + 审计 + `club.mutationSeq` 栅栏；revision 冲突正确返回。
- [x] 金额/日期/文本规则逐条有测试证据。
- [x] `docs/api/cloud-v2.md` 与 DTO 一致；执行日志已写。
- [x] 真实云/真机项目仍标 `NOT_RUN`（M8/M9 前不提通过）。

## 8. 待确认项（需用户批准）

1. M6 不启用 `rak_stats`，绩效在服务端有界扫描（`MAX_SCAN=20000`），超预算返回 `stats_unavailable`。
2. 公告 `publish` 严格仅允许 `DRAFT → PUBLISHED`（PUBLISHED 重发返回 `invalid_transition`）。
3. `club.update` 设置白名单仅 `memberDirectoryVisible`；内容白名单仅 `name/description/logoUrl`。
4. ROI 趋势 series 固定"最近 6 个自然月窗口、缺月补 0"，`all` 时总额覆盖全部但标注 `seriesWindow:'last6'`。
