# M7 执行日志：切换团队与页面防串队

日期：2026-10-17（Asia/Shanghai）。执行者：AI（严格按 PLAN §M7 与 DESIGN §9 执行）。
真源：PLAN §M7、DESIGN §9.1/§9.2/§9.3/§10.1、BASE-DESIGN §10.3。
说明：本文件是**过程日志**。M7 **本机可执行项已全部完成并通过门禁**；依赖 M0/M5 的项
（附件、上传/在途写、真实云与真机）明确列为 NOT_RUN，**不标注为通过**。

## 1. 本轮已完成（含验证证据）

| # | PLAN §M7 条目 | 操作内容 | 产物 | 验证证据 |
|---|---|---|---|---|
| 1 | 切换时 epoch++、清受保护展示/Store/分页/弹窗/表单；目标 enter 带 switchAttemptId，核对账户/环境/代次/scope 后**一次安装**完整会话 | 新建切换协调器；补齐 `isAttemptCurrent` 栅栏 | `src/store/switch-coordinator.ts`、`src/store/team-session.ts` | `tests/team-switch.test.ts` 成功/失败/脏编辑/账户失效/迟到尝试 5 组用例通过 |
| 2 | 切换失败 activeTeam=null 回选择页，不恢复旧缓存；旧错误不能清新队 | 失败即 `failEnter` 置 TEAM_SELECTION 且 active=null；被更新尝试取代的迟到结果**不改状态、不弹 toast** | 同上 | 用例「enter 失败 → TEAM_SELECTION 且 activeTeam=null」「期间又发起新切队 → 旧尝试迟到 enter 不改状态、不清新队」 |
| 3 | 路由守卫先完成 bootstrap/enter 再 load；所有入口覆盖；新增队选择页不能被 ACTIVE guard 循环拦截 | 新建纯函数守卫（账户页豁免/选队页豁免/WAIT/requiresTeam/requiresRole 分支） | `src/utils/team-guard.ts` | 用例「守卫各分支唯一落点」覆盖 10 个分支 |
| 4 | 新业务深链 apiVersion/clubId/resourceKind/resourceId；异队先验证最小授权目标并走同一切换，取消则不消费 intent；仅 id 旧链接限当前 READY 队；pendingIntent 绑定 accountEpoch/目标/switchAttempt，一次消费 | 新建深链解析 + 意图存储 | `src/utils/pending-intent.ts` | `tests/team-links.test.ts` 5 组用例（含"GLOBAL 入会期间切到别的队不得在 B 消费"） |
| 5 | 协调器处理脏表单：留当前或放弃本机未提交编辑 | `switchTo(clubId, {discardLocal})`；`NEEDS_CONFIRM` 时不发起 enter、不改状态 | `switch-coordinator.ts` | 用例「脏编辑未确认 → NEEDS_CONFIRM 且不发起 enter」 |
| 6 | 冷启动先账户→team.listMine；上次队先 enter 重验；未验证前不展示缓存权限；**完整列表仅一队可自动 enter，有 hasMore 不能假定唯一** | 新建 cloud 账户↔团队流程；账户安装 attemptId 栅栏；仅 `!hasMore && 恰 1 队` 自动 enter | `src/store/cloud-team.ts` | 类型检查通过；逻辑与 DESIGN §9.1 一致 |
| 7 | 含 authStore↔CloudSession 映射；云模式只 cloud、无演示身份 | AuthStore 拆分 legacy 字段与 cloud 镜像；`user/club/clubRole/permissions/isLoggedIn` 改为按后端分支的 getter；`bootstrap/clear/logout` 分支；新增 `syncFromCloudSession` 一次安装 | `src/store/index.ts` | 根 `tsc` 0 错误；46 前端用例全绿（legacy 路径无回归） |
| 8 | 切队/登出按归属清理；global/team/cache 归属清理 | 三个业务 Store 新增 `resetState()`（任务列表另重建 requestGate，作废在途请求）；`configureCloudTeam` 注入 `clearProtected` | `src/store/index.ts` | 类型检查通过；`verify:no-client-db` 通过 |
| 9 | 全部页面守卫接线 | PageShell 改为 cloud 走 `decideGuard`（WAIT/REDIRECT），legacy 保留原角色校验；账户页豁免 | `src/components/page-shell.tsx` | `verify:routes` 26/26 通过 |
| 10 | 当前配置全部路由有矩阵 | 新建矩阵生成器（从 app.config 派生，校验缺页/缺配置/缺守卫）并纳入 release | `scripts/verify-routes.mjs`、`package.json`、`scripts/verify-release.mjs` | `pnpm verify:routes` 通过；产出 `docs/verification/route-guard-matrix-2026-10-17.md` |
| 11 | enter 请求携带 switchAttemptId（服务端不据此授权） | 客户端 `team.enter` 增诊断字段；信封白名单同步 | `src/services/cloud/team.ts`、`server/contracts/actions.ts` | `pnpm test:server` 80/80；server `tsc` 0 错误 |
| 12 | 0 队/待审/停用/维护/网络失败确定落点；单队也可加入其他队；不展示跨队汇总 | 新建选队页（列表/点选切换/脏编辑确认/加载更多/重试/空态/加入其他团队） | `src/pages/me/team-select.tsx`(+config+scss)、app.config 注册 | `verify:routes` 28 路由通过；根 `tsc` 0 错误 |
| 13 | 已在 A 的人加入 B：成功只更新本人账户级状态，不被旧 login AUTHED 覆盖，不自动替换当前队 | 新建独立加入页（`key`→resolveJoinTarget→join.submit；`code`→invite.redeem；多行先 CRLF→LF） | `src/pages/me/team-join.tsx`(+config+scss)、app.config 注册 | 同上；页面不 `reLaunch`、不自动 enter |
| 14 | 客户端命令键需合法 UUIDv7 | 新建 mutation-id 生成器（时间有序、服务端同格式） | `src/utils/mutation-id.ts` | `tests/mutation-id.test.ts` 形状/唯一性用例通过 |
| 15 | "仅待审"等账户级落点需要本人申请列表 | 实现并接线 `join.mine`（GLOBAL、账户级、只本人最小字段、account 游标） | `server/modules/join/index.ts`、`server/contracts/dtos.ts`、`server/modules/api-handlers.ts`、`src/services/cloud/{dto,team}.ts` | `server/tests/m7-join-mine.test.ts` 3 用例；`test:server` 83/83 |
| 16 | 入队进度页（确定 UI） | 新建 `pages/me/team-join-status`（状态/重试/加载更多/空态/去加入/去切换） | `src/pages/me/team-join-status.tsx`(+config+scss)、app.config 注册 | `verify:routes` 31 路由通过 |
| 17 | 每队独立姓名/职务；owner 可自改职务 | 新建 `pages/me/team-profile`；会话支持**就地**更新姓名/职务而不改 epoch | `src/pages/me/team-profile.tsx`、`src/store/team-session.ts`(`applyProfile`)、`src/store/cloud-team.ts`(`cloudUpdateMyProfile`)、`src/store/index.ts`(`updateMyProfile`) | `tests/team-switch.test.ts` 新增用例（epoch/角色不变、duty 未提供保持） |
| 18 | 无可用队只展示账户/入队入口；"我的"常显本队资料与切队入口 | 新建 `pages/me/account`；改造 `pages/me/profile.tsx`（cloud 用 `profile.summary` 显式摘要 + 捕获 clubId 二次校验；无队只留账户/入队入口） | `src/pages/me/account.tsx`(+config+scss)、`src/pages/me/profile.tsx` | 根 `tsc` 0 错误；`verify:routes` 通过 |
| 19 | 云模式无演示人物/角色切换/重置 | 核验 `pages/me/settings.tsx` 演示身份/重置整块由 `DEMO_MODE` 包裹（cloud 构建不渲染） | `src/pages/me/settings.tsx:22-68` | 代码级证据；cloud 构建产物核验列入待完成 |
| 20 | 无遗留 HTTP 业务旁路（PLAN §M6 出口） | 新建 **cloud→页面 DTO 唯一适配层**（金额分→元只在边界换算；公共 DTO 缺失的私有字段填 null，不伪造） | `src/services/cloud/legacy-view.ts` | 根 `tsc` 0 错误 |
| 21 | ROI 全链 cloud 化 | RoiStore：概览一次聚合、列表 cursor↔page 适配、详情、增/改（带 revision）/软删；均含 **clubId 二次校验** | `src/store/index.ts`（RoiStore）、`src/pages/roi/*`（无需改字段即可用） | 根 `tsc` 0 错误；`pnpm test` 49/49 |
| 22 | 首页计数不伪造 total | 首页 cloud 分支改用 `club.dashboard` 显式摘要 + ROI 概览 + 本人任务 3 条，并做 clubId/generation 双栅栏 | `src/pages/index/index.tsx` | 根 `tsc` 0 错误 |
| 23 | 公告/名册/绩效/邀请/任免 cloud 化 | TeamStore 全部读路径 + `setRole/setMemberStatus`（带 revision，LEFT 明确不支持）+ 邀请签发/作废 | `src/store/index.ts`（TeamStore） | 根 `tsc` 0 错误 |
| 24 | 公告 create→publish 不得跨队继续 | 公告管理页改走 Store 方法；create 后二次校验捕获的 clubId，切队则只留草稿在原团队 | `src/subpackage-admin/pages/admin/announcements.tsx` | 代码级证据；类型检查通过 |
| 25 | 既有 UI 字段补齐（不泄露全局身份） | 服务端 `AnnouncementView` 增 `authorDisplayName`（同队作者名）；`ClubView` 增 `description/logoUrl` | `server/contracts/dtos.ts`、`server/modules/{announcements,club}/index.ts`、`src/services/cloud/dto.ts` | `test:server` 83/83（含新增 authorDisplayName 断言）；server `tsc` 0 错误 |
| 26 | 团队设置页 cloud 化 | 团队设置页改走 `teamStore.fetchClubInfo/updateClub`（cloud 先读 revision 再写） | `src/subpackage-admin/pages/admin/club-settings.tsx` | 类型检查通过 |
| 27 | 任务域 cloud 化（Store） | TaskStore 增 cloud 分支：cursor 分页（独立 `pageCursors` map，不污染旧 `page` 字段）、`status` 逗号串→数组、`assigneeId`→`assigneeMemberId`、clubId+requestGate 双栅栏；`claim/submit/approve/reject/archive/publish` 带 `mutationId`+`expectedRevision`（revision 由 `task.get` 读取；approve/reject 由 `submission.list` 解析当前待验收轮次）；带附件 submit **明确抛出**「附件交付将在 M5 提供」 | `src/store/index.ts` | 根 `tsc` 0 错误；`pnpm test` 56/56；`verify:no-client-db` 通过 |
| 28 | 任务域页面接线 | `task/pool`：计数改用 `club.dashboard.openTaskCount`（generation+clubId 栅栏）；`me/tasks`：保留 `TaskListRequestGate` 竞态门禁 + cursor 栈 + `hasMore` 判据；`admin/review`：`task.list{SUBMITTED}`；`task/detail`：`task.get`+`submission.list` 填**真实**交付说明/评级/驳回原因，附件不可打开如实标注，saveFile/提交后清理加 ctx 栅栏；`admin/home`：计数用 `dashboard.pendingReviewCount` + 真实申请列表（未知显示为「管理入队申请」，不伪造 0） | `src/pages/task/pool.tsx`、`src/pages/me/tasks.tsx`、`src/pages/task/detail.tsx`、`src/subpackage-admin/pages/admin/{review,home}.tsx` | 根 `tsc` 0 错误；`verify:routes` 通过（31 路由） |
| 29 | 入队审核 TEAM 服务端 | 新增 `join.list/join.approve/join.reject`（manager+；批准前检查**目标 user** NORMAL 并写目标 `securityMutationSeq` + actor member + club 栅栏，建号 role=member；DTO 不含 openid/appid/userId；cursor 绑定 clubId） | `server/modules/join/index.ts`、`server/contracts/dtos.ts`、`server/modules/api-handlers.ts`、`server/contracts/actions.ts` | `server/tests/m7-join-review.test.ts` 8 用例；`test:server` 91/91；server `tsc` 0 错误 |
| 30 | 入队审核客户端接线 | `cloudJoinList/Approve/Reject`；`toLegacyJoinRequest`（不可见字段留空＝未暴露，不伪造）；TeamStore cloud 分支（失败写入 `joinError` 供页面显式展示）；驳回**理由必填**（可编辑弹窗） | `src/services/cloud/{join,dto,legacy-view}.ts`、`src/store/index.ts`、`src/subpackage-admin/pages/admin/join-requests.tsx` | 根 `tsc` 0 错误；`pnpm test` 56/56 |
| 31 | 深链接线 | 纯函数 `planDeepLink/resolveDeepLinkRoute` + 唯一副作用入口 `consumeDeepLink`：同队直接进入；异队记 pendingIntent → 走**同一个**切队流程 → 会话安装成功后才**一次消费**；取消/失败不消费；旧 `id` 链不重定向（由目标页在当前 READY 队内解释）；调用点仅 `app.ts` launch 与 `page-shell` 两处（模块级去重） | `src/utils/pending-intent.ts`、`src/utils/deep-link-entry.ts`、`src/app.ts`、`src/components/page-shell.tsx`、`tests/deep-link-router.test.ts` | `pnpm test` 56/56（新增 7 用例）；`verify:routes` 通过 |
| 32 | 剩余 async 回调 ctx 二次校验 | 我的绩效改走 `performance.mine`（+generation/clubId 栅栏）；ROI 编辑回填改走 Store 的 `roi.get`（去掉 legacy 直调），回填/保存/删除后均做 clubId 栅栏 | `src/pages/me/performance.tsx`、`src/subpackage-admin/pages/admin/roi-edit.tsx` | 根 `tsc` 0 错误；`pnpm test` 56/56 |
| 33 | cloud 客户端包隔离与门禁 | 演示服务统一经 `src/demo/loader.ts` 懒加载（5 个 legacy 服务不再静态 import `@/demo/runtime`）；cloud 构建用 webpack `IgnorePlugin` 从依赖图移除 `src/demo` 三模块；新增 `verify:client:cloud` 并在 `verify:release` 中置于末尾 | `src/demo/loader.ts`、`config/index.ts`、`scripts/verify-client-cloud.mjs`、`scripts/verify-release.mjs`、`package.json`、`src/services/{task,roi,member,club,auth}.ts` | `verify:client:cloud` 通过（无演示数据/测试注入/服务端 SDK，且已内联云环境）；dev/demo 构建回归成功且仍含演示数据 |
| 34 | 出口审计：公告详情页 cloud 化 | 公告详情页在 cloud 下改走 `announcement.get` + `toLegacyAnnouncement`（capture clubId + generation 双栅栏），**不再直连 legacy HTTP** | `src/pages/club/announcement-detail.tsx` | 根 `tsc` 0 错误；`verify:routes` 通过；`verify:release` 通过 |
| 35 | 公告列表 cloud 分页判据 | TeamStore 增 `annHasMore`（cloud 用 `announcement.list.hasMore`；legacy 用 `已加载 < total`），列表页触底改用该判据（此前 cloud 恒不触发下一页） | `src/store/index.ts`、`src/pages/club/announcement-list.tsx` | 根 `tsc` 0 错误；`pnpm test` 56/56 |
| 36 | cloud 下 legacy 页面旁路清底 | `auth/join-status` 在 cloud 改落点 `team-join-status`（不再调 legacy `fetchJoinStatus`）；`auth/login` 的邀请码绑定/入队申请在 cloud 隐藏并短路（不做 legacy 调用）；并做**页面级 legacy 引用全量审计** | `src/pages/auth/{join-status,login}.tsx` | 审计结果：9 个含 legacy 服务引用的页面 **0 个无 cloud 分支**（`settings` 仅 `DEMO_MODE` 块内，且其演示串经 `verify:client:cloud` 证明未进 cloud 包） |
| 37 | 未决命令追踪器（PLAN §M7 (d)、§M4 出口） | 新增**纯逻辑** `CommandTracker`（只存最小指针 scope/action/mutationId；scope 隔离；结果未知只保留原键、**不新键重做**）+ Taro 持久化层（重启只保留 UNKNOWN）+ backend 层给**所有带 mutationId 的写调用**统一埋点（`result_unknown`/传输失败 → UNKNOWN；确定性失败即清除）+ `syncFromCloudSession` 按**原 scope/原键**查询 `command.status` 对账；换账号/登出清空 | `src/store/command-tracker.ts`、`src/store/command-tracker-persist.ts`、`src/services/backend.ts`、`src/store/index.ts`、`src/constants/index.ts`、`tests/command-tracker.test.ts` | `pnpm test` 64/64（新增 8 用例：scope 隔离/一次消费式指针/非法数据丢弃）；根 `tsc` 0 错误 |
| 38 | 受保护展示含 QR 缓存（PLAN §M7 (e)/(j)） | `clearInviteQrCache()` 接入 `resetBusinessStores`：切队/登出清本应用小程序码内存缓存；只清应用内存，不删用户已另存文件 | `src/services/club.ts`、`src/store/index.ts` | 根 `tsc` 0 错误；`verify:release` 通过 |
| 39 | 页面级守卫落点（PLAN §M7 (i)） | 8 个页面的 `useDidShow` 登录跳转改为 **cloud 感知**（cloud 未就绪时交 `PageShell` 统一守卫决定落点，legacy 行为不变），消除「0 队/未就绪时页面与守卫竞争 → 错跳登录页」 | `src/pages/{task/pool,index/index,roi/list,roi/overview,club/home,me/tasks,me/profile}.tsx`、`src/subpackage-admin/pages/admin/home.tsx` | 根 `tsc` 0 错误；`verify:routes` 通过；`pnpm test` 64/64 |
| 40 | PLAN §M7 十条逐条对照审计 | 对 PLAN §M7 原始 checklist 逐条给出 PASS 证据或 NOT_RUN 原因 | 本文件 §6 | 结论：本机可执行 **9 条 PASS**；第 4 条部分完成（在途上传 NOT_RUN，依赖 M5） |
| 41 | **真实云集成入口（PLAN §4 `test:cloud:integration`，此前缺失）** | 新建 `scripts/cloud-integration/{config,cases,run}.mjs`：MT01–MT22 用例矩阵（含通道分类 identity/admin/device/worker）、fail-closed 配置解析、真实微信身份通道 + **独立只读**断言通道执行、证据 JSON（含通道模板指纹，不记凭证）；`package.json` 增脚本 | `scripts/cloud-integration/*`、`package.json`、`tests/cloud-integration-gate.test.ts` | 纯逻辑 7 用例通过；本机缺配置 → **非零退出**（fail-closed 行为已验证，**非**云验收结论） |
| 42 | **受控平台初始化脚本（PLAN §3.2，此前缺失）** | `scripts/bootstrap-cloud-platform.mjs`：仅做一次平台初始化（经 `rakMaintenance` 平台来源；**不入公共 action 注册表**），缺配置即非零退出、不伪造结果 | `scripts/bootstrap-cloud-platform.mjs` | 本机缺配置 → 非零退出并列出缺失项 |
| 43 | **每队受控开通脚本（PLAN §3.2，此前缺失）** | `scripts/provision-cloud-team.mjs`：幂等开通单队（owner 参考号/队名/slug/displayCode），缺参数或环境即非零退出；结果最小披露 | `scripts/provision-cloud-team.mjs` | 本机缺配置/参数 → 非零退出并列出缺失项与用法 |

