# M7 剩余项施工规范（decision-complete）

日期：2026-10-17（Asia/Shanghai）。状态：**已批准并执行完毕**；执行结果与偏离记录见 [M7 执行日志](../../verification/m7-execution-log-2026-10-17.md) §1（条目 27–33）与 §4。
真源：PLAN `§M7`、DESIGN `§9.1/§9.2/§9.3/§10.1`、BASE-DESIGN `§10.3`、现有执行日志 [`m7-execution-log-2026-10-17.md`](../../verification/m7-execution-log-2026-10-17.md) §3。
本文件只覆盖 M7 **未完成项**；不替代 PLAN，也不新增协议动作。

## 0. 现状核对（已在源码中逐条确认）

| 事实 | 证据 |
|---|---|
| 客户端 cloud 服务已具备 task/submission 全部调用 | `src/services/cloud/task.ts`：`cloudTaskList/Get/Create/Update/Claim/Submit/Approve/Reject/Archive`、`cloudSubmissionList/Get`、`cloudCommandStatus` |
| 服务端 task 六状态机 + `task.list` 过滤/游标已实现 | `server/modules/tasks/index.ts`：`listTasks` 支持 `status[]/category/keyword/assigneeMemberId/cursor/pageSize`；`reviewSubmission` 要求 `submissionId === task.lastSubmissionId` 且 `expectedRevision` |
| cloud→页面 Task 适配层已存在，私有交付字段留空 | `src/services/cloud/legacy-view.ts`：`toLegacyTask`（`submitNote/qualityGrade/qualityNote/rejectReason/assigneeName` 均为 null；`submissionAttachments` 不伪造） |
| 任务域页面仍全部走 legacy HTTP 服务 | `src/pages/task/pool.tsx`(TaskStore)、`src/pages/me/tasks.tsx`(`taskService.fetchTasks`)、`src/pages/task/detail.tsx`、`src/subpackage-admin/pages/admin/{home,review,task-publish}.tsx` |
| `TaskStore` 只有 legacy 分页，无 cloud 分支 | `src/store/index.ts:472-622` |
| `join.list/join.approve/join.reject` 已在动作注册表与 schema 中声明，但**无处理器** | `server/contracts/actions.ts:49-51`、`ACTION_DATA_SCHEMAS`(`join.approve`/`join.reject`)、`server/modules/api-handlers.ts` 无对应键；`server/modules/join/index.ts` 只有 rotate/resolveJoinTarget/submit/listMine/status |
| 审批用到的成员落库范式已存在 | `server/modules/invites/index.ts:265-313`（member 文档字段、user.securityMutationSeq 栅栏、收敛 PENDING 申请） |
| `admin/join-requests.tsx` 与 `TeamStore.loadJoinRequests` 仍走 legacy 门面 | `src/store/index.ts:1124-1157`、`src/subpackage-admin/pages/admin/join-requests.tsx` |
| 深链解析与意图存储已实现，但**无任何调用点** | `src/utils/pending-intent.ts` 导出 `parseCloudDeepLink/parseLegacyDeepLink/PendingIntentStore`；全库无引用 |
| 切队/会话 API 已就绪 | `src/store/cloud-team.ts`：`cloudEnter(clubId,{discardLocal})`、`cloudSnapshot()`、`cloudTeamRuntime()`（含 `accountEpoch`）、`SwitchCoordinator` |
| 守卫决策为纯函数 | `src/utils/team-guard.ts`：`decideGuard(input)` 返回 `WAIT/REDIRECT/ALLOW` |
| 构建期 `DEMO_MODE` 是 define 常量 | `config/index.ts` 注入 `__RAK_DEMO_MODE__`；`src/constants/index.ts:11` |
| 演示数据会被静态打进任何包的根因 | `src/demo/runtime.ts:3-4` 顶层 `import { DemoAdapter } from './adapter'`（含 `陈老师/demo-super/演示成员` 等种子）；5 个 legacy 服务 `import { demoServices } from '@/demo/runtime'` |
| 现有发布门禁 | `scripts/verify-release.mjs` 组合 `verify-cloud-config/no-client-db/cloud-artifacts/routes`；**无客户端产物 demo/测试注入门禁** |

## 1. 决策项（D1–D7）

### D1. TaskStore cloud 化（`src/store/index.ts` · class TaskStore）

