# M3 执行日志 —— 真实身份、受控多队开通、选队入队及成员

日期：2026-10-17（Asia/Shanghai）
阶段：**M3**（[多团队实施计划](../superpowers/plans/2026-10-17-rak-multi-team-isolation-plan.md) §M3）
前置：M1/M2 已完成；M0 云门禁仍 BLOCKED。
本次结论：**M3 服务端（身份/账户/开通/团队/成员/入队/邀请）与前端云客户端已落地并通过本地替身测试。**
残留：authStore 消费 CloudSession 与页面接线（M2 第 4 项残留 + M7 UI）。

## 1. 变更清单

| 类别 | 文件 | 动作 |
|---|---|---|
| 仓储 | `server/repositories/{store,ids,collections}.ts` | 新建：文档库抽象 + 乐观事务、确定性/随机 ID、集合名 |
| 共享 | `server/shared/{permissions,audit,join-token}.ts` | 新建：角色能力、审计、申请入口签名 token |
| 模块 | `server/modules/context.ts` | 新建：事务内授权解析 + 写栅栏 |
| 模块 | `server/modules/command.ts` | 新建：命令幂等（同事务提交 + 重放） |
| 模块 | `server/modules/auth/index.ts` | 新建：bootstrap / 参考号签发·复用·换发 |
| 模块 | `server/modules/provisioning/index.ts` | 新建：平台初始化 + 每队受控开通（幂等） |
| 模块 | `server/modules/teams/index.ts` | 新建：team.listMine / team.enter |
| 模块 | `server/modules/members/index.ts` | 新建：list / setRole / setStatus / updateMyProfile / updateProfile |
| 模块 | `server/modules/join/index.ts` | 新建：rotate / resolveJoinTarget / submit / status（入口轮换栅栏） |
| 模块 | `server/modules/invites/index.ts` | 新建：create / list / revoke / redeem（12 位码、原子额度） |
| 模块 | `server/modules/api-handlers.ts` | 新建：已实现动作 → 处理器（运行时注入） |
| 入口 | `server/entrypoints/{runtime,rak-api}.ts` | 新建/修改：运行时占位（null）+ 按运行时注册处理器 |
| 前端 | `src/services/cloud/{dto,auth,team,member}.ts` | 新建：云客户端封装（client 已在 M2） |
| 测试 | `server/tests/helpers.ts` + `m3-{auth,provisioning,teams,members,join,invites}.test.ts` | 新建：34 用例 |

## 2. 命令与结果（替身层证据）

| 命令 | 结果 | 退出码 |
|---|---|---|
| `pnpm exec tsc -p server/tsconfig.json --noEmit` | 通过 | 0 |
| `pnpm test:server` | **53/53 pass，0 fail**（M1 27 + M3 26） | 0 |
| `pnpm build:cloud` | 3 个自包含目录（含 `modules/`：auth/members/teams/join/invites/api-handlers） | 0 |
| `pnpm verify:release` | 通过 | 0 |
| `pnpm test`（根回归） | 34/34 | 0 |
| `pnpm exec tsc --noEmit`（根） | 通过 | 0 |

证据层：**内存替身**。不证明真实云鉴权/部署。

## 3. M3 对照验收（自检）

| M3 要求 | 状态 | 证据 |
|---|---|---|
| getWXContext 校验 AppID/env/OPENID；bootstrap 确定性 identity/user 唯一 | ✅ | `api-handlers` requireIdentity；m3-auth「bootstrap 幂等」 |
| user 仅 NORMAL/BLOCKED；BLOCKED 仅本人最小状态 | ✅ | m3-auth「BLOCKED 不能签发参考号」 |
| 平台初始化与每队开通分开；参考号 30 分钟/未消费复用/已消费显式换发 | ✅ | m3-auth 参考号 3 用例 |
| 开通幂等（hash(appId,env,provisioningId)）；同键异输入拒绝；clubId 事务外一次生成 | ✅ | m3-provisioning「开通幂等」「同参考号双 key」 |
| club/owner/审计/消费参考号/操作记录同事务；owner 为 NORMAL 且写其安全栅栏 | ✅ | m3-provisioning「创建 club + 唯一 owner 并消费参考号」 |
| team.listMine 仅本人关联 + createdAt/id 分页；team.enter 实时授权、不写 currentClub | ✅ | m3-teams 3 用例 |
| 关键写触碰 actor member.mutationSeq / club.mutationSeq / 目标 user.securityMutationSeq | ✅ | m3-members「owner setRole 并触碰栅栏」 |
| 每队 owner 唯一；不能授 super/处置 owner/降级；manager 仅管理 member；LEFT 不得借 setStatus 复活 | ✅ | m3-members「任免矩阵」「setStatus」 |
| 名册开关与最小 DTO | ✅ | m3-members「member.list 目录关闭」 |
| 命令幂等：同键同 payload 重放、异 payload idempotency_conflict | ✅ | m3-members「命令幂等」 |
| joinKey（≥128bit）hash 查找；resolve 只返回最小队名 + 短效签名 token | ✅ | m3-join「resolveJoinTarget」 |
| rotate 与首次 join.submit 共写 join_entry_states 栅栏；轮换后旧 token 失效 | ✅ | m3-join「rotate」「join.submit 轮换后失效」 |
| 邀请 12 位码/互斥 code·sceneToken；create 明文当次、命令只 masked | ✅ | m3-invites「create」「redeem」 |
| 额度扣减 + membership + 申请收敛原子；重复不多扣；DISABLED/LEFT 不能借码复活 | ✅ | m3-invites「末次额度竞争」「撤销/过期/DISABLED」 |

**残留（未达 M3 完整出口）**：
- authStore 消费 CloudSession（SETUP_REQUIRED/UNBOUND/TEAM_SELECTION）与 `CloudSession ↔ HTTP LoginOutcome` 分别映射（M2 第 4 项残留）。
- 页面/守卫接线与切队协调器（M7）。
- 真实身份/部署验收（M8，依赖 M0 云门禁）。

## 4. 出口判据现状

计划 M3 出口："本地服务端与契约测试完整，多队最小种子 fixture 可用；真实身份部署验证留 M8。"
- 多队最小种子 fixture：**可用**。
- 服务端与契约测试：**已覆盖 M3 全部模块**；前端接线与 authStore 映射残留 → 完整出口在 M7 收口（不改变 M3 服务端成果）。
- 真实身份部署验证：**NOT_RUN**（M8）。

## 5. 证据边界

本日志仅声明**本地替身**层结果；不代表云端部署、真实微信身份或跨设备可用。