## 2. 本轮门禁原始结果

```text
corepack pnpm test                 → tests 71 / pass 71 / fail 0
corepack pnpm test:server          → tests 91 / pass 91 / fail 0
corepack pnpm exec tsc -p server/tsconfig.json --noEmit → 0 错误
corepack pnpm exec tsc --noEmit --pretty false --skipLibCheck → 0 错误
corepack pnpm verify:routes        → 通过：31 个路由均有页面/配置与守卫
corepack pnpm verify:no-client-db  → 通过
corepack pnpm verify:client:cloud  → 通过：cloud prod 产物无演示数据/测试注入/服务端 SDK，且已内联云环境 cloud1-d4g36r8z6a8908540
corepack pnpm verify:release       → verify:cloud:config / no-client-db / cloud:artifacts / routes / client:cloud 均通过
corepack pnpm build:weapp（dev/demo 回归）→ 成功；产物仍含演示数据（demo 模式预期）
corepack pnpm test:cloud:integration → **exit 1（fail-closed，符合 PLAN §4 要求）**：
   BLOCKED：缺少真实环境/身份/独立只读断言所需配置（逐项列出 RAK_CLOUD_ENV / RAK_APP_ID /
   RAK_FN_INVOKE_TEMPLATE / RAK_ADMIN_READ_TEMPLATE / RAK_FIXTURE_FILE）；
   未产生任何真实云结论，未 skip 成 PASS。
node scripts/bootstrap-cloud-platform.mjs → **exit 1（fail-closed）**：列出 RAK_CLOUD_ENV / RAK_APP_ID / RAK_PLATFORM_INVOKE_TEMPLATE
node scripts/provision-cloud-team.mjs    → **exit 1（fail-closed）**：列出 3 个环境变量与 5 个必填参数 + 用法
```