新增字段：`private pageCursors = new Map<string, (string | undefined)[]>()`，并在 `makeAutoObservable` 的非观察键中登记（与 `RoiStore`/`TeamStore` 同法）。

- `load(opts)`：首行 `if (authStore.isCloud) return this.loadCloud(opts)`。
  - `loadCloud`：`team = authStore.cloudActiveTeam`，要求 `authStore.cloudTeamState === 'READY'`，否则 return。
  - cursor key = `JSON.stringify([clubId, this.filters])`；`opts.reset` 时 `pageCursors.delete(key)`；`cursors = cursorPages(this.pageCursors, key)`；`cursor = cursors[request.page]`。
  - 过滤映射：`status` 逗号串 → `string[]`（空串 → 不传）；`filters.assigneeId` → `assigneeMemberId`；`category/keyword` 直传。
  - 请求：`cloudTaskList(clubId, { status, category, keyword, assigneeMemberId, cursor, pageSize: 20 })`。
  - 返回后**双重栅栏**：`if (!this.requestGate.commit(request) && !this.requestGate.isCurrent(request)) return` + `if (authStore.cloudActiveTeam?.clubId !== clubId) return`。
  - 成功：`items = page===0 ? mapped : [...this.tasks, ...mapped]`（`mapped = raw.items.map(toLegacyTask)`）；`hasMore = raw.hasMore`；`if (raw.nextCursor) cursors[request.page + 1] = raw.nextCursor`；`total = this.tasks.length`（**仅已加载条数**，页面不得据此推断全量，见 §3 约定）。
  - 失败：与 legacy 同分支写 `error/moreError` 并 `fail(...)`；finally 复位 `loading/loadingMore`（仅在 request 仍为当前时）。
- `setFilters`：cloud 下先 `this.pageCursors.clear()`。
- `loadMore/refresh`：不改（复用 `load`）。
- `resetState`：追加 `this.pageCursors.clear()`。
- 动作（保持在 `action()` 包装内，成功才 `refresh()`）：
  - `claim(id)`：cloud → `v = await cloudTaskGet(clubId,id)` → `cloudTaskClaim(clubId,{taskId:id, expectedRevision:v.revision, mutationId:createMutationId()})`。
  - `submit(id, note, attachments)`：cloud → **若 `attachments?.length` 抛 `Error('附件交付将在 M5 提供')`（不静默忽略）**；否则 `v=cloudTaskGet` → `cloudTaskSubmit(clubId,{taskId:id, note, attachmentIds:[], expectedRevision:v.revision, mutationId})`。
  - `approve(id, grade, note)`：cloud → `v=cloudTaskGet`；`subs=cloudSubmissionList(clubId,id)`；取 `round` 最大且 `status==='SUBMITTED'` 的 `submissionId`（无则抛 `Error('当前没有待验收的交付')`）→ `cloudTaskApprove(clubId,{taskId,submissionId,grade,note,expectedRevision:v.revision,mutationId})`。
  - `reject(id, reason)`：同上取 submissionId → `cloudTaskReject(...)`。
  - `archive(id)`：cloud → `v=cloudTaskGet` → `cloudTaskArchive(clubId,{taskId:id,expectedRevision:v.revision,mutationId})`。
  - `publish(input)`：cloud → `clubId` 捕获后 `await cloudTaskCreate(clubId, input, createMutationId())`；**返回后 `authStore.cloudActiveTeam?.clubId === clubId` 才允许 toast/refresh（旧 A 发布不刷新 B）**。
- 每个 cloud 分支 catch 走 `fail(e, '<原文案>')` 并 rethrow（保持页面既有 catch 行为）。
- 新增 import：`cloudTaskClaim/Create/Get/Approve/Reject/Submit/Archive/List`、`cloudSubmissionList`、`toLegacyTask`。

### D2. 任务域页面接线

