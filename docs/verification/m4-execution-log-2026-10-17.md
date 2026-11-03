# M4 执行日志 —— 本队任务状态机、命令幂等与独立交付轮次

日期：2026-10-17（Asia/Shanghai）
阶段：**M4**（[多团队实施计划](../superpowers/plans/2026-10-17-rak-multi-team-isolation-plan.md) §M4）
前置：M1–M3 已完成；M0 云门禁仍 BLOCKED。
本次结论：**M4 服务端任务/交付/命令查询与前端云客户端已落地并通过本地替身测试。**

## 1. 变更清单

| 类别 | 文件 | 动作 |
|---|---|---|
| 模块 | `server/modules/tasks/index.ts` | 新建：create/update/claim/submit/approve/reject/archive + list/get + submission.list/get + command.status |
| 模块 | `server/modules/command.ts` | 修改：加入 UUIDv7 年龄门禁（未来 ≤5 分钟，年龄 ≤24 小时） |
| 模块 | `server/modules/{join,invites}/index.ts` | 修改：自定义幂等写入口同步加入年龄门禁 |
| 仓储 | `server/repositories/{collections,ids}.ts` | 修改/新增：tasks/submissions/uploadBatches/uploadSessions 集合名；`randomId` |
| 入口 | `server/modules/api-handlers.ts` | 修改：注册 task.*/submission.*/command.status 处理器 |
| 前端 | `src/services/cloud/{dto,task}.ts` | 新增任务/交付 DTO 与云客户端封装 |
| 测试 | `server/tests/{m4-tasks,m4-commands}.test.ts` | 新建：10 用例 |
| 测试 | `server/tests/{helpers,m3-*}.test.ts` | 修改：改用合法 UUIDv7 mutationId 夹具（`labelIds`/`uuidV7From`） |

## 2. 命令与结果（替身层证据）

| 命令 | 结果 | 退出码 |
|---|---|---|
| `pnpm exec tsc -p server/tsconfig.json --noEmit` | 通过 | 0 |
| `pnpm test:server` | **63/63 pass，0 fail**（M1 27 + M3 26 + M4 10） | 0 |
| `pnpm build:cloud` | 3 自包含目录（含 `modules/tasks`） | 0 |
| `pnpm verify:release` | 通过 | 0 |
| `pnpm test`（根） | 34/34 | 0 |
| `pnpm exec tsc --noEmit`（根） | 通过 | 0 |

## 3. M4 对照验收（自检）

| M4 要求 | 状态 | 证据 |
|---|---|---|
| 六状态实现；创建/OPEN 编辑、认领、交付、通过/驳回、重交、归档；服务端赋 author/member/time | ✅ | m4-tasks「任务全流程」「非法迁移」 |
| 公共 Task DTO 不含他人交付说明/附件/私人备注 | ✅ | m4-tasks「公共 Task DTO 不含…」 |
| claim 双人同队竞争恰一成功 | ✅ | m4-tasks「双人竞争认领」 |
| 交付创建独立 round/submission；历史不覆盖；驳回重交保留旧轮 | ✅ | m4-tasks「驳回重交保留轮次历史」 |
| 本阶段先无附件；有 attachmentIds 明确 not_implemented（不静默忽略） | ✅ | m4-tasks「带附件交付…not_implemented」 |
| 审批只当前 submission + expectedRevision，旧审核拒绝 | ✅ | m4-tasks「旧审核不能作用新轮」 |
| 命令键含 canonical(scope)/actor/action/mutationId；inputHash 排除 requestId | ✅（M1 已建，M4 复用） | `shared/command.ts`；m4-commands |
| UUIDv7 年龄门禁 + 24h/7d/30d 窗口 | ✅ | `assertMutationFresh`；m4-commands「EXPIRED」 |
| 查不到 ≠ 失败（ABSENT_IN_WINDOW），不用新键重做 | ✅ | m4-commands「ABSENT_IN_WINDOW」 |
| 结果读取重新鉴权；同 mutationId 两队互不泄露 | ✅ | m4-commands「同 mutationId 两队互不泄露」 |
| 跨队指针（同人两队资格也不能混引用）拒绝 | ✅ | m4-tasks「跨队指针拒绝」 |
| 交付记录仅负责人/管理者可读 | ✅ | m4-tasks「交付记录仅负责人/管理者可读」 |

**未含/待 M5**：submit 的"所选附件转 ATTACHED、未选 session 取消/fence++、DRAFT 附件 GC_PENDING"完整附件链路——本阶段无附件会话，仅保留 batch 封闭契约（代码已就位，待 M5 接通）。

## 4. 出口判据现状

计划 M4 出口："任务与轮次模型可验证、命令无重复业务写；待 M8 真实入口复验。"
- 本地模型与命令语义：**已验证**（63 用例）。
- 真实入口复验：**NOT_RUN**（M8，依赖 M0）。

## 5. 证据边界

本日志仅声明**本地替身**层结果；不代表云端部署、真实微信身份或跨设备可用。