## 3. 本轮未完成（M7 待完成项，不得视为通过）

- [x] **任务域页面 cloud 化** —— 完成（#27/#28）。`task/detail` 已完成可做部分：交付说明/评级/驳回原因取自 `submission.list`，**附件跨设备打开与上传仍 NOT_RUN（依赖 M5）**，页面按「不可打开」如实标注，未用公共 Task DTO 伪造。
- [x] **入队审核（TEAM）** —— 完成（#29/#30）；`admin/join-requests` 在 cloud 下走 `join.list/approve/reject`，失败显式展示错误而非伪造空列表。
- [x] **深链接线** —— 完成（#31）。
- [x] **其余 async 回调 ctx 二次校验** —— 完成（#32；任务选择器/saveFile/交付清理见 #28，首页计数/profile/公告 create→publish 见 #22/#24/#28）。
- [ ] **上传/在途写处理**（停止发新片、尽力取消 A 上传、未知写只记最小指针）→ **NOT_RUN**：依赖 M5 附件能力与 M0 上传协议裁决。
- [x] **cloud 客户端包核验**（含新增门禁脚本）—— 完成（#33）。
- [ ] **M5 附件全链** → **NOT_RUN**（依赖 M0 云能力门禁）。
- [ ] **真实双设备/真机与真实云入口（M8/M9）** → **NOT_RUN**：本机无 CloudBase 访问能力与真实微信身份。