| 文件 | 改动 | 验收 |
|---|---|---|
| `src/pages/task/pool.tsx` | 仅改**计数来源**：cloud 下用 `cloudClubDashboard(clubId).openTaskCount`（配合 `useRef` generation + clubId 二次校验）替换 header pill 的 `taskStore.total`；其余分段/搜索/分类/分页逻辑不动（TaskStore 已 cloud 化）。 | 根 tsc 0 错；cloud 下 pill 显示服务端真实在池数 |
| `src/pages/me/tasks.tsx` | `load()` 增加 cloud 分支：保留原有 `TaskListRequestGate` 竞态门禁；`useRef<((string|undefined)[])>` cursor 栈按 `request.page` 取值/回填；`status` 逗号串→数组；`assigneeMemberId: uid`（cloud 下 `authStore.user.id` 即 memberId）；`hasMore` 用新 state 替代 `tasks.length < total` 判据；clubId + gate 双栅栏；结果 `map(toLegacyTask)`。 | 分段切换/下拉刷新/触底加载在 cloud 与 legacy 均正确；不串队 |
| `src/subpackage-admin/pages/admin/review.tsx` | cloud 分支：`cloudTaskList(clubId,{status:['SUBMITTED'],pageSize:50})` → `toLegacyTask`；capture clubId 二次校验；`hasMore` 时加一行 caption「仅显示前 50 条」；legacy 分支不变。 | 待验收列表来自本队；无跨队数据 |
| `src/subpackage-admin/pages/admin/home.tsx` | cloud 分支：`review = cloudClubDashboard(clubId).pendingReviewCount`；`join` 数量改用 `teamStore.loadJoinRequests()` 后的**真实** `joinRequests.length`（D3 完成后可用）；cloud 下**不再调用** legacy `memberService.fetchJoinRequests`，未实现前该 tile 不显示数字（不伪造 0）。 | 管理台计数来自显式摘要 |
| `src/subpackage-admin/pages/admin/task-publish.tsx` | 不改（经 `taskStore.publish`，D1 已 cloud 化）。 | 发布后回任务池可见 |
| `src/pages/task/detail.tsx` | cloud 分支 `refresh()`：`t = cloudTaskGet(clubId,id)` + `subs = cloudSubmissionList(clubId,id)`；用 `subs[0]`（round 最大）**仅填充真实存在的字段**：`submitNote=sub.note`；`qualityGrade/qualityNote`（APPROVED 时 `reviewGrade/reviewNote`）；`rejectReason`（REJECTED 时 `reviewNote`）；`approvedAt/rejectedAt` 由任务 `updatedAt` 推导（与 `toLegacyTask` 同规则）；`submissionAttachments` **不填**（M5 附件未实现，不伪造本地路径）。`attachmentIds.length>0` 时显示 caption「附件需 M5 附件能力，当前不可打开」。`canPersistAttachments` 仍为 `DEMO_MODE`（cloud=false，选择器禁用并保留既有提示文案）。所有 async 回调（`saveFile`/`onRemoveAttachment`/提交后本地交付清理/`runAction`）以捕获的 `clubId + generation` 二次校验后再 setState/toast/navigate。 | 私有交付内容来自 `submission.*`，不用公共 Task DTO 伪造；切队后迟到回调不写新队 |

### D3. 入队审核 TEAM 服务端实现（补齐注册表已声明的动作）

`server/modules/join/index.ts` 新增（均 manager+；TEAM scope；复用 `runIdempotent`/`resolveTenant`）：

- `listJoinRequests(deps, trusted, clubId, { status?: 'PENDING'|'APPROVED'|'REJECTED'; cursor?; pageSize? })`
  - `resolveTenant` + `requireManagerPlus(toTenantContext)`；默认 `status='PENDING'`。
  - 只返回本队申请的最小字段：`joinRequestId/applicantName/wechat/reason/status/attemptNo/createdAt/reviewedAt`；**不含 openid/appid/userId**（他人全局身份不外泄）。
  - 排序 `createdAt desc, _id desc`；cursor `fingerprint = join.list:{status}`，绑定 `clubId`（异 scope 游标 `cursor_scope_mismatch`）。
- `approveJoinRequest(deps, trusted, clubId, { joinRequestId, mutationId })`
  - 事务内：`resolveTenant` + `requireManagerPlus`（与 `requireCanManageTarget` 语义一致：manager 可批 member 级入队，owner 亦可）。
  - 读申请：必须 `doc.clubId === clubId`（否则 `resource_not_found`）；`doc.status === 'PENDING'`（否则 `invalid_transition`）。
  - 读目标 `user`（`doc.userId`）：缺失 → `identity_required`；`securityState === 'BLOCKED'` → `account_blocked`（**批准前检查目标 NORMAL，不只看操作者**）。
  - `mId = memberId(clubId, userId)`；已 `ACTIVE` → 只收敛申请为 `APPROVED`（resolution `'MANUAL'`），不重复建号、不改 role/name/joinedAt；`DISABLED/LEFT` → `invalid_transition`（不借审批复活）。
  - 新建 member：`_id=mId, clubId, userId, displayName=申请 name, duty=null, role='member', status='ACTIVE', createdAt/joinedAt=now, revision=1, mutationSeq=0`。
  - 栅栏：`actor member.mutationSeq`、`club.mutationSeq`、目标 `user.securityMutationSeq`；**actor 与目标 user 为同一账号时只写一次**（去重）。
  - 收敛申请：`status='APPROVED', resolution='MANUAL', reviewedByMemberId=actor, reviewedAt=now, revision+1, updatedAt`。
  - `writeAudit(scope=TEAM:clubId, actorMemberId, action='join.approve', resourceType='join_request', resourceId, seed=mutationId)`。
  - 命令记录：`runIdempotent` 统一写入；`data = { joinRequestId }`。
