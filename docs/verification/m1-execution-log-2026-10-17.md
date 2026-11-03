# M1 执行日志 —— 多团队 v2 契约、数据模型及函数骨架

日期：2026-10-17（Asia/Shanghai）
阶段：**M1**（[多团队实施计划](../superpowers/plans/2026-10-17-rak-multi-team-isolation-plan.md) §M1）
前置：M0 本地部分完成（[能力报告](./cloudbase-capabilities-2026-10-17.md)）；M0 云能力门禁 **BLOCKED**（无环境访问/真实身份）。
本次结论：**M1 本地契约与骨架已落地并通过本地门禁；云部署/SDK/真实身份相关项保持未运行（NOT_RUN）。**

## 1. 变更清单（本阶段实际写入）

| 类别 | 文件 | 动作 |
|---|---|---|
| 契约 | `server/contracts/{errors,actions,request-v2,dtos}.ts` | 新建 |
| 共享 | `server/shared/{validation,tenant-context,authorization,identity,command,cursor,transaction,logging}.ts` | 新建 |
| 仓库契约 | `server/repositories/db.ts` | 新建 |
| 入口 | `server/entrypoints/{dispatch,rak-api,rak-files,rak-maintenance}.ts` | 新建 |
| 配置 | `server/tsconfig.json`、`server/tsconfig.build.json`、`server/package.json` | 新建 |
| 测试 | `server/tests/{contracts,dispatch,command}.test.ts` | 新建 |
| infra | `infra/cloudbase/{collections,indexes,database-rules,storage-rules,function-rules}.json` | 新建 |
| 脚本 | `scripts/{build-cloud,verify-cloud-artifacts,verify-cloud-config,verify-no-client-db,verify-release}.mjs` | 新建 |
| 文档 | `docs/api/cloud-v2.md`、`docs/adr/adr-0006-cloudbase-multiteam-backend.md`、`docs/verification/action-matrix-2026-10-17.md` | 新建 |
| 同步 | `docs/CONSTRUCTION.md`、`docs/DEVELOPMENT.md`、`docs/OPEN-QUESTIONS.md` | 修改（加当前路线横幅/云端开发节） |
| 工程 | `package.json`（+6 脚本）、`project.config.json`（+`cloudfunctionRoot`）、`.gitignore`（+`cloudfunctions/`、`server/build/`） | 修改 |

未触碰：`src/**`（前端业务代码属 M2+）；既有 `MM` 暂存改动与 4 个未跟踪文档保持原样（未 reset/stage/commit）。

## 2. 命令与结果（本地证据层）

| 命令 | 结果 | 退出码 |
|---|---|---|
| `pnpm exec tsc -p server/tsconfig.json --noEmit` | 通过（无输出） | 0 |
| `pnpm test:server` | **27/27 pass，0 fail** | 0 |
| `pnpm build:cloud` | 生成 3 个自包含函数目录（rakApi/rakFiles/rakMaintenance） | 0 |
| `pnpm verify:cloud:config` | 通过（集合/规则/索引一致，无 public-write、无 worker 客户端 invoke） | 0 |
| `pnpm verify:no-client-db` | 通过（src 无 DB SDK 调用） | 0 |
| `pnpm verify:cloud:artifacts` | 通过（结构/哈希/无禁用串） | 0 |
| `pnpm verify:release` | 通过（组合静态与发布包门禁） | 0 |
| `pnpm test`（既有回归） | **17/17 pass，0 fail** | 0 |
| `pnpm exec tsc --noEmit --pretty false --skipLibCheck`（根） | 通过（无输出） | 0 |
| 生成产物冒烟（`require` 后调用 main） | rakApi 返回 `not_implemented`；rakMaintenance 返回 `handled:false` | — |

证据层：以上均为**本地静态/契约测试**。**不**证明真实云权限/事务/文件/多身份——那需要隔离环境与真实微信（M8）。

## 3. M1 对照验收（自检）

| M1 要求 | 状态 | 证据 |
|---|---|---|
| 逐 action 记录 schema/scope/角色/资源/幂等/事务/审计/错误/测试ID | ✅ | `docs/verification/action-matrix-2026-10-17.md`；`server/contracts/actions.ts` 注册表 |
| 身份/成员 DTO：AccountView 最小 accountKey、TeamSession；业务改 member 引用 | ✅ | `server/contracts/dtos.ts` |
| RequestScope 联合 + apiVersion=2 信封 + 响应 scope 校验 | ✅ | `server/contracts/request-v2.ts`；contracts.test |
| 注册表精确 GLOBAL/TEAM；拒绝 payload 夹入归属/自报授权字段 | ✅ | `shared/validation.ts` 归属字段扫描；contracts.test |
| setRole 仅 targetRole、setStatus 仅 targetStatus | ✅ | `ACTION_DATA_SCHEMAS`；contracts.test |
| 全部集合/主键/索引清单（含 join_entry_states/provisioning/credentials/attempts/chunks/jobs/commands） | ✅ | `infra/cloudbase/{collections,indexes}.json`；verify:cloud:config |
| 仓库 API 必须接 TenantContext、getById 比对 clubId、count/aggregate 同 filter | ✅（契约） | `server/repositories/db.ts` |
| 错误语义（含 cursor_scope_mismatch/revision_conflict/result_unknown/stats_unavailable；异队=resource_not_found） | ✅ | `server/contracts/errors.ts` |
| 三函数产物 + 权限配置 + project.config 识别 cloudfunctions/ | ✅ | `build:cloud` 产物；`infra/.../function-rules.json`；project.config.json |
| test:server / build:cloud / verify 脚本 + 最小合法非法 fixture 证明门禁 | ✅ | package.json scripts；27 用例；4 个 verify |
| 前端/发布依赖无服务端 SDK 与运维凭据 | ✅ | verify:no-client-db + verify:cloud:artifacts |
| ADR 明确替代旧 rak-auth 主业务路线、无双写 | ✅ | `docs/adr/adr-0006-cloudbase-multiteam-backend.md`；CONSTRUCTION/OPEN-QUESTIONS 横幅 |

**出口判据**："契约可独立测试、自包含函数可打包，尚未实现业务必须明确不可用" —— 已满足（业务动作均 `not_implemented`）。

## 4. 未运行 / 阻塞项（如实标注）

- M0 云能力门禁（E1–E3、U1–U5、D1、W1、C1、O1）与多团队 P0 检查：**BLOCKED**，待环境访问与真实微信身份。
- SDK 精确锁版（wx-server-sdk / @cloudbase/node-sdk）：**NOT_RUN**；产物当前无运行时依赖，`manifest.sdkCandidate.locked=false`。
- 真实云部署、`pnpm test:cloud:integration`、双账号/双设备：**NOT_RUN**（M8/M9）。
- 各业务模块的**字段级 schema**：仅 DESIGN 显式列出者已在 M1 声明；其余随 M3–M6 模块补齐（`ACTION_DATA_SCHEMAS` 可扩展）。

## 5. 需要人工/后续

1. 提供 CloudBase 环境访问（CLI 登录/控制台），以解除 M0 云门禁并为 M8 铺路（详见 M0 报告 §5）。
2. 下一阶段 **M2**（cloud 模式与前端双层上下文，本地可推进）；M3 起需要真实身份验收（统一在 M8）。

## 6. 证据边界声明

本日志只声明**本地**已完成项。复选框式"通过"仅对第 2 节命令成立的本地范围有效；不代表云数据库/云函数/文件共享已上线。