## 4. 说明与偏离记录

- 无方案偏离。`join.mine` 是注册表已声明的 GLOBAL 动作、此前无实现；M7 的"仅待审"落点需要它，故补齐并加服务端用例（非新增协议动作）。
- 适配层 `legacy-view.ts` 属 PLAN §M6 "cloud适配" 允许的"适配器转换旧DTO"（BASE-DESIGN §10.1 明确允许），**未**把 cursor 填入旧 page 数字字段（cursor↔page 映射在 Store 内的独立 map）。
- cloud 下列表 `total` 暂以"已加载条数"填充（云列表契约不返回 total）；页面不得据此推断全量数量，需数量时用 `club.dashboard`/`profile.summary` 等显式摘要。**任务池/管理台计数已改用显式摘要**。
- `team.enter` 的 `switchAttemptId` 为**客户端诊断字段**（服务端不据此授权），未放宽任何服务端校验。
- 客户端 `createMutationId` 用 `Math.random` 而非加密随机：mutationId 非机密，仅需格式与时间有序；服务端仍做格式与年龄门禁。
- **偏离记录（本轮新增，均已在门禁验证）**：
  1. 深链纯函数 `planDeepLink/resolveDeepLinkRoute` 与解析函数同放 `src/utils/pending-intent.ts`，未单独建 `deep-link-router.ts`：tsc 禁止 `.ts` 后缀的**值**导入，Node type-stripping 测试又不支持无后缀解析；同模块可被单测直接加载。
  2. `switchAttemptId` 由切队协调器内部 `beginEnter()` 生成，调用方无法预绑定；改为**切换成功（新会话已安装）后**以 `accountEpoch + clubId` 消费 intent —— 与"绑定尝试编号后一次消费"语义等价（一次消费、取消不消费、旧代次不误消费）。
  3. cloud 演示隔离最终用 webpack `IgnorePlugin`（`resourceRegExp /^\.\/(runtime|adapter|services)$/` + `contextRegExp /[\\/]demo$/`）：CommonJS `require` 的依赖在**解析期**即登记，`DEMO_MODE` 常量分支无法剔除依赖；先试的 `resolve.alias` 方案在本项目解析顺序下实测无效。
  4. `join.list` 复用通用分页类型：`JoinRequestPage = Page<JoinRequestView>`。
  5. 新增 Store 字段 `joinError`：cloud 下申请列表失败时页面显式展示错误（不伪造空列表），并驱动管理台计数显示"管理入队申请"而非 0。