- `rejectJoinRequest(deps, trusted, clubId, { joinRequestId, rejectReason, mutationId })`
  - 校验 `rejectReason` 非空（`validation_failed`）；其余入参校验同上（同队、PENDING）。
  - 收敛申请：`status='REJECTED', resolution=rejectReason, reviewedByMemberId=actor, reviewedAt=now, revision+1`；栅栏 actor member + club（**不触碰目标 user**，与「批准才涉及授权授予」一致）；写审计 `action='join.reject'`。
  - `attemptNo` 不递增：再次申请时 `join.submit` 已按 `attemptNo+1` 覆盖为 PENDING。

接线：`server/contracts/dtos.ts` 增 `JoinRequestView`/`JoinRequestPage`；`server/modules/api-handlers.ts` 增 `join.list/join.approve/join.reject`（TEAM，`teamClubId(req)`）；`server/contracts/actions.ts` 的 `ACTION_DATA_SCHEMAS` 增 `'join.list': { allowed:['status','cursor','pageSize'] }`（`join.approve`/`join.reject` 已有）。

服务端用例 `server/tests/m7-join-review.test.ts`：① manager 通过 → member 建立(role=member)/申请 APPROVED/审计/club 与 user 栅栏递增；② 非 manager 拒绝 `permission_denied`；③ 拒绝需 reason 且不建 member；④ 异队申请人不可见/审批 `resource_not_found`；⑤ 目标 BLOCKED → `account_blocked`；⑥ 重复批准幂等（同 mutationId 回放）；⑦ list 游标分页 & 仅 PENDING 默认；⑧ DTO 不含 openid/userId。

### D4. 客户端与 Store 接线（join 审核）

- `src/services/cloud/dto.ts`：增 `JoinRequestView`、`JoinRequestPage`（字段同 D3 投影）。
- 新文件 `src/services/cloud/join.ts`：`cloudJoinList(clubId,{status,cursor,pageSize})`、`cloudJoinApprove(clubId,{joinRequestId,mutationId})`、`cloudJoinReject(clubId,{joinRequestId,rejectReason,mutationId})`（TEAM scope，`mutationId` 走信封）。
- `src/services/cloud/legacy-view.ts`：增 `toLegacyJoinRequest(clubId, view)` → 旧 `JoinRequest`，`appid:''`、`openid:''`、`userId:null`（**空值表示"未暴露"，不是伪造**）。
- `src/store/index.ts` TeamStore：`loadJoinRequests/approveJoin/rejectJoin` 增 cloud 分支（capture clubId + 返回后二次校验 + `fail` 文案沿用）；cloud 下 `approveJoin` 成功后再 `loadMembers()`。`resetState` 已清 `joinRequests`（无需改）。
- `src/subpackage-admin/pages/admin/join-requests.tsx`：逻辑不变（经 Store）；`DEMO_MODE` 卡片分支在 cloud 下自然不渲染（cloud ⇒ `DEMO_MODE=false`）。

### D5. 深链接线（`apiVersion=2` 新链 + 仅 `id` 旧链）

