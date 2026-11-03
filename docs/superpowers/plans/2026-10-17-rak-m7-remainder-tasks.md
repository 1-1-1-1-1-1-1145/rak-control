# M7 剩余项执行任务（tasks）

真源：[`M7 剩余项施工规范`](../specs/2026-10-17-rak-m7-remainder-spec.md)（D1–D7）+ PLAN `§M7`。
执行顺序**不可调整**（依赖顺序：R1/R3 服务端 → R2 客户端 Store → R4 页面 → R5 深链 → R6 回调 → R7 包核验）。
每完成一条：① 跑 §门禁 命令；② 把「操作内容/时间/验证结果」追加进 [`m7-execution-log-2026-10-17.md`](../../verification/m7-execution-log-2026-10-17.md)；③ 未达验收标准不得进入下一条。

## 门禁（每条完成后全跑，paste 原始输出进日志）

```powershell
corepack pnpm test
corepack pnpm test:server
corepack pnpm exec tsc -p server/tsconfig.json --noEmit
corepack pnpm exec tsc --noEmit --pretty false --skipLibCheck
corepack pnpm verify:routes
corepack pnpm verify:no-client-db
corepack pnpm verify:client:cloud
corepack pnpm verify:release
```

## R0. 前置核对（只读）

- [x] 复跑基线 6 条门禁，确认与执行日志 §2 一致（`test` 49/49、`test:server` 83/83、两处 tsc 0、routes 31、release 通过）。
- 验收：基线一致；如不一致先停止并反馈（方案未覆盖的偏差）。→ **一致**。

## R1. TaskStore cloud 化（规范 D1）

- [x] `src/store/index.ts` class TaskStore 增 `pageCursors` + `loadCloud`（cursor 分页、status 切数组、assigneeId→assigneeMemberId、clubId+requestGate 双栅栏、`total=已加载条数`）。
- [x] 动作 cloud 分支：`claim/submit/approve/reject/archive/publish`（revision 由 `cloudTaskGet` 读取；approve/reject 由 `cloudSubmissionList` 解析当前待验收轮次；publish 返回后校验 clubId 才 toast/refresh；带附件 submit 抛 `Error('附件交付将在 M5 提供')`）。
- [x] `setFilters`/`resetState` 在 cloud 下清 `pageCursors`。
- 验收：`tsc --skipLibCheck` 0 错 ✅；`pnpm test` 全绿 ✅（56/56）；`verify:no-client-db` 通过 ✅；代码内不存在把 cursor 写进 `page` 字段 ✅。

## R2. 任务域页面接线（规范 D2）

- [x] `src/pages/task/pool.tsx`：cloud 下 pill 计数改用 `cloudClubDashboard().openTaskCount`（generation + clubId 栅栏）。
- [x] `src/pages/me/tasks.tsx`：cloud 分支（保留 `TaskListRequestGate`；cursor 栈；`hasMore` 替代 `total` 判据）。
- [x] `src/subpackage-admin/pages/admin/review.tsx`：cloud 分支 `cloudTaskList({status:['SUBMITTED'],pageSize:50})` + clubId 栅栏 + 截断提示。
- [x] `src/pages/task/detail.tsx`：cloud `refresh()` 用 `cloudTaskGet` + `cloudSubmissionList` 填真实交付字段；附件不可用如实标注；所有 async 回调 clubId+generation 二次校验。
- [x] `src/subpackage-admin/pages/admin/task-publish.tsx` / `admin/home.tsx`：发布经 store（无需改）；home 的 review 计数改用 `dashboard.pendingReviewCount`；join 计数改用 `teamStore.joinRequests.length`（R3/R4 后生效），cloud 未实现前不显示数字。
- 验收：`verify:routes` 通过 ✅；`tsc` 0 错 ✅；`pnpm test` 全绿 ✅；`admin/review|home` 等在 cloud 下不再直连 legacy `taskService` ✅（除 `task-publish` 经 Store）；无伪造字段 ✅。

## R3. 入队审核 TEAM 服务端（规范 D3）

- [x] `server/modules/join/index.ts` 增 `listJoinRequests/approveJoinRequest/rejectJoinRequest`（manager+；成员落库范式对齐 `invites.redeem`；目标 user NORMAL 检查 + `securityMutationSeq` 栅栏 + actor 同人去重；DTO 不含 openid/appid/userId；cursor 绑定 clubId）。
- [x] `server/contracts/dtos.ts` 增 `JoinRequestView/JoinRequestPage`。
- [x] `server/modules/api-handlers.ts` 接线 `join.list/join.approve/join.reject`（TEAM）。
- [x] `server/contracts/actions.ts` 增 `join.list` 的 `ACTION_DATA_SCHEMAS`。
- [x] `server/tests/m7-join-review.test.ts` 覆盖 8 组用例（见规范 D3）。
- 验收：`test:server` 全绿 ✅（91/91）；`tsc -p server/tsconfig.json` 0 错 ✅。

## R4. join 审核客户端接线（规范 D4）

- [x] `src/services/cloud/dto.ts` 增 `JoinRequestView/JoinRequestPage`。
- [x] 新建 `src/services/cloud/join.ts`（list/approve/reject）。
- [x] `src/services/cloud/legacy-view.ts` 增 `toLegacyJoinRequest`（不可见字段留空，不伪造）。
- [x] `src/store/index.ts` TeamStore 的 `loadJoinRequests/approveJoin/rejectJoin` 增 cloud 分支（clubId 二次校验）。
- 验收：`tsc` 0 错 ✅；`pnpm test` 全绿 ✅；`admin/join-requests` 在 cloud 下不再走 legacy ✅。