## 5. 出口审计证据（M6 §"无遗留 HTTP 业务旁路" / M7 §"所有页面的切换协调与竞态整合"）

审计方法：扫描 `src/pages/**` 与 `src/subpackage-admin/pages/**` 中对 legacy 业务服务的引用
（`@/services/{task,roi,club,member,auth}`），逐个确认页面是否具备 cloud 分支或仅存于编译期
`DEMO_MODE` 块内；命令与原始结论：

```text
1) src 全量扫描："from '@/services/(task|roi|club|member|auth)'" → 命中 20 处
   - src/store/index.ts 的 5 处属于 legacy 路径所必需（AuthStore 与各 Store 的 legacy 分支，
     全部由 `authStore.isCloud` 分流）；
   - 页面级 15 处（pages 与 subpackage-admin）：index / tasks / task-detail / admin-review /
     admin-home / performance / profile / announcements-list(经 Store) / announcement-detail /
     admin-invites(经 Store，二维码在 cloud 显式 not_implemented) / join-status / login /
     settings / club-home 等。
2) 页面级逐个核对是否具备 cloud 分支（grep "isCloud"）：
   cloud-branch : index, tasks, task/detail, admin/review, admin/home, performance, profile,
                  announcement-detail, join-status, login
   demo-only    : me/settings.tsx（legacy 调用与演示人名均在 `DEMO_MODE ?` 块内；
                  演示串已被 verify:client:cloud 证明**不在** cloud 包里）
   NO-GUARD     : 0
```