- 新文件 `src/utils/deep-link-router.ts`（纯函数，可单测）：
  - `resolveDeepLinkRoute(kind, resourceId): string | null` → 路由表：`task→ROUTES.taskDetail?apiVersion=2&clubId=..&resourceKind=task&resourceId=..`（沿用现 `detail?id=` 目标页，不改页面视觉）；`announcement→announcementDetail`；`roi→roiDetail`；`club→adminClubSettings`；`member→adminMembers`；`invite→adminInvites`；`performance→performance`。
  - `planDeepLink({query, accountEpoch, activeClubId, teamState, canSwitch})` → `{ action:'consumed'; route } | { action:'switch'; clubId; intent } | { action:'ignored' }`：
    - `parseCloudDeepLink(query)` 命中且 `clubId !== activeClubId` → 记 `PendingIntentStore.set({accountEpoch, switchAttemptId:null, target})`，返回 `switch`（走 D5-2）。
    - 命中且 `clubId === activeClubId` → 直接 `route`。
    - 未命中 → `parseLegacyDeepLink(query)` 仅在 `teamState==='READY'` 时按**当前队**解释（kind 由调用页给出，如任务详情页 `id` 即 task），否则 `ignored`（**不全库找归属**）。
- 新文件 `src/utils/deep-link-entry.ts`（有副作用，唯一调用点）：
  - `consumeDeepLink(query)`：调 `planDeepLink`；
    - `switch`：`cloudEnter(clubId)` 前 `PendingIntentStore.bindSwitchAttempt(<本次 attempt 的 id>)`；enter 成功（新 epoch READY）后 `PendingIntentStore.consume(accountEpoch, clubId)` 命中才 `Taro.reLaunch({url: route})`（一次消费）；用户取消/失败 → **不消费** intent。
    - `consumed`：直接 `reLaunch`。
- 调用点（**两处，且仅这两处**）：
  1. `src/app.ts` 的 `useLaunch`：`const q = Taro.getLaunchOptionsSync().query; void bootstrapApp().then(() => { if (authStore.isCloud) consumeDeepLink(q) })`；launch 场景下 `Taro.getLaunchOptionsSync` 拿到的 query 即入口 query。
  2. `src/components/page-shell.tsx`：在 `decideGuard` 为 ALLOW 且 `authStore.isCloud` 时，对当前页 `Taro.getCurrentInstance().router?.params` 调一次 `consumeDeepLink`（仅处理"页面已在栈上、参数携带深链"的场景），并对同一 `(clubId,resourceKind,resourceId)` 只处理一次（模块级 `lastHandledKey` 去重），避免重复 reLaunch。
- 单测 `tests/deep-link-router.test.ts`：直接路由、异队→intent+switch、取消不消费、一次消费、旧 `id` 链仅 READY 队内解释、跨队旧链忽略。

### D6. cloud 客户端包核验（PLAN §M7 出口：无 demo/管理员 SDK/测试注入）

- 新文件 `src/demo/loader.ts`：
  ```ts
  import { DEMO_MODE } from '@/constants'
  export function getDemoServicesLazy(): DemoServices {
    if (!DEMO_MODE) throw new Error('本地演示服务未在当前构建中启用')
    // webpack ConstPlugin 在 DEMO_MODE=false 时剔除整个分支与依赖
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getDemoServices } = require('./runtime') as typeof import('./runtime')
    return getDemoServices()
  }
  ```
  （`DemoServices` 类型从 `./services` 以 `import type` 引入，运行时不引入。）
- 5 个 legacy 服务（`src/services/{task,roi,member,club,auth}.ts`）：删除顶层 `import { demoServices } from '@/demo/runtime'`，改为 `demo: () => getDemoServicesLazy().<域>`。**dev/demo 构建行为不变**（`DEMO_MODE=true` 时正常懒加载）。
- 新门禁 `scripts/verify-client-cloud.mjs` + `package.json` script `verify:client:cloud`：
  - 用 `execFileSync` 以**显式 env**（不改 `process.env`，无需还原）跑 `taro build --type weapp --mode production`，env 注入 `TARO_APP_BACKEND=cloud`、`TARO_APP_CLOUD_ENV=cloud1-d4g36r8z6a8908540`（`TARO_APP_ID` 沿用 `wxa8bf102dcfdcec4c`）。
  - 扫描 `dist/**` 全部文本产物，命中即失败：
    - 演示人物/角色：`陈老师`、`demo-super`、`演示成员`；
    - 测试注入：`__RAK_TEST__`、`RAK_TEST_INJECTION`、`test-only`；
    - 服务端/管理员 SDK 泄漏：`@cloudbase/node-sdk`、`server/modules/`、`rakFiles`、`rakMaintenance`；
    - 生产禁用旁路：`api/v1/clubs`（HTTP 业务面在 cloud 包内不应出现）。
  - 同时断言产物中 `TARO_APP_BACKEND` 解析结果落为 cloud：检查 `dist/app.js`/`dist/common.js` 中存在 `"cloud"` 后端常量字面量（`__RAK_BACKEND__` 已内联）；若产物内联失败（仍为 http/demo）即失败。
  - 未注入 env 或本地缺 `taro` 时**非零退出并说明**，不 skip 成 PASS。
