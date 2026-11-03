# M6 执行日志：其余全部业务的本队隔离与统计

日期：2026-10-17（Asia/Shanghai）。执行者：AI（严格按已确认规格与任务清单执行）。
规格：[M6 规格](../superpowers/specs/2026-10-17-rak-m6-biz-isolation-spec.md)；任务：[M6 任务清单](../superpowers/plans/2026-10-17-rak-m6-biz-isolation-tasks.md)。
真源：多团队 DESIGN §10/§11；BASE-DESIGN §9.2/§10；PLAN §M6。

## 1. 执行步骤与验证结果

| 步骤 | 操作内容 | 产物 | 验证结果 |
|---|---|---|---|
| T1 | 新建共享工具层；登记新集合 | `server/shared/text.ts`、`server/shared/money.ts`、`server/shared/shanghai-date.ts`；`server/repositories/collections.ts` 增 `announcements`/`roiItems` | 服务端类型检查 0 错误 |
| T2 | 公告模块 + DTO | `server/modules/announcements/index.ts`、`server/contracts/dtos.ts` 增公告 DTO | 4 用例通过（草稿隔离/状态机/三值游标/异队 cursor） |
| T3 | ROI 模块 + DTO | `server/modules/roi/index.ts`、DTO | 6 用例通过（精度/非法值/上海周期/软删/编辑月份/异队） |
| T4 | 绩效模块 + DTO | `server/modules/performance/index.ts`、DTO | 2 用例通过（口径/去重/同分排序/mine 隔离/超预算） |
| T5 | 社团设置与摘要 | `server/modules/club/index.ts`、DTO | 5 用例通过（字段/白名单/名册关闭/摘要/profile） |
| T6 | 注册表与信封白名单 | `server/contracts/actions.ts`（新增 16 条 `ACTION_DATA_SCHEMAS`）、`server/modules/api-handlers.ts`（注册 18 个动作） | 信封层多余字段拒绝用例通过 |
| T7 | 服务端测试 | `server/tests/m6-{announcements,roi,performance,club-summary}.test.ts` | `pnpm test:server` 80/80 PASS（M6 新增 17 例） |
| T8 | 客户端适配 | `src/services/cloud/{club,roi,performance}.ts`、`src/services/cloud/dto.ts` | 根类型检查 0 错误；`verify:no-client-db` 通过 |
| T9 | 门禁与文档 | 本日志、`docs/api/cloud-v2.md` §5.1、规格 §7.2 命令修正 | 六条门禁全 PASS |

## 2. 门禁原始结果（2026-10-17）

```text
corepack pnpm test:server
  → ℹ tests 80 / pass 80 / fail 0

corepack pnpm test
  → ℹ tests 34 / pass 34 / fail 0

corepack pnpm exec tsc -p server/tsconfig.json --noEmit
  → （无输出，0 错误）

corepack pnpm exec tsc --noEmit --pretty false --skipLibCheck
  → （无输出，0 错误）

corepack pnpm build:cloud
  → 生成 3 个自包含函数目录到 cloudfunctions/
     rakApi digest=03acefd6396d6b03…
     rakFiles digest=af7c7170ef0a680c…
     rakMaintenance digest=6586d2b7981c78e3…

corepack pnpm verify:release
  → verify:cloud:config 通过；verify:no-client-db 通过；verify:cloud:artifacts 通过；verify:release 通过
```

### 2.1 门禁命令修正说明（T9 自检发现）

规格 §7.2 原写 `corepack pnpm exec tsc --noEmit`。实测该形式会因 `node_modules` 的
Taro/mobx/webpack 类型声明缺陷报错（与本次改动无关，错误全部位于 `node_modules/.pnpm/**`）。
PLAN §4 记录的**现行**命令为 `pnpm exec tsc --noEmit --pretty false --skipLibCheck`；
已按 PLAN 修正规格 §7.2 与本节命令，未降低任何源码检查范围。

## 3. 出口自检（对照规格 §7.3）

- [x] 无 `not_implemented` 遗留 M6 动作：公告/ROI/绩效/社团/摘要 18 个动作全部实现并注册。
- [x] 所有列表 `clubId` 过滤 + 游标指纹 + 稳定排序；异队 cursor 拒绝（公告与 ROI 均有用例）。
- [x] 所有写经 `runIdempotent` 幂等命令 + 审计 + `club.mutationSeq` 栅栏（ROI 另加 actor `member.mutationSeq`）；revision 冲突正确返回。
- [x] 金额/日期/文本规则逐条有测试证据（精度/上限/非法小数/上海跨月跨季/CRLF→LF/控制符/码点长度）。
- [x] `docs/api/cloud-v2.md` §5.1 与 DTO 一致。
- [x] 无遗留 HTTP 业务旁路：`verify:no-client-db` 通过（`src/` 无客户端 DB 与服务端 SDK 泄漏）。
- [x] 空云返回合法空态，未注入演示内容（全部列表在空库返回 `items: []`）。

## 4. 未执行项（NOT_RUN）

- 真实云环境（数据库/存储/函数部署、真实微信身份、双设备换机）→ **NOT_RUN**，依赖 M0 云能力门禁（见 `docs/MANUAL-OPERATIONS.md`）。本阶段测试全部为本地替身层，**不构成真实云鉴权证据**。
- M5 附件（`file.*`）仍为 `not_implemented`，按计划在 M5 阶段实现。
- 真机验收（MT01/02/08/11/18/20）→ **NOT_RUN**，留待 M8/M9。

## 5. 与 PLAN M6 条目的对应

| PLAN M6 条目 | 落点 |
|---|---|
| 公告创建/发布/编辑/置顶/归档；草稿仅管理者可见；普通成员只 PUBLISHED | `server/modules/announcements/index.ts` + 用例 1/2 |
| ROI 元字符串→分、上海左闭右开、0 成本 null、软删/取消/近 6 月补 0/all 口径 | `server/modules/roi/index.ts` + 用例 1/3/4 |
| 绩效按本队 memberId、曾驳回按 task 去重、mine 只本人、list 仅 manager+、score desc/memberId asc、超预算 stats_unavailable | `server/modules/performance/index.ts` + 用例 1/2 |
| profile.summary/club.dashboard 显式摘要不伪造 total；名册关闭仍给在册总数 | `server/modules/club/index.ts` + 用例 3/4/5 |
| 所有列表固定 clubId + 查询指纹 + 稳定排序游标；异队 cursor 拒绝；翻页失败保原 cursor | announcements/roi/performance 三处游标实现 + 用例 |
| 所有写服务端白名单、revision、命令/审计、栅栏；控制符/LF 规则 | `server/shared/text.ts` + 各模块写路径 |
| 空云返回合法空态 | 全部列表空库用例 |