结论：**cloud 正式包内不存在页面级 legacy HTTP 业务旁路**；本结论由静态审计（本次）与产物级门禁
（`verify:client:cloud`：无演示数据/测试注入/服务端 SDK）**双向**支撑。审计中新发现并已修复 3 处：
公告详情页直连 legacy（#34）、公告列表 cloud 分页恒不加载下一页（#35）、`auth/join-status` 与
`auth/login` 在 cloud 下可能触达 legacy 调用（#36）。

未覆盖项（不得视为通过）：真实云端入口、真实微信身份、双设备与真机验收 —— 见 §3 的 NOT_RUN 条目。

## 6. PLAN §M7 原始 checklist 逐条对照（本轮收尾审计）

| # | PLAN §M7 条目（原文要点） | 判定 | 证据（文件 / 测试 / 日志条目） |
|---|---|---|---|
| 1 | 「我的」常显当前队 name/displayCode、本队姓名/职务/role 与切队入口；单队也可加入其他队；无可用队只展示账户/入队入口、不加载内部宫格；无跨队汇总 | PASS | `src/pages/me/profile.tsx`（cloud 用 `profile.summary` 显式摘要 + clubId 二次校验；无队只留账户/入队入口）、`me/team-profile.tsx`、`me/team-select.tsx`（含「加入其他团队」）、`me/account.tsx`；日志 #17/#18 |
| 2 | 冷启动先账户→`team.listMine`；上次队先 enter 重验；未验证前不展示缓存权限；完整列表**仅一队且 !hasMore** 才自动 enter；0 队/仅待审/停用/维护/重名/多页/网络失败均有确定 UI | PASS | `src/store/cloud-team.ts`（`cloudBootAccount`/`cloudColdStartAutoEnter` 唯一性判定）、`me/team-select.tsx`（列表/空态/加载更多/重试/错误）、`me/team-join-status.tsx`；日志 #6/#12/#16 |
| 3 | 新独立加入页供已在 A 的人加入 B；GLOBAL 兑换/申请成功只更新本人状态，不被旧 login AUTHED 自动 reLaunch 覆盖，不自动替换 A | PASS | `src/pages/me/team-join.tsx`（成功仅更新账户级状态；不 `reLaunch`、不自动 enter）；日志 #13 |
| 4 | 协调器处理脏表单/文件/在途上传/未知写：留当前或放弃本机未提交编辑；**未知 A 写原命令追踪、不新键重做**；停止新片/尽力取消 A 上传，保留服务端超时/回收兜底 | **部分 PASS** | 脏编辑：`switch-coordinator.ts` + `tests/team-switch.test.ts`（日志 #5）✔；未知写追踪：**本轮新增** `command-tracker.ts` + backend 埋点 + Store 对账 + `tests/command-tracker.test.ts`（日志 #37）✔；**在途上传 → NOT_RUN**（依赖 M5 附件能力） |
| 5 | 切换时 epoch++、清受保护展示/Store/页面局部/**QR**/URL/分页/弹窗/表单；enter 带 `switchAttemptId`，核对账户/环境/代次/scope 后**一次安装**完整会话；reLaunch 到我的并新 epoch 挂载 | PASS | `src/store/switch-coordinator.ts`、`team-session.ts#install`、`store/index.ts#resetBusinessStores`（本轮补 QR 清理，日志 #38）；日志 #1/#2/#8 |
| 6 | 切换失败 `activeTeam=null` 回选择页、不恢复旧缓存；返回 A 也重验；当前队降权/停用/维护仅失效本队；旧 A 错误不能清 B；全局账号失效另行清两层 | PASS | `switch-coordinator.ts#failEnter`、`tests/team-switch.test.ts`（迟到尝试不改状态）、`AuthStore.clear()`（清账户+团队两层）；日志 #2/#8 |
| 7 | 全部 async 的 commit/catch/finally/toast/navigation 二次校验原 ctx（任务选择器/saveFile/交付清理、首页计数、我的绩效、ROI 编辑回填、公告 create→publish）；旧 A create 后不继续在 B publish | PASS | 首页 #22、公告 #24、任务域 #27/#28、绩效与 ROI 回填 #32、公告 create→publish #24；本轮公告详情 #34 |
| 8 | 新业务深链 `apiVersion/clubId/resourceKind/resourceId`；异队先验证最小授权目标并走同一切换，取消则不消费 intent；仅 `id` 旧链限当前 READY 队、不全库找归属；intent 一次消费 | PASS | `src/utils/pending-intent.ts`（`planDeepLink`/`resolveDeepLinkRoute`）、`src/utils/deep-link-entry.ts`、`tests/deep-link-router.test.ts`；日志 #31（`switchAttempt` 绑定方式见 §4 偏离 2） |
| 9 | 路由守卫先 bootstrap/enter 再 load；所有 useDidShow/useEffect、返回旧栈、下拉刷新、深链及管理页直接进入均覆盖；新增队选择页不被 ACTIVE guard 循环拦截 | PASS | `src/components/page-shell.tsx#decideGuard` 接线 + `src/utils/team-guard.ts` + `verify:routes` 矩阵；**本轮修正 8 处页面级 `useDidShow` 与守卫竞争**（日志 #39） |
| 10 | global/team/cache/URL/命令指针按归属清理；退出不整目录删其他文件；云模式无演示人物/角色切换/重置；demo/HTTP 明确独立，不给旧 HTTP 伪造多队能力 | PASS | `resetBusinessStores`（Store+QR）、`clearPendingCommands` + `resetDeepLinkEntry`（登出）、`tests/command-tracker.test.ts`（异 scope 隔离）；演示隔离 #33 + `verify:client:cloud`；`requestForBackend` 在 cloud 抛 `not_implemented` 不误走 HTTP |