## R5. 深链接线（规范 D5）

- [x] 纯函数 `planDeepLink`/`resolveDeepLinkRoute`（与 `parseCloudDeepLink` 同放 `src/utils/pending-intent.ts`，见日志 §4 偏离 1）。
- [x] 新建 `src/utils/deep-link-entry.ts`（`consumeDeepLink`：走同一切换 → 会话安装成功后一次消费；取消/失败不消费）。
- [x] `src/app.ts` launch 后调用；`src/components/page-shell.tsx` ALLOW 分支调用（模块级 key 去重）。
- [x] `tests/deep-link-router.test.ts` 覆盖 7 组用例（直接路由/异队 switch/旧链 ignored/缺参数 ignored/一次消费/误消费防护/列表页路由）。
- 验收：`pnpm test` 全绿 ✅（56/56）；`tsc` 0 错 ✅；`verify:routes` 通过 ✅。

## R6. 剩余 ctx 二次校验（规范 D7）

- [x] `src/pages/me/performance.tsx`：改走 `cloudPerformanceMine` + capture clubId+generation，await 后二次校验再 setState。
- [x] `src/subpackage-admin/pages/admin/roi-edit.tsx`：回填改走 Store（去掉 legacy 直调）+ 回填/保存/删除后的栅栏。
- 验收：`tsc` 0 错 ✅；`pnpm test` 全绿 ✅；代码内可见 capture+校验 ✅。

## R7. cloud 客户端包核验（规范 D6）

- [x] 新建 `src/demo/loader.ts`；改造 `src/services/{task,roi,member,club,auth}.ts` 用懒加载。
- [x] cloud 构建期用 webpack `IgnorePlugin` 从依赖图移除 `src/demo` 三模块（见日志 §4 偏离 3）。
- [x] 新建 `scripts/verify-client-cloud.mjs` + `package.json` 的 `verify:client:cloud`。
- [x] `scripts/verify-release.mjs` checks 末尾追加该门禁。
- 验收：`verify:client:cloud` 通过 ✅（无 `陈老师/demo-super/演示成员`、无测试注入、无 server/admin SDK，且后端常量已内联 cloud 环境）；`verify:release` 通过 ✅；`pnpm build:weapp`（demo/dev）回归成功且仍含演示数据 ✅。

## R8. 日志与收尾

- [x] 追加执行日志：新增 §1 条目 27–33、刷新 §2 门禁原始输出、逐条更新 §3 未完成项（M5/M8/M9 保留 NOT_RUN 并写明原因）、§4 记录 5 条偏离。
- [x] 输出功能实现说明（面向用户，含 cloud/legacy 双路径行为差异与 NOT_RUN 清单）。
- 验收：日志中每条剩余项要么有 PASS 证据，要么明确 NOT_RUN + 原因 ✅；不存在"未验证却标通过" ✅。

## R9. 收尾审计（PLAN §M7 原始 checklist 逐条对照）

- [x] 逐条对照 PLAN §M7 的 10 条 checklist，给出 PASS 证据（文件/测试/日志条目）或 NOT_RUN 原因 → 结果见 [执行日志 §6](../../verification/m7-execution-log-2026-10-17.md)。
- [x] 审计中新发现并修复 6 处缺口：公告详情页 legacy 旁路、公告列表 cloud 分页判据、`auth/join-status`/`auth/login` 的 cloud 落点、**未决命令追踪器缺失**（§M7 (d)）、**页面级 useDidShow 与守卫竞争**（§M7 (i)）、**QR 缓存未随切队清理**（§M7 (e)/(j)）。
- [x] 门禁复跑：`test` 64/64、`test:server` 91/91、两处 tsc 0、`verify:routes` 31、`verify:no-client-db`、`verify:client:cloud`、`verify:release` 全通过。
- 验收：§M7 十条 **9 条 PASS、第 4 条部分 PASS**（在途上传 NOT_RUN，依赖 M5）✅

## R10. 补齐方案要求的真实云/运维入口（PLAN §3.2、§4）

- [x] 新建 `scripts/cloud-integration/{config,cases,run}.mjs` + `package.json` 的 `test:cloud:integration`：MT01–MT22 用例矩阵（identity/admin/device/worker 通道分类）、真实微信身份 + 独立只读断言双通道、fail-closed 配置解析、证据 JSON（含通道模板指纹）。
- [x] 新建 `scripts/bootstrap-cloud-platform.mjs`（平台受控初始化，仅一次，经 `rakMaintenance`，不入公共注册表）。
- [x] 新建 `scripts/provision-cloud-team.mjs`（每队受控开通，幂等、缺参即退出、最小披露）。
- [x] `tests/cloud-integration-gate.test.ts`（7 用例）验证 fail-closed 判定与 MT 矩阵完整性。
- 验收：`test` 71/71、`test:server` 91/91、两处 tsc 0、`verify:routes` 31、`verify:no-client-db`、`verify:client:cloud`、`verify:release` 全通过 ✅；三个新入口在本机**缺配置时非零退出**（fail-closed 行为已验证，**非**云验收结论）✅

## 明确 NOT_RUN（不得标 PASS）

- M5 附件全链与上传/在途写处理（依赖 M0 上传协议裁决，本机无 CloudBase 访问能力）。
- M8 隔离云部署与真实双团队攻防；M9 真机/换机/双设备验收。
