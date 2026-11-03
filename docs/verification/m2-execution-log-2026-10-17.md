# M2 执行日志 —— cloud 模式与前端双层不可变上下文

日期：2026-10-17（Asia/Shanghai）
阶段：**M2**（[多团队实施计划](../superpowers/plans/2026-10-17-rak-multi-team-isolation-plan.md) §M2）
前置：M1 已完成（[M1 执行日志](./m1-execution-log-2026-10-17.md)）；M0 云门禁仍 BLOCKED。
本次结论：**M2 本地契约与骨架已落地并通过本地门禁；真实云登录/多队进入留待 M3+M8（NOT_RUN）。**

## 1. 变更清单

| 类别 | 文件 | 动作 |
|---|---|---|
| 构建 | `config/build-mode.ts` | 重写：新增 `backend(demo/cloud/http)`、`cloudEnv`、`appId` 与 fail-fast |
| 构建 | `config/index.ts` | 修改：注入 `__RAK_BACKEND__`/`__RAK_CLOUD_ENV__`，透传新 env |
| 构建 | `types/global.d.ts` | 修改：声明两个新编译常量 |
| 常量 | `src/constants/index.ts` | 修改：导出 `BACKEND`/`CLOUD_ENV` |
| 工具 | `src/utils/backend-error.js`+`.d.ts` | 新建：云错误类型（含未知码归一、可重试语义） |
| 工具 | `src/utils/backend-mode.ts` | 新建：云动作可用性/禁止 demo 回退 |
| 工具 | `src/utils/scoped-cache.ts` | 新建：分环境/账户/团队命名空间缓存 |
| 云 | `src/services/cloud/client.ts` | 新建：apiVersion=2 信封 + 响应 scope 校验（纯工厂，可测） |
| 云 | `src/services/cloud/transport.ts` | 新建：Taro `callFunction`/`initCloud` 绑定层 |
| 服务 | `src/services/backend.ts` | 新建：后端选择、云客户端、`requestForBackend` |
| 状态 | `src/store/account.ts` | 新建：`AccountSession`（账户层 epoch/attempt 栅栏） |
| 状态 | `src/store/team-session.ts` | 新建：`TeamSessionStore`（团队层 epoch/状态机/ctx 捕获） |
| 入口 | `src/app.ts` | 修改：cloud 先 `ensureCloudReady()` 再 bootstrap；失败不进入样例身份 |
| 状态 | `src/store/index.ts` | 修改：`authStore.setBootFailure()` |
| 服务 | `src/services/{auth,task,roi,member,club}.ts` | 修改：改用 `requestForBackend`；club 小程序码 cloud 期 not_implemented |
| 测试 | `tests/build-mode.test.ts` | 重写：8 用例覆盖 cloud/demo/http 与冲突 |
| 测试 | `tests/cloud-client.test.ts` | 新建：6 用例（信封/scope/错误/不回退） |
| 测试 | `tests/team-context.test.ts` | 新建：5 用例（账户栅栏/A→B→A/缓存隔离） |
| 测试 | `tests/service-mode.test.ts` | 新建：2 用例（not_implemented/禁回退） |

## 2. 命令与结果（本地证据层）

| 命令 | 结果 | 退出码 |
|---|---|---|
| `pnpm test` | **34/34 pass，0 fail**（原 17 + M2 新增） | 0 |
| `pnpm exec tsc --noEmit --pretty false --skipLibCheck` | 通过（无输出） | 0 |
| `pnpm test:server` | 27/27 pass | 0 |
| `pnpm verify:no-client-db` | 通过 | 0 |
| `pnpm verify:release`（config/no-client-db/artifacts） | 通过 | 0 |

证据层：本地契约/类型/静态。**不**证明真实云登录/多队进入（需 M8）。

## 3. M2 对照验收（自检）

| M2 要求 | 状态 | 证据 |
|---|---|---|
| cloud 独立于 demo/HTTP；缺 env/生产 demo/矛盾变量 fail-fast | ✅ | `config/build-mode.ts`；build-mode.test 8 用例 |
| 正式包只 cloud，错误不 fallback demo | ✅ | `assertNoDemoFallback`；`requestForBackend` 只抛 not_implemented |
| cloud.init 完成后才 bootstrap | ✅ | `src/app.ts` + `ensureCloudReady()` |
| callFunction 统一传输/业务错误、版本、字段/响应 scope；ok:false 不当成功 | ✅ | `src/services/cloud/client.ts`；cloud-client.test 6 用例 |
| AccountContext（backend/env/appId/accountKey/accountEpoch；首登 attemptId） | ✅ | `src/store/account.ts` |
| TeamContext（clubId/memberId/epoch/membershipRevision） | ✅ | `src/store/team-session.ts` |
| GLOBAL 捕获 AccountContext+queryGeneration；TEAM 捕获 TeamContext | ✅ | account/team-session 的 capture/isCurrent |
| A→B→A 以 epoch 区分，非仅 clubId | ✅ | `team-context.test.ts`「A→B→A」
| 门面显式选 adapter；未实现云动作抛 not_implemented，不误走 HTTP | ✅（cloud 全量 not_implemented） | `backend.ts` `requestForBackend`；service-mode.test |
| 不持久化业务列表/权限；最小索引命名空间 | ✅ | `scoped-cache.ts` |
| 全局列表/入队只更新本人账户级；旧账号结果不回填新账号 | ✅（基础契约） | account/team-session epoch 栅栏 + 测试 |

**出口判据**："本地替身契约完备；不以此宣称真实云登录" —— 满足。

## 4. 多团队功能覆盖（阶段进度；要求 #4）

| 多团队功能项 | 计划阶段 | 当前状态 |
|---|---|---|
| 团队受控创建（不开放自助建队） | M3 | 未实现（契约已定：`provisioning_operations`） |
| 每队独立 owner 与角色（owner/manager/member） | M3 | 未实现（注册表/矩阵已定） |
| 团队成员权限分配（setRole/setStatus/updateProfile） | M3 | 契约+字段 schema 已定（M1），实现待 M3 |
| 跨团队数据隔离（clubId 归属、TenantContext、游标 scope） | M1/M2 | 契约/骨架已落地；业务实现待 M3–M6 |
| 多团队操作流程（team.listMine/enter/加入第二队/切队协调器） | M2/M3/M7 | M2 上下文与 epoch 骨架已落地；UI 待 M7 |
| 同微信多队身份/资料拆分 | M3 | 未实现 |
| 私有附件跨队隔离 | M5 | 阻塞（待 M0 上传裁决） |
| 真机/双设备/恢复 | M9 | NOT_RUN |

## 5. 未运行 / 阻塞项

- 真实云登录、多队进入、跨队拒绝的真实证据：**NOT_RUN**（M0 云门禁 BLOCKED）。
- UI 层切队/守卫/深链：M7（本阶段只落上下文骨架）。
- 附件 transport：M5（依赖 M0 上传裁决）。

## 6. 下一步

M3（真实身份/受控多队开通/选队入队/成员）本地实现与测试；真实身份验收统一在 M8。

## 7. 证据边界

本日志只声明**本地**已完成项，不代表云端已上线或真实多人可用。