**审计结论**：PLAN §M7 十条中 **9 条 PASS**、第 4 条 **部分 PASS**（仅"在途上传取消"因 M5 未实现而 NOT_RUN，且未以任何方式伪造）。§3 中的其余 NOT_RUN 项（M5 附件全链、M8 云部署、M9 真机/双设备）全部依赖同一个外部条件：**本机无 CloudBase 环境访问权限与真实微信身份**。

## 7. 本轮补充：真实云入口与受控开通脚本（PLAN §3.2/§4 要求但此前缺失）

补齐三项方案明确要求的入口（都在 PLAN §3.2「待创建」清单内，之前从未创建）：

| 产物 | 责任（PLAN / DESIGN） | 本机证据 |
|---|---|---|
| `scripts/cloud-integration/{config,cases,run}.mjs` + `pnpm test:cloud:integration` | 隔离环境**真实微信身份** callFunction + **独立只读**断言；缺 env/身份/证据非零退出，不能 skip 成全绿（PLAN §4 表格行、§M0 出口、§M8 验证） | 纯逻辑 7 用例（`tests/cloud-integration-gate.test.ts`）通过；缺配置时 **exit 1** 并逐项列出缺失（原始输出见 §2） |
| `scripts/bootstrap-cloud-platform.mjs` | 平台受控初始化（只做一次；经 `rakMaintenance`，不进入公共 action 注册表；DESIGN §5.3、§M3） | 缺配置 → **exit 1** 并列出缺失项 |
| `scripts/provision-cloud-team.mjs` | 每队受控开通（幂等 op 键、唯一 owner、消费参考号同事务；普通用户不可调用；DESIGN §5.3、§M3） | 缺配置/参数 → **exit 1** 并列出缺失项与用法 |

**证据边界（不得越界解读）**：

- 本轮**只验证了 fail-closed 行为与纯逻辑**（缺配置必定非零退出、绝不 skip 成 PASS、绝不伪造云端结果）；
- **成功路径未在本机执行**，因为没有可信真实微信身份通道与独立只读断言通道 —— 任何"通过真实云验收"的结论都必须等 M0 云能力门禁与 M8 部署完成后由人工在隔离环境执行；
- 调用形态（`RAK_FN_INVOKE_TEMPLATE`/`RAK_ADMIN_READ_TEMPLATE`/`RAK_PLATFORM_INVOKE_TEMPLATE`）**由操作方按其已核实 CLI 形态提供**：脚本内不写未经验证的 CLI 参数（遵循 PLAN 硬约束 3）；
- 证据 JSON 仅在真实执行时落盘（`docs/verification/cloud-integration-<date>.json`），并记录两条通道模板的**指纹**（只记 hash，不记内容）以便复核来源。