- `scripts/verify-release.mjs` 的 `checks` 增 `scripts/verify-client-cloud.mjs`（**排在最后**，因其最慢）。

### D7. 剩余 ctx 二次校验（PLAN §M7 第 4 条）

- `src/pages/me/performance.tsx`：cloud 读路径 capture `clubId`（`authStore.cloudActiveTeam.clubId`）与 `generation`，`await` 后二次校验再 setState/toast。legacy 分支不变。
- `src/subpackage-admin/pages/admin/roi-edit.tsx`：编辑回填 `fetchOne` 前后 capture `clubId` + `generation`，返回后校验再 `setForm`；保存成功后的 navigate/toast 同样校验。
- 任务选择器（`pool`/`me/tasks`）与 `saveFile`/交付清理已在 D2 覆盖；首页计数/profile/公告 create→publish 已完成（执行日志第 22/24/28 项）。

## 2. 门禁与验收命令（每批改动后全跑）

```powershell
corepack pnpm test
corepack pnpm test:server
corepack pnpm exec tsc -p server/tsconfig.json --noEmit
corepack pnpm exec tsc --noEmit --pretty false --skipLibCheck
corepack pnpm verify:routes
corepack pnpm verify:no-client-db
corepack pnpm verify:client:cloud   # 新增（含 build:weapp prod 注入 cloud env）
corepack pnpm verify:release        # 组合门禁，含上一条
```

预期：前 6 条与基线一致（`test` 49/49 起、`test:server` 83/83 起 + 新增用例数）；`verify:client:cloud` 首次运行即为 PASS（若失败按 §D6 修到无害再复跑，不得放宽标记集）。

## 3. 全局约定（沿用，不得违反）

- cloud 列表 `total` 仅为**已加载条数**，页面需要数量时用 `club.dashboard`/`profile.summary` 显式摘要。
- cursor 只进 Store 内的 `pageCursors` map（经 `cursorPages` 助手），**不填进旧 `page` 数字字段**。
- 云 Store 每次 `await` 后必须二次校验捕获的 `clubId`（A 结果不回填 B）。
- 服务端源码相对导入用 `.ts` 扩展名；所有写经 `server/modules/command.ts` 的 `runIdempotent`；集合名登记在 `server/repositories/collections.ts`。
- 不索要 AppSecret/API key；不伪造云/登录结果；`pnpm` 走 `corepack pnpm`。
- 不改 `src/**` 现有页面配色/字号/图标/布局结构，不做整页重写。

## 4. 不做项（本轮明确 NOT_RUN，并写入日志）

- **M5 附件**：`file.*` 全链、上传/在途写处理（依赖 M0 上传协议裁决，本机无 CloudBase 访问能力）→ NOT_RUN。
- **M8 云部署 / M9 真机与双设备**：依赖 M0 云能力门禁与真实微信身份 → NOT_RUN。
- `task/detail` 的**跨设备附件打开**：依赖 M5 → 本轮仅做 D2 中可做的部分，附件区按"不可用"如实标注。

## 5. 需要用户确认的决策点

1. **是否本轮补齐 `join.list/join.approve/join.reject` 服务端实现**（注册表与 schema 中已声明、此前无处理器；M3 检查表含"批准申请…检查目标 user.NORMAL"）。这是 `admin/join-requests` 页 cloud 化的前置。推荐：**是**（不新增协议动作，纯补齐）。
2. **cloud 包剔除演示数据的方式**：采用 §D6 的 `src/demo/loader.ts` + `DEMO_MODE` 常量分支（webpack 常量折叠剔除），并新增 `verify:client:cloud` 作为发布门禁。推荐：**是**。
3. **深链入口位置**：`app.ts` useLaunch + `page-shell` 已挂载页参数，各处理一次。推荐：**按 §D5 执行**。

批准后按 [`2026-10-17-rak-m7-remainder-tasks.md`](../plans/2026-10-17-rak-m7-remainder-tasks.md) 顺序执行，并在 [`m7-execution-log-2026-10-17.md`](../../verification/m7-execution-log-2026-10-17.md) 追加全过程记录（操作内容/时间/验证结果）。
