# M8 运行时绑定 — 执行日志（2026-10-18）

时间：2026-10-18（Asia/Shanghai）
范围：**H-7 SDK 锁版写入产物 + 本机可验证的 M8 运行时绑定**（规格 [spec.md](../../.planning/2026-10-18-m8-runtime-binding/spec.md) / [tasks.md](../../.planning/2026-10-18-m8-runtime-binding/tasks.md)）
出处：[多团队 PLAN §M8](../superpowers/plans/2026-10-17-rak-multi-team-isolation-plan.md)、[M0 能力报告](./cloudbase-capabilities-2026-10-17.md)
性质：**纯本地**（代码/单测/产物）。**未做任何云端写入**（未部署、未改规则/索引、未写业务数据）。

---

## 1. 前提与冲突裁决

| 项 | 状态 |
|---|---|
| H-8 集合(20) / H-9 索引(26) / H-10 规则 / H-12 三函数部署 | 已完成（前轮） |
| **H-11 函数调用规则** | **用户 2026-10-18 在控制台进行中**（未回报前不视为完成） |
| SDK 锁版 | `wx-server-sdk@4.0.2`（M0 实测）；**本轮写入产物**（H-7） |

**关键冲突（本轮解决）**：`server/repositories/store.ts` 的 `Database`/`Tx` 为**同步**接口，而 wx-server-sdk **全部异步**
（`doc.get()/set()/remove()`、`runTransaction`、分页 `get()` 均返回 Promise）→ **同步接口无法绑定真实 SDK**。
经用户批准采用 **D1：接口改为 `Promise<T>`**（不用联合类型，避免"测试绿、线上坏"），由 `tsc` 强制穷尽 await。

---

## 2. 逐步骤操作与验证结果

| 步骤 | 操作内容 | 验证结果 |
|---|---|---|
| **T1** D1 异步化 | `store.ts` 的 `Database`/`Tx` 改 `Promise`；`MemoryDatabase` 语义不变；15 个模块 + `shared/audit.ts` + 12 个测试文件加 `await`/改 `async`；辅助函数（`resolveTenant`/`bumpMutationSeq`/各 fence/`memberNameWith`/`publishedSummaries`/`readRevision` 等）随之改 async | `tsc -p server/tsconfig.json`：**490 error → 0**；`tx.set(` **103/103** 已 await、`tx.remove` 0 处；无 `as any`/`@ts-ignore` 新增；`test:server` **108/108** |
| **T2** SDK 端口与装配（D3） | 新增 `server/shared/cloud-sdk.ts`（端口 + `loadCloudSdk()` 懒加载）；`server/entrypoints/runtime.ts` 实现 `readRuntimeConfig` + `createApiRuntime/createFilesRuntime` + `loadApiRuntime/loadFilesRuntime`（缺 SDK 或必填环境变量 → `null`）；`rak-files.ts` 改为引用 `runtime.ts` | server `tsc` 0 error |
| **T3** DB 适配（D4） | 新增 `server/repositories/sdk-database.ts`：`read`（不存在→null，集合不存在→internal_error）、`query`（分页全扫 + 预算 20000 → `stats_unavailable`）、`tx`（doc 级 + 闭包捕获 + 冲突→`revision_conflict`） | 见 T5 用例 |
| **T4** 存储适配（D5） | 新增 `server/storage/sdk-adapter.ts`：`uploadObject`（用 SDK fileID）、`downloadObject`、`deleteObjects`（逐项保序）、`fileIdForPath`（配置前缀）、`capabilities()`（`downloadTtlSeconds=null`） | 见 T5 用例 |
| **T5** 假 SDK 用例 | 新增 `server/tests/m8-runtime-binding.test.ts`（12 用例：配置/守门/read/query 预算/tx/storage 五法/装配注入） | `test:server` **120 pass / 0 fail**（原 108 + 12） |
| **T6** H-7 写入产物 | `scripts/build-cloud.mjs`：`SDK_LOCK` 写入三产物 `dependencies` 与 `manifest.sdkCandidate` | `build:cloud` 成功；`rakApi/package.json` = `{"wx-server-sdk":"4.0.2"}`；`manifest.sdkCandidate.locked=true`；`verify:cloud:artifacts` 通过 |
| **T7** 全量门禁 | 见 §3 | 全绿 |

**过程中发现并修正的一处真实缺陷**：首版在 `sdk-database.ts` 与测试假类中使用了 TS **参数属性**
（`constructor(private readonly x: X)`）——Node `--experimental-strip-types`（strip-only 模式）**不支持**该语法，
导致 `dispatch.test.ts`/`m5-files-skeleton.test.ts`/`m8-runtime-binding.test.ts` 直接语法报错。
已改为显式字段 + 构造赋值，全部恢复通过。

---

## 3. 门禁命令与输出摘要

```text
corepack pnpm test
  → tests 78 / pass 78 / fail 0

corepack pnpm test:server
  → tests 120 / pass 120 / fail 0        （改造前 108）

node node_modules/typescript/bin/tsc -p server/tsconfig.json --noEmit
  → 0 error（改造前 490）

corepack pnpm exec tsc --noEmit --pretty false --skipLibCheck
  → 0 error          （本项目根类型检查的既有约定形式；不加 --skipLibCheck 时 node_modules/@tarojs 的 .d.ts 报错为既有环境问题，与本次改动无关）

corepack pnpm build:cloud            → 3 个自包含函数目录生成（digest 已更新）
corepack pnpm verify:cloud:artifacts → 通过（结构/哈希/无禁用串）
corepack pnpm verify:cloud:config    → 通过（集合/规则/索引一致）
corepack pnpm verify:no-client-db    → 通过（src/ 无客户端 DB 调用与服务端 SDK 泄漏）
corepack pnpm verify:routes          → 通过（31 路由）
corepack pnpm verify:release         → 通过（含 verify:client:cloud：cloud prod 产物无演示/测试注入/服务端 SDK，已内联云环境）
```

---

## 4. 偏差（如实记录，未掩盖）

1. `query(predicate)` 为任意 JS 谓词、SDK 无法下推 → **分页全量扫描 + JS 过滤**（页 500、预算 `MAX_SCAN_DOCS=20000`，超限 `stats_unavailable`，不返回部分结果）。属**待优化项**。
2. 事务仅 **doc 级** `get/set/remove`；`runTransaction` 的**返回外壳结构未实测** → 端口声明 `unknown`，适配层**闭包捕获**回调返回值（不按猜测取值）。
3. 「文档不存在」判定 = `errCode === -502004` **或** 平台文案（探针实测形如 `document with _id X does not exist`）；**该 errCode 待云侧实测确认**。集合不存在（`-502005`）**不**视为文档不存在，如实抛 `internal_error`。
4. `fileIdForPath` 依赖**配置的** `RAK_STORAGE_FILEID_ROOT`（非手拼猜测）；SDK 能力面未列 `getUploadMetadata`，U5 已证明同路径 fileID 可确定性构造。
5. 写入事务时**剥离 `_id`**（id 由文档路径决定；假 SDK 模拟平台拒绝 data 携带 `_id`，用例已覆盖）。

---

## 5. 未运行项（NOT_RUN，不伪造为 PASS）

- 真实微信身份下的 DB 读写、事务冲突**真实** errCode 与重试行为、真实字节上传/下载（U2/U4）。
- worker `rakMaintenance` 平台来源 / SOURCE 校准（W1）。
- H-15/H-16/H-17 参考号与受控开通、MT01–MT22 真实项（需真机/真实微信）。
- **函数重新部署与环境变量配置**：**已执行**（2026-10-18，经用户授权）—— 见 §8 与 §9；当前线上已绑定运行时。

---

## 6. 本轮文件变更

**新增**
- `server/shared/cloud-sdk.ts`
- `server/repositories/sdk-database.ts`
- `server/storage/sdk-adapter.ts`
- `server/tests/m8-runtime-binding.test.ts`
- `.planning/2026-10-18-m8-runtime-binding/{spec.md,tasks.md}`
- `docs/verification/m8-execution-log-2026-10-18.md`（本文件）

**修改**
- `server/repositories/store.ts`（接口/实现异步化）
- `server/modules/*`（15 个）+ `server/shared/audit.ts` + `server/tests/*`（12 个）：加 `await` / 改 `async`
- `server/entrypoints/{runtime.ts,rak-api.ts,rak-files.ts}`
- `scripts/build-cloud.mjs`（SDK 锁版写入）
- `docs/MANUAL-OPERATIONS.md`（H-7 完成、环境变量步骤、H-11 状态、§0 状态）
- `docs/verification/cloudbase-capabilities-2026-10-17.md`（新增 §8）

**生成产物（可重新构建）**
- `cloudfunctions/**`：三函数目录重新生成，`package.json.dependencies` 含 `wx-server-sdk: 4.0.2`

**云端资源变更**：**无**（本轮零云端写入）。

---

## 7. 下一步（按 PLAN 顺序）

1. **H-11（用户）** 完成后回报 → 我发起**重新部署**（`build:cloud` → `fn deploy` 三函数 `--install-dependency true`）+ 冒烟；**需用户单独授权**。
2. 配置**函数环境变量** —— **已完成（2026-10-18，见 §8）**：`RAK_APP_ID`/`RAK_CLOUD_ENV`/`RAK_JOIN_SECRET`/`RAK_STORAGE_FILEID_ROOT` 已推送至 `rakApi`/`rakFiles`。
3. H-14 平台初始化 → H-15/H-16/H-17 受控开通（需真机真实微信）→ H-18/H-19 真机与双设备验收。

---

## 8. 追加（2026-10-18，经用户授权）：函数**环境变量**配置（独立于代码部署）

用户授权「配置函数环境变量」。CLI **只读排查**后确认可行路径：`cloudbaserc.json` 的 `functions[].envVariables`
→ `tcb config update fn <name>` 推送配置，**无需重新部署代码**。

| 步骤 | 命令/动作 | 结果 |
|---|---|---|
| 1 | `config pull fn rakApi rakFiles rakMaintenance -o <temp>` | 拉回云端当前配置（当时**无**环境变量；含 handler/timeout/runtime/memorySize/installDependency） |
| 2 | 本机脚本把 4 个 `RAK_*` 合并写入 `cloudbaserc.json`（`RAK_JOIN_SECRET` = `randomBytes(48).toString('base64url')`） | 写入成功；**密钥未回显**（只打印键名与长度） |
| 3 | `tcb config update fn rakApi`、`fn rakFiles`（交互项选「覆盖更新」） | 均返回「配置更新成功：`envVariables=4项`」 |
| 4 | `config pull fn ...` 回读 + 只打印键名/布尔的校验脚本 | `rakApi`、`rakFiles` 各 **4 键**；`rakMaintenance` **0 键**（按设计不需要） |

**密钥处置**：`RAK_JOIN_SECRET`（64 字符 base64url）由本机生成，**全过程未出现在任何命令文本或输出中**；
仅落于**被 `.gitignore` 忽略**的本机 `cloudbaserc.json` 与云端函数环境变量。含密钥的临时拉取文件已删除。

**CLI 能力补充（供 H-11 与后续部署参考）**：

- `fn env` 仅支持 `pull`；**设置**环境变量走 `config update fn`（读 `cloudbaserc.json`）。
- `config update fn` 可推送的 fn 字段：`--timeout/--memory/--runtime/--handler/--vpc` 与文件内 `envVariables`；
  **没有**函数「调用权限」字段 → 与既有结论一致，**H-11 仍需控制台**。
- 另有 `tcb policy`（网关鉴权策略 OPA Rego）与已下线的 `permission`：面向网关/资源策略，**不是**本项目的函数调用权限入口。
- 全局支持 `--config-file <path>`（本次未使用）。

**仍未做**：函数**重新部署**（T9）—— **已于 §9 完成**（三函数重新部署，冒烟返回 `identity_required`）。

**本机一次性辅助脚本（在系统临时目录，不进仓库）**：`rak-setfnenv.mjs`（生成密钥并合并配置）、
`rak-cfgupdate.mjs`（非交互推送配置）、`rak-cfgverify.mjs`（只读校验键名）。

---

## 9. 追加（2026-10-18，经用户授权）：重新部署三函数 + 云侧冒烟（T9）

用户确认「H-1」即 **H-11**（函数调用权限，**须你在控制台配**；CLI 无该字段），并授权「**现在部署并冒烟**」。

| 步骤 | 动作 | 结果 |
|---|---|---|
| 重新部署 | 项目根 `fn deploy {rakApi,rakFiles,rakMaintenance} --force --install-dependency true`（读本机 `cloudbaserc.json`，云端装 `wx-server-sdk@4.0.2`） | 三函数均「云函数部署成功」 |
| 冒烟 1 | `fn invoke rakApi`（合法信封 `auth.me`，GLOBAL） | `identity_required`（**非** `not_implemented`）✔ |
| 冒烟 2 | `fn invoke rakFiles`（合法信封 `file.status`，TEAM） | `identity_required` ✔ |
| 门禁 | server `tsc` 0 / `test:server` 120 / `test` 78 / `build:cloud`+`verify:cloud:artifacts` / 根 `tsc --skipLibCheck` 0 / `verify:release` | 全绿 |

**发现的真实缺陷与修正（重要，仅云侧可暴露）**：

- 首次部署后冒烟报 `Cloud API isn't enabled, please call init first`
  （栈：`createApiRuntime → sdk.database()`，`/var/user/entrypoints/runtime.js`）→ 装配时**未调用 `cloud.init()`**。
  本机假 SDK 不依赖 init，故此前无法暴露。
- 修正：`server/shared/cloud-sdk.ts` 把 `init` 纳入必需能力面与形状校验；
  `server/entrypoints/runtime.ts` 两个工厂**先 `sdk.init({ env: config.env })`** 再绑定数据库/存储；
  `server/tests/m8-runtime-binding.test.ts` 断言 `init` 被调用且 `env` 取**配置值**（不用自报值）。
- 修正后重新构建 → 重新部署 → 冒烟通过。

**证据原文（脱敏）**：`RetMsg` = `{"ok":false,"requestId":"smoke-m8-20261018-1","scope":{"kind":"GLOBAL"},"error":{"code":"identity_required","message":"缺少可信微信身份，请重试","retryable":false},"serverTime":"2026-10-18T06:15:45.890Z"}`；
事件日志仅含 `requestId/action/scope/clubId/code/durationMs`（**无** openid/URL/密钥，符合日志口径）。

**本轮云资源变更**：仅「函数配置（环境变量）+ 三函数重新部署」，**未**改规则/索引、**未**写业务数据、**未**创建或删除集合/存储对象。

**仍未做 / 仍 NOT_RUN**：**H-11 已于 §10 完成**；H-14 平台初始化、真实微信身份的 DB/事务/字节（U2/U4/W1）、MT01–MT22。

---

## 10. 追加（2026-10-18，经用户授权）：H-11 云函数安全规则（**含对既有结论的更正**）

| 项 | 结果 |
|---|---|
| **改前（实测）** | `{"*":{"invoke":true}}` —— **所有来源（含未登录）都能调用任意函数**，含 `rakMaintenance` |
| **目标 / 已写入** | `{"*":{"invoke":"auth != null"},"rakMaintenance":{"invoke":false}}` |
| 写入 | `tcb api tcb ModifyResourcePermission`（`EnvId` / `ResourceType:"function"` / `Permission:"CUSTOM"` / `SecurityRule`）→ `{"Success":true}` |
| **读回复核** | `tcb api tcb DescribeResourcePermission` → `SecurityRule` 与目标**完全一致** ✔ |
| 反向对照 | 管理侧 `tcb fn invoke rakMaintenance` 仍正常返回其骨架应答 → **该规则只约束"客户端调用"** ✔ |

**结论更正（如实记录）**：此前记录的"CLI 无相关子命令 → 本步必须在控制台设置"**不完整**。
真实机制是**环境级「云函数安全规则」**（微信官方《云函数安全规则》，`{"*":{"invoke":"auth != null"}}`），
可用官方接口 `TCB.ModifyResourcePermission` 写入、`DescribeResourcePermission` 读回（均经 `tcb api` 实测）；
控制台侧入口为云函数列表页的「权限控制」（腾讯云《云函数》操作指南）。

**行为层验证仍 NOT_RUN**：客户端是否真的被拒须**真机小程序**（H-19/H-20）实测；管理侧 invoke 与"控制台测试"永远可调用，不能据此判客户端可用。

**本机一次性辅助脚本（临时目录）**：`rak-h11.mjs`（`read` 查询 / `apply` 写入云函数安全规则）。

---

## 11. 追加（2026-10-18，经用户授权）：H-14 平台初始化

**执行前发现的缺口**（若不补则无法执行）：受控脚本 `scripts/bootstrap-cloud-platform.mjs` 经 `rakMaintenance`
调用并要求返回 `{initialized:true}`；而该函数当时只返回 `not_implemented`，仓库内**不存在**任何
`platformInitialize` 处理入口。且脚本用 `JSON.parse(stdout)` 直接取 `initialized`，与 `tcb fn invoke --json`
的**外壳结构**不匹配（该假设此前从未实测）。

**本轮改动（最小受控 worker 入口）**：

| 文件 | 改动 |
|---|---|
| `server/entrypoints/runtime.ts` | 新增 `readPlatformConfig()`（仅 AppID/环境，**不持有业务密钥**）、`MaintenanceRuntime`、`createMaintenanceRuntime()`、`loadMaintenanceRuntime()`；`readRuntimeConfig()` 改为复用平台配置 |
| `server/entrypoints/rak-maintenance.ts` | 按 `event.kind` 分发：`platformInitialize` → 幂等 `initializePlatform()`；未知 kind/运行时缺失 → `not_implemented`；`appId` 与**配置**不一致 → `app_id_mismatch`（无副作用） |
| `server/tests/m8-runtime-binding.test.ts` | 新增 3 个用例（平台配置读取 / worker 运行时装配且不持有密钥 / 受控分发幂等与拒绝） |
| `scripts/bootstrap-cloud-platform.mjs` | 响应解析兼容 `data.RetMsg` 外壳（同时保留"直接返回函数值"形态） |
| `cloudbaserc.json`（本机、已 gitignore） | `rakMaintenance` 增 `RAK_APP_ID`/`RAK_CLOUD_ENV` |

**执行与证据**：

| 步骤 | 结果 |
|---|---|
| `tcb config update fn rakMaintenance` | `envVariables=2项`；`rakApi`/`rakFiles` 仍各 4 项（**未被误改**） |
| `build:cloud` + `verify:cloud:artifacts` + `fn deploy rakMaintenance --force --install-dependency true` | 校验通过 / 部署成功 |
| `node scripts/bootstrap-cloud-platform.mjs`（run 1） | `平台已初始化（already=false）`，exit 0 |
| 同上（run 2 = 幂等） | `平台已初始化（already=true）`，exit 0（未重置） |
| 独立只读核验 `tcb db nosql dump rak_system_config --file-type json` | `{"_id":"main","appId":"wxa8bf102dcfdcec4c","schemaVersion":1,"platformInitializedAt":1792305910614,"maintenanceFlags":{}}`（**无** `clubId`/`ownerUserId`） |

**门禁**：server `tsc` 0、`test:server` **123**（原 120 + 3）、`test` 78、根 `tsc --skipLibCheck` 0、`verify:release` 全绿。

**通道补充**：管理通道 `db nosql execute` 不支持文档级 `find`（只支持库级命令）；文档级只读核验可用
`tcb db nosql dump <collection> --file-type json`（本次实测可用，属只读）。

**云资源变更**：函数 `rakMaintenance` 环境变量（2 项）+ 重新部署；集合 `rak_system_config` 新增 **1 个**文档
（`_id=main`，即平台初始化本步目的）；未改规则/索引，未创建/删除集合或存储对象，未写其他业务数据。

**仍 NOT_RUN**：H-15/H-16/H-17（参考号须**本人真实微信**触发 `auth.bootstrap`）、H-18/H-19/M9、W1、U2/U4。

---

## 12. 追加（2026-10-18，经用户授权）：H-19 上传体验版（AI 侧准备完成，上传待人工）

**AI 侧已做（可验证部分）**：

| 步骤 | 结果 |
|---|---|
| cloud 生产产物构建 + 核验 | `corepack pnpm verify:client:cloud` **通过** —— `dist/`（**149** 个文件）为 cloud prod 产物，已内联 `cloud1-d4g36r8z6a8908540`，无演示数据/测试注入/服务端 SDK 泄漏 |
| 工程配置核对 | `project.config.json`：`appid=wxa8bf102dcfdcec4c`、`miniprogramRoot=dist/`、`cloudfunctionRoot=cloudfunctions/`（导入**项目根目录**即可） |
| 客户端云初始化核对 | `src/services/backend.ts#ensureCloudReady()` → `src/services/cloud/transport.ts#initCloud(CLOUD_ENV)` → `Taro.cloud.init({ env: cloud1-…, traceUser: true })`，`CLOUD_ENV = __RAK_CLOUD_ENV__`（构建期内联） |

**上传通道探测（本机只读）**：

- devtools CLI 存在：`C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat` ✅
- **服务端口 9420 未监听** ❌ → CLI 上传通道当前不可用（该端口需在工具「设置 → 安全设置」手工开启）
- **未**尝试 miniprogram-ci（需小程序「代码上传密钥」私钥，受"不索要/不打印密钥"硬约束，AI 不索取）

**因此 H-19 的上传步骤保留给人工**（需已登录的开发者工具）：导入项目根目录 → 上传（版本号+备注）→
公众平台设为体验版 → 加入第二个体验成员 → 扫码。步骤已写入 `docs/MANUAL-OPERATIONS.md` §E H-19。

**状态**：H-19 **行为层 NOT_RUN**（待人工上传 + 双账号进入）；H-18（第二账号/设备）同为人工项。

---

## 13. 追加（2026-10-18）：体验版卡在登录页的**根因与修复**（0 队死锁）

**现象**：用户上传体验版后，进入即停在登录页「正在安全登录…」无限转圈，且页面**没有任何可点内容**。

**取证（只读、可复现）**：

| 证据 | 结果 |
|---|---|
| `tcb db nosql dump rak_identities` | **1 条**记录（`appId` 正确、含 `openid`/`userId`）→ 客户端 `auth.bootstrap` **已成功** |
| 推论 | 云初始化 / `callFunction` / 函数运行时 / 写库**全链路通**；H-11 规则**未**阻挡客户端调用 |

**根因（客户端状态机 + 页面接线缺陷，不是网络/配置问题）**：

1. `src/store/index.ts#syncFromCloudSession`：只要不是"已识别 + 有 activeTeam"，一律 `status='LOADING'`
   （**含"已识别但 0 队"**）。
2. `src/pages/auth/login.tsx`：cloud 模式**只渲染 loading**（legacy 表单被 `isCloud` 排除）；且
   `decideGuard` 对账户页返回 `LOAD`（不自动离开）→ **永久 loading 且无任何可点入口**。
3. 附带：`cloudColdStartAutoEnter` 在 0 队时停在选择态，但**没有页面把用户带到选队页/账户页**。
4. 另发现：`cloudProvisioningReference`（H-15 取参考号）在 UI **无任何入口**（全仓仅 `src/services/cloud/auth.ts` 定义）
   → 形成"要参考号才能开队、而要开队所需的界面进不去"的鸡生蛋死锁。

**修复（逻辑改动；不动配色/字号/图标/布局）**：

| 文件 | 改动 |
|---|---|
| `src/utils/team-guard.ts` | 新增纯函数 `decideLoginLanding({isCloud, accountIdentified, hasActiveTeam, state})`：已识别 + **未进入任何本队（含 0 队）** 且非 `ENTERING`/`SWITCHING` → `TEAM_SELECT`；其余 `STAY` |
| `src/pages/auth/login.tsx` | 新增 `useEffect`：判定为 `TEAM_SELECT` 时 `Taro.reLaunch(ROUTES.teamSelect)`；未识别/切换中/已进入本队仍留在登录页（后者由既有 `AUTHED → 首页` 处理） |
| `tests/team-switch.test.ts` | 新增 6 条断言覆盖 `STAY` / `TEAM_SELECT` 各分支 |

**验证**：根 `tsc --noEmit --skipLibCheck` **0**；`pnpm test` **78/78**；`verify:release` 全绿
（含 `verify:client:cloud` 用修复后源码**重建 `dist/`**）。

**门禁盲区（记录）**：`verify:client:cloud` 的 taro 构建**不做类型检查** —— 首版漏写 import 时它**仍然"通过"**，
只有根 `tsc` 报错。前端改动的类型门禁必须依赖根 `tsc`。

**未验证（NOT_RUN）**：修复需**重新上传体验版**后在真机复验；另：**若先完成 H-16 开通 1 队**，则连**旧版**体验版也会
因"恰一队自动 enter"而离开登录页（`status → AUTHED`）—— 这是立即可用的旁路。

---

## 14. 追加（2026-10-18，经用户选择路径 A）：H-15/H-16 时序修正（进行中）

**发现的计划↔代码矛盾**：`provisioningReference` 在 `systemConfig/main` **已存在**时抛
`validation_failed('平台已初始化，无需参考号')`（`server/modules/auth/index.ts#L94-L95`），而 `provisionTeam`
**必须**消费一个未使用未过期的参考号（`server/modules/provisioning/index.ts#L85-L116`）。
因此正确时序是 **取号（未初始化）→ 初始化 → 30 分钟内开通**（测试夹具 `setupPlatform` 正是此序）；
而 MANUAL 把 H-14 排在 H-15 之前 —— **PLAN 与代码顺序冲突**，我照 PLAN 先做 H-14 导致该窗口被关闭。

**本轮为恢复所做（均经用户授权，选择路径 A）**：

| 步骤 | 动作 | 结果 |
|---|---|---|
| 代码 | `rakMaintenance` 新增 `provisionTeam` 受控分发（幂等、消费参考号；`appId/env` 与配置比对）；`MaintenanceRuntime` 增 `env` | server `tsc` 0、`test:server` **124**、`test` 78 |
| 代码 | `scripts/provision-cloud-team.mjs` 修正响应解析（`data.RetMsg` 外壳）+ 打印 `reason/code` | 产物校验通过 |
| 部署 | `fn deploy rakMaintenance --force --install-dependency true` | 部署成功 |
| 云写入 | 管理通道删除 `rak_system_config/main`（`db nosql execute` → `DELETE`；**可逆**） | 删前查到该文档；删后复查询为空 ✔ |
| 只读核验 | `db nosql execute` → `QUERY rak_identities` | **1 条**：`openid=oJVk****H_l4`、`userId` 存在、`hasRefHash=false`（从未签发过参考号） |

**管理通道用法更正（记录）**：`db nosql execute` 的 `--command` 必须是 **MgoCommands 数组**，
每条形如 `{TableName, CommandType, Command}` 且 `Command` 为**字符串化**的 Mongo 命令
（`QUERY/INSERT/UPDATE/DELETE/COMMAND`）——此前按裸 Mongo 命令传参失败。

**进行中（待人工）**：由 owner 本人经开发者工具 Console 调 `account.provisioningReference` 取号（平台已处于未初始化），
随后**我方**核对参考号绑定身份 → 重跑 `bootstrap-cloud-platform.mjs` 重建 `main` → 用参考号跑受控开通（H-16）。

### 14.1 执行结果（同日完成）

| 步骤 | 结果 |
|---|---|
| 用户取号 | `{"state":"ISSUED","code":"<已脱敏>","expiresAt":1792310888506}`（参考号未在本日志落明文） |
| 重建初始化 | `bootstrap-cloud-platform.mjs` → `平台已初始化（already=false）` |
| 受控开通 | `provision-cloud-team.mjs --key k1 --club-name 测试队A --slug team-a --display-code A7K2` → `clubId=club73e85e9d0e73e14f4b3f`（`replayed=false`） |
| 幂等复跑 | 同键再跑 → 同一 `clubId`，`replayed=true`，未建第二队 |
| 独立只读核验 | club `ACTIVE`/owner 存在；成员 **1**（`super_admin`/`ACTIVE`/即 owner）；`ownerBoundToIdentityUser=true`；参考号 `usedAt` 已置位；`system_config/main` 已重建（`appId` 正确）；`rak_provisioning_operations` 1 条含 `inputHash` |
| 身份核对 | owner = 手机体验版那条身份 `oJVk****H_l4`（**未**绑到开发者工具可能出现的新身份） |

**参数说明**：队名/`slug`/`displayCode` 采用测试值（`测试队A` / `team-a` / `A7K2`），owner 展示名为空；
队名可在 App 内「团队设置」修改，owner 姓名可在「编辑本队资料」填写。

**遗留（如实记录，待用户定）**：`if (config) throw` 这条守卫使"每开一队都要删除+取号+重初始化"；
且 `account.provisioningReference` **无 App 内入口**（第 2 位 owner 没有开发者工具）→ H-17 需要"放宽守卫 + 补 App 内取号入口"的后续修复。

---

## 15. 追加（2026-10-18）：真机基础可用 **PASS**（H-19 部分）

**证据（用户真机 · 真实微信 · 体验版 · 旧构建）**：冷启动后**越过登录页直接进入首页**。

**由此可在真实云证据层判定**：

| 结论 | 依据 |
|---|---|
| 真实微信身份 → 云函数 → SDK 数据库**写** | `auth.bootstrap` 已写入 `rak_identities`（此前只读核验 1 条） |
| 真实微信身份 → 云函数 → SDK 数据库**读** | `team.listMine` 读回 1 队；`team.enter` 读回 club/member |
| "恰一队 → 自动 enter" 客户端逻辑 | 冷启动自动进入首页（无手动点选） |
| 0 队死锁根因判断 | 开通 1 队后**旧版**（未含修复）立即恢复正常 → 反证根因是 0 队落点而非网络/权限 |
| H-11 安全规则未误伤客户端 | 客户端 `callFunction` 成功（`auth.bootstrap`/`team.listMine`/`team.enter` 均正常） |
| 真机**业务写**（成员资料） | 日志 2 条 `member.updateMyProfile` 成功；DB 复核 `rak_members`：`displayName=CYL`、`duty=11`、`revision=4`、`mutationSeq=4`（写栅栏按次递增） |

**仍 NOT_RUN**：`file.*` 真实字节、跨队拒绝（MT11）、双账号（MT01/MT02）、双设备、worker 来源、0 队/多队落点（需重新上传修复版后复验）。

---

## 16. 追加（2026-10-18，经用户授权）：开通 CloudBase 日志服务并验证采集

| 步骤 | 结果 |
|---|---|
| 开通 | `tcb logs search` 交互项选 **Yes** → `日志服务开通成功！`（CLI 提示：开通不额外计费，按套餐提供保存时长） |
| 验证 | 主动 `fn invoke rakApi`（`auth.me`，`requestId=logcheck-2`）→ 日志可检索到：`{"requestId":"logcheck-2","action":"auth.me","scope":"GLOBAL","code":"identity_required","durationMs":1}`（含 `status 200` 与 `START/END`） |
| 说明 | 开通前的历史日志**不会回填**；此后每次调用均可按 `function_name` / `request_id` / `status_code` 检索 |

**用途**：真机流程排障可直接读服务端事件日志（只含 `requestId/action/scope/clubId/code/durationMs`，不含 openid/URL/密钥）。

---

## 17. 追加（2026-10-18）：真机「切换团队」报 `navigateTo:fail timeout` —— 根因与修复

**现象**：真机点「我的 → 切换团队」出现两次 `MiniProgramError {"errMsg":"navigateTo:fail timeout"}`。

**服务端日志（同期）**：`profile.summary` / `team.listMine` / `team.enter` / `task.list` / `announcement.list` /
`member.list` / `performance.list` / `roi.overview` / `club.dashboard` 均**成功**（无 `code` 字段）→ **不是业务/权限/网络错误**。

**根因（客户端路由竞争）**：入口页 `Taro.navigateTo(ROUTES.teamSelect)` 打开选队页；选队页 `PageShell` 的
`decideGuard` 命中 `isTeamSelectionPage && hasActiveTeam` → 立即 `Taro.reLaunch(ROUTES.profile)`。
两个跳转同时在途 → `navigateTo` 超时；且该重定向本身**违背用户意图**（用户正是来切换/加入团队的）。

**修复（逻辑改动，不动视觉）**：`src/utils/team-guard.ts` 的选队页分支**移除**"已有团队 → 弹回 my"重定向，
仅保留"未识别 → login""加载中 → WAIT"；`tests/team-switch.test.ts` 断言同步更新为 `LOAD`。

**验证**：`pnpm test` 78/78、根 `tsc` 0、`verify:client:cloud` 通过（`dist/` 已重建）。
**待复验（NOT_RUN）**：需**重新上传体验版**后在真机确认；当前 1 队场景下该入口不影响使用。

---

## 18. 追加（2026-10-18）：H-20 单账号核心流程 **PASS**（真机 + 独立只读核验）

用户在真机体验版完成第 2–8 步（无异常）。我方**只读导出**（`db nosql dump`）逐项核对，`clubId` 全部为 `club73e85e9d0e73e14f4b3f`：

| 项 | 证据（原始字段） | 结论 |
|---|---|---|
| 任务 | `status=APPROVED`、`currentRound=1`、`revision=4`、`assigneeMemberId` 已置、`lastSubmissionId` 关联 | ✔ 创建→认领→交付→审核 状态机正确 |
| 交付 | `round=1`、`attachmentIds=[]`、`taskRevisionAtSubmit=2`、`status=APPROVED`、`reviewGrade=A` | ✔ 0 附件可交付；审核落分 |
| 公告 | 2 条 `status=PUBLISHED`（1 条 `pinned=true`），`revision=2`，作者为本人 | ✔ 草稿→发布；置顶生效 |
| ROI | 2 条：`costCents=100/revenueCents=100`、`costCents=100/revenueCents=22100`；`deletedAt=null`；`accountingDate=2026-10-18`（上海） | ✔ 金额转分正确、软删未发生、周期字段正确 |
| 租户归属 | 上述 4 集合所有文档 `clubId` 一致 | ✔ 数据不跨队 |

**旁证（日志）**：写操作 `member.updateMyProfile` 成功 2 次；读操作 `task.list/announcement.list/roi.overview/club.dashboard/performance.list/member.list` 均成功，无错误码。

**仍 NOT_RUN**：跨队拒绝（MT11）、双账号（MT01/MT02）、附件真实字节（U2/U4）、双设备/换机（H-21）、worker 来源（W1）。

---

## 19. 追加（2026-10-18，经用户选择 A）：H-17 前置修复（已部署，待真机复验）

| 问题 | 修复 |
|---|---|
| `provisioningReference` 在平台已初始化时**抛 `validation_failed`** → 每开一队都要删初始化文档、第 2 位 owner 无法取号 | 删除该守卫（`server/modules/auth/index.ts`）；保留"未消费复用 / 已消费默认不返回 / 显式 `replaceConsumed` 换发"语义；**参考号本身不授予权限**，仍只由运维受控开通消费 |
| 取号**无 App 内入口** | `src/pages/me/account.tsx` 新增「获取团队开通参考号」按钮（仅 cloud）：取号 → 自动复制 → 弹窗显示号码与有效期；已消费时询问是否换发；失败弹稳定文案。复用既有 `btn-secondary` 样式，**未改配色/字号/图标/布局** |
| 用例 | 新增 `m3-auth` 用例：**平台初始化后仍可签发**（ISSUED→REUSED→CONSUMED→REPLACED） |

**门禁**：server `tsc` 0、`test:server` **125**（+1）、根 `tsc` 0、`test` 78、`build:cloud`+`verify:cloud:artifacts`、`verify:release` 全绿。

**部署**：`fn deploy rakApi --force --install-dependency true` → 成功。

**待人工复验（NOT_RUN）**：重新上传体验版后，在 App 内「账户」取号 → 交运维开通第 2 队（H-17）。

---

## 20. 追加（2026-10-18）：H-17 第 2 队开通 **PASS**（真实云 + 只读核验）

| 项 | 结果 |
|---|---|
| 取号 | 用户经调试控制台取得参考号（`state=ISSUED`；明文未落文档/日志） |
| 开通 | `provision-cloud-team.mjs --key k2 --club-name 测试队B --slug team-b --display-code B8M3` → `clubId=clubab170d91d08623ee695e`（`replayed=false`） |
| 队 B 记录 | `name=测试队B`、`slug=team-b`、`displayCode=B8M3`、`status=ACTIVE`、`revision=1`、owner 已置 |
| 成员 B | `_id` = club.ownerMemberId；`role=super_admin`、`status=ACTIVE`；参照号已消费 |
| **同人跨队** | A/B 两队 owner 的 `userId` 尾部一致（`…dfef53`）→ 同一微信在两个团队各有一个独立 member 文档 ✔ |
| 幂等 | （队 A 已验证）同键重放返回同 `clubId`；本次为不同键建新队，符合预期 |

**门禁旁证**：新增 `m3-auth` 用例（初始化后仍可签发）；`test:server` 125、`test` 78、根 `tsc` 0、`verify:release` 通过。

**待真机复验（NOT_RUN）**：客户端「切换团队」在含 2 队的真实列表下的落点与切换；A/B 业务数据互不可见（MT11 跨队拒绝）。

---

## 21. 追加（2026-10-18）：多队切换与数据隔离 **PASS**（真机/模拟器 + 只读核验）

**用户侧**：编译新构建后，「我的 → 切换团队」可见 **2 队**（`测试队A · A7K2`、`测试队B · B8M3`），进入/切回均正常，无报错。

**数据侧（只读 dump，按 `clubId` 分组计数）**：

| 集合 | 队 A（`club73e85e…`） | 队 B（`clubab170d…`） |
|---|---|---|
| `rak_tasks` | 1 | 0 |
| `rak_task_submissions` | 1 | 0 |
| `rak_announcements` | 2 | 0 |
| `rak_roi_items` | 2 | 0 |

→ 切队后**没有跨队写入**；队 B 干净；队 A 数据完整保留。

**结论**：多队列表、切换、按 `clubId` 的数据隔离（真实云端）**PASS**。

**仍 NOT_RUN**：跨队**拒绝**（用真实低权身份对异队资源直调 `task.get`/`member.list` 等 → 须第二微信，MT11）；附件真实字节（U2/U4，下载能力仍受控未上线）；双设备/换机（H-21）；worker 来源（W1）。

---

## 22. 追加（2026-10-18）：双账号受阻 → 补「手动输入邀请码」入口

**现象**：第二微信 Y 进入后，切队页只有「加入其他团队」；进入「加入团队」页显示「缺少入队凭证」，**没有可输入邀请码的地方**。

**根因**：`team-join` 页只接受**链接参数** `?code=`（以及 `?key=`），DESIGN §7.2 要求的"**输入 12 位码**"未接线；
旧 `login` 页的表单在 cloud 模式被显式排除 → cloud 模式下无任何手动入队入口。

**修复**（`src/pages/me/team-join.tsx`）：无 `code`/`key` 时渲染「输入邀请码加入」卡片
（12 位输入，自动大写并去非法字符 + 展示名 + 加入按钮），复用既有 `team-join__input` / `btn-secondary` 样式；
`redeem()` 改用 `effectiveCode`（链接参数优先、失败提示 12 位）。**未改配色/字号/图标/布局**。

**验证**：根 `tsc` 0、`test` 78/78、`verify:client:cloud` 通过（`dist/pages/me/team-join.js` 已含该入口）。

**待复验（NOT_RUN）**：重新上传后由 Y 手动输入邀请码入队。

---

## 23. 追加（2026-10-18）：手机端「扫码后无法登录」排查结论（**非登录故障**）

**现象**：某台手机扫码进入体验版后停在「切换团队 · 还没有可用团队」。

**只读取证（`rak_*` 全量统计）**：

| 身份 | openid（掩码） | userId 尾号 | 安全状态 | 成员关系 |
|---|---|---|---|---|
| 初始管理员（X） | `oJVk****H_l4` | `…dfef53` | NORMAL | **2 个**：队 A（super_admin）、队 B（super_admin） |
| 第二微信（Y） | `oJVk****O-tI` | `…ee8cfd` | NORMAL | **0 个** |

**结论**：
1. 截图账号**不是**初始管理员，而是第二个微信（`…O-tI`）。
2. **登录本身成功**：`rak_identities` 中存在该身份（`auth.bootstrap` 已写库）、`rak_users` 为 NORMAL；
   0 队 → 客户端按新构建正确落到「还没有可用团队」，**不是鉴权失败**。
3. 初始管理员 X 无登录问题：其身份为 A/B owner，且此前的写操作（`displayName=CYL`、任务/公告/ROI）均落库。
4. 体验版访问权限：Y 能打开并渲染小程序，说明其在体验成员名单内、体验版有效（**微信平台侧配置无异常**）。
5. 服务端配置复核：函数安全规则读回 `{"*":{"invoke":"auth != null"},"rakMaintenance":{"invoke":false}}`；
   函数环境变量 4 项在位；`system_config/main` 存在；数据库 ACL=ADMINONLY（只影响客户端直连，不影响函数）。

**处理**：让 Y 入队即可（邀请码手动输入 / 申请链接 + 审批）。邀请码手动输入需含最新构建（`dist/` 已就绪）。

---

## 24. 追加（2026-10-18）：体验版三个启动异常 —— 根因与修复

> 证据层说明：以下根因来自**代码路径 + 小程序生命周期语义**的确定性分析（并发时序处已用纯函数用例固化）；
> 真机行为复验属 **NOT_RUN**，须重新上传体验版后按 §24.4 逐场景验证，不得据本段判定真机已通过。

### 24.1 三个现象 → 根因

| # | 现象 | 根因（代码级） |
|---|---|---|
| 1 | 首次扫码进入，**选队页不显示两个团队**；杀进程再扫码才正常 | ① 团队列表状态（`teams/error/cursor/hasMore`）存放在 `cloud-team.ts` 的**模块级普通变量**，`authStore.myTeams` getter 直读它 → **不是 MobX 可观察**，列表晚到不会触发重渲染；② 选队页只在 `useDidShow` 拉一次，且 `if (!cloudAccountIdentified) return` —— 首次身份创建较慢，这一次 onShow 早于 bootstrap 完成即**永不重试** |
| 2 | 退出登录后（进程驻留）再次打开，**永久卡 loading** | `App.useLaunch` **只在进程冷启动**触发。`logout()` → `clear()` 已 `invalidate` 账户层并把 `status` 置 `LOADING`、`teamState` 置 `ACCOUNT_LOADING`，但热启动（App.onShow）**没有任何代码再次发起 bootstrap** → 无身份、无团队、无入口 |
| 3 | 从微信下拉**常规入口**冷启动，**永久卡在选队页且无选项** | 与 #1 同源：冷启动首个页面可能是 `team-select`（或守卫重定向到它）；该次 `useDidShow` 若发生在 bootstrap 完成前即被跳过，之后列表状态又不是可观察值 → UI 既不重试也不重渲染 |

**共同点**：三个现象都不是鉴权/数据问题（§23 已证实身份与成员关系正确），而是**初始化状态机在"热启动/非首屏时序"下缺恢复路径**。

### 24.2 修复（4 处，最小侵入；未改配色/字号/图标/布局）

| 文件 | 改动 |
|---|---|
| `src/utils/startup-policy.ts`（新增） | 纯函数 `shouldBootstrap()`：cloud 已识别且已离开 `ACCOUNT_LOADING` → 不重跑；`ERROR` → 不自动重试（防热启动死循环）；legacy 仅 `LOADING` 引导。`shouldLoadTeamList()`：未识别不发请求 + 单飞 |
| `src/store/app-boot.ts`（新增） | `ensureAppBooted()`：**单飞**引导，已就绪立即返回、引导中复用同一 Promise、异常不冒泡（状态由 bootstrap 写入 ERROR） |
| `src/app.ts` | `useLaunch` + **`useDidShow`** 都调 `ensureAppBooted()` → 覆盖"冷启动 / 后台驻留再打开 / reLaunch 后"全部场景；深链消费仍在 bootstrap 之后 |
| `src/store/index.ts` | ① 新增 4 个**可观察**字段 `cloudTeams/cloudTeamsHasMore/cloudTeamsCursor/cloudTeamsError`，getter 改读它们，`syncFromCloudSession()` 一次安装；② `clear()` 一并清空（防退出后残留上一账户选项）；③ `bootstrapCloud()` 整体 try/catch → 云初始化异常进入可重试 `ERROR` 而非未处理拒绝 |
| `src/pages/me/team-select.tsx` | ① 新增"识别完成后补拉一次"的 `useEffect`（`identifiedLoadDone` 一次性）；② `refresh` **单飞**；③ 未识别时显示"正在识别身份"，不再误显示"还没有可用团队" |
| `src/pages/auth/login.tsx` | cloud 且未识别时，loading 区提供显式"**重新进入**"按钮（退出登录后不会停在无操作页面；热启动由 App.useDidShow 自动恢复） |

**状态重置机制**：`clear()`（登出/换微信）→ `cloudResetSessions()` 清账户+团队+列表+入队申请，`resetDeepLinkEntry()` 清深链去重；observable 镜像同步清空。**不会**把 A 的团队列表/选队建议带入下一次会话（`last_club` 缓存在 `cloudForgetSelectedClubId()` 中删除）。

### 24.3 本机验证（已执行，PASS）

```text
corepack pnpm exec tsc --noEmit --pretty false --skipLibCheck   → 0 error
corepack pnpm test                                              → 83 pass / 0 fail（原 78 + 新增 5）
corepack pnpm verify:release                                    → 全部通过
  · verify:cloud:config / verify:no-client-db / verify:cloud:artifacts / verify:routes(31) / verify:client:cloud
  · verify:client:cloud 已按 cloud prod 重新构建 dist/（本次修复已进入产物）
```

新增用例 `tests/startup-policy.test.ts`（5 组）：冷启动/退出后必须引导、已就绪（TEAM_SELECTION/READY/ENTERING/SWITCHING）不得重跑、ERROR 不自动重试、legacy 仅 LOADING、列表加载的"未识别不发/在途单飞/仅 cloud"。

### 24.4 真机验证步骤（须重新上传体验版后执行，当前 NOT_RUN）

| 场景 | 操作 | 期望 |
|---|---|---|
| A 扫码首次进入 | 杀进程 → 扫体验版二维码 → 首次登录 | 选队页**直接**显示两个团队（不再需要杀进程重进）；若仍在识别则显示"正在识别身份" |
| B 后台驻留重启 | 已进入团队 → 切后台 → 从多任务返回 | 恢复原团队首页；**不**回到 loading，**不**重复弹选队 |
| C 常规入口冷启动 | 杀进程 → 微信下拉"最近使用"点图标（不带扫码参数） | 正常识别 → 选队页显示两团队（多队时停在选队页，不再永久空态） |
| D 退出登录后重启 | 我的 → 退出登录 → 切后台 → 再打开 | 自动恢复（识别身份 → 选队页）；若停在登录页则可见"重新进入"按钮且可点 |
| E 退出登录后不回后台 | 退出登录 → 停在登录页 | 不出现"永久转圈无操作"：可见"重新进入" |
| F 弱网/失败 | 飞行模式冷启动 → 恢复网络 | 登录页显示错误 + 重试；点重试可恢复；**不进**演示身份 |
| G 单队自动进入 | 仅 1 队且无分页 | 自动进入该队首页（行为不变） |
| H 0 队 | 新微信未入队 | 选队页显示"还没有可用团队" + "加入其他团队"（行为不变） |

> 说明：C 场景若微信把启动页恢复为 `team-select`，会短暂经登录页兜底再回到选队页；这是既有守卫语义（未识别 → login），最终落点正确。

---

## 25. 追加（2026-10-18）：小程序内「开通新团队」（替代参考号入口）

### 25.1 需求与用户裁决

原流程依赖「本人参考号 + 平台运维受控开通」，必须跳出小程序。本次改为**小程序内闭环**。
四项关键决策（经用户确认）：

| 决策 | 结果 |
|---|---|
| 审批人 | **发起人所属团队**的 manager / super_admin（TEAM scope；A 队管理员看不到 B 队申请） |
| 新队 owner | **发起人**（审批通过后成为新队 `super_admin`） |
| 状态通知 | **站内**：本人申请列表 + 本队待审列表 + 管理台角标（刷新即最新；不引入订阅消息权限） |
| 参考号链路 | **保留服务端兜底，移除 UI**（`account.provisioningReference` / `provisionTeam` 不删除，普通用户不再看到） |

### 25.2 服务端

| 文件 | 内容 |
|---|---|
| `server/repositories/collections.ts` | 新增 `rak_club_applications` |
| `server/contracts/actions.ts` | 注册 `team.newApplication.submit/list/approve/reject`（TEAM）与 `mine`（GLOBAL）+ 严格 data schema |
| `server/contracts/dtos.ts` | `NewTeamApplicationView`（**不含** applicantUserId/openid）、分页与结果 DTO |
| `server/modules/clubApplications/index.ts`（新增） | 提交（确定性 ID = `hash(审批队,申请人,slug)`；PENDING 幂等/异内容冲突；REJECTED 可复用记录重提，revision+1）、本队列表（manager+、cursor 绑定 clubId+status）、本人列表（GLOBAL、只含本人）、审批通过（幂等 + revision 栅栏 + 申请人 BLOCKED 拒绝 + 建 club/owner member + 双栅栏 + 审计）、驳回（理由必填） |
| `server/modules/api-handlers.ts` | `applicationDeps`（注入 `randomClubId`）+ 5 个 handler |
| `infra/cloudbase/{collections,database-rules,indexes}.json` | 新集合（客户端读写拒绝）+ 4 条索引（含 `rak_clubs.slug` / `displayCode` 唯一，作为并发最终防线） |

**权限与隔离**：所有申请读写以 TEAM scope 的 `clubId` 为准；`resolveTenant` 在每个事务内重读身份/成员/队状态；
审批人 `requireManagerPlus`；异队申请统一 `resource_not_found`（不泄露存在性）。

### 25.3 客户端

| 文件 | 内容 |
|---|---|
| `src/services/cloud/club-application.ts`（新增） | 5 个 action 的调用封装（TEAM/GLOBAL scope、`expectedRevision`、`mutationId`） |
| `src/utils/new-team-form.ts`（新增） | 与服务端同规则的表单校验（名称 2..40、slug 3..32、展示码 4..8、简介 ≤200、多行只允许 LF） |
| `src/pages/me/new-team.tsx`（新增） | 填写并提交申请；下方常显「我的申请」（状态/驳回理由/通过后提示去切换团队） |
| `src/pages/me/new-team-applications.tsx`（新增） | 本队 manager+ 审批页：通过并建队 / 驳回（理由必填）；`expectedRevision` 防并发 |
| `src/pages/me/account.tsx` | **替换**原「获取团队开通参考号」为「开通新团队」 |
| `src/subpackage-admin/pages/admin/home.tsx` | 新增「开队审批」入口 + 待审计数（未知显示为未知，不伪造 0） |
| `src/constants/index.ts` / `src/app.config.ts` | 新增两个路由并注册 |

### 25.4 验证（本机，PASS）

```text
tsc -p server/tsconfig.json --noEmit                  → 0 error
corepack pnpm exec tsc --noEmit --skipLibCheck        → 0 error
corepack pnpm test:server                             → 136 pass / 0 fail（原 123 + 新增 13）
corepack pnpm test                                    → 89 pass / 0 fail（原 83 + 新增 6）
corepack pnpm verify:release                          → 全部通过（verify:routes 33 路由）
```

新增用例：
- `server/tests/m9-club-applications.test.ts`（13）：发起权限、幂等/冲突、标识占用与非法输入、审批权限、建队与 owner 角色、重复审批 reject、mutationId 幂等回放、**A/B 队隔离**、DTO 不泄露全局身份、驳回/重提、revision 栅栏、BLOCKED 账号、列表权限。
- `tests/new-team-form.test.ts`（6）：规范化、可选简介与 CRLF、名称/slug/展示码边界、字符集、简介长度。

### 25.5 云侧部署（**已完成**，2026-10-18，经用户授权）

| 步骤 | 动作 | 结果 |
|---|---|---|
| 1 | 创建集合 `rak_club_applications` | 一次性探针函数（`createCollection`）→ `{"ok":true,"created":true}`；探针函数**已删除**（`fn delete` 成功） |
| 2 | 创建 4 条索引 | `db nosql execute`（`CommandType=COMMAND` + `createIndexes`）→ `listIndexes` 读回：`club_applications_by_club_status`、`club_applications_by_applicant`、`clubs_slug_unique`、`clubs_display_code_unique`；`unique:true` **2 条** |
| 3 | 集合 ACL | `TCB.ModifyDatabaseACL` → `ADMINONLY`；`DescribeDatabaseACL` 读回 `AclTag=ADMINONLY` |
| 4 | 重新部署 `rakApi` | `build:cloud` + `fn deploy rakApi --force --install-dependency true` → 部署成功 |
| 5 | 冒烟 | `team.newApplication.submit`（合法信封）→ **`identity_required`**（非 `not_implemented`）→ 证明新动作已注册、运行时正常、身份守门在业务前生效 |

**部署前只读预检**：`rak_clubs` 2 条记录，`slug`（team-a/team-b）与 `displayCode`（A7K2/B8M3）**无重复** → 唯一索引创建安全。

**通道备注（供后续复用）**：
- `TCB.CreateCollection` 已下线；`db nosql execute` 的 `RunCommands` **不接受**裸 `create`/`createIndexes`/`listCollections`。
  正确形态是 `[{ "TableName": "...", "CommandType": "COMMAND", "Command": "<JSON 字符串>" }]`；
  建集合用一次性探针函数（`cloud.database().createCollection`）。
- 索引命令走 `CommandType=COMMAND` + `Command` 内嵌 `createIndexes`/`listIndexes` 字符串。

### 25.6 仍属 NOT_RUN（需真机/真实微信）

1. 成员在 App 内提交开队申请 → 管理员审批通过 → 新队出现在「切换团队」且发起人为 `super_admin` 的**完整闭环**
   —— **已在真实云端 PASS（单账号）**：`rak_club_applications` 1 条（APPROVED, rev=2, `newClubId=clubad3462…`），
   `rak_clubs` 新队 `ACTIVE` 且 `ownerMemberId` 与该队 `super_admin` 成员一致；3 条成员均为同一 `userId`（`e345b75c…`）。
2. **不同微信的双人审批** —— **NOT_RUN（用户裁决不做）**：2026-10-18 用户确认**允许自批**（保留现状，审计已记录），
   并决定暂不推进"第二微信发起 + 第一微信审批"的真实双人验证；该项非遗漏，按用户决定记录为 NOT_RUN。
3. 审批状态的"实时"仅为**站内刷新**（进入页面/下拉），未接订阅消息（用户已选择此方案）。

---

## 26. 追加（2026-10-18）：邀请码生成 `internal_error` 故障排查与修复

### 26.1 现象与复现证据

管理台「邀请码 → 生成新邀请码」持续失败，Toast：**"服务开小差了，请稍后重试"**（`internal_error` 的固定文案）。

云端真实日志（CLS `logs search`，只读）：

```text
21:05:26  rakApi  {"action":"invite.create","scope":"TEAM","clubId":"clubad34…","code":"internal_error","durationMs":339}
21:07:46  rakApi  {"action":"invite.create","scope":"TEAM","clubId":"club73e8…","code":"internal_error","durationMs":287}
21:07:50  rakApi  {"action":"invite.create","scope":"TEAM","clubId":"club73e8…","code":"internal_error","durationMs":361}
```

请求已到达函数并执行（~300ms），排除网络/权限/参数问题；`internal_error` 表示抛了**非 AppError** 的异常。

### 26.2 根因

`rak_invites.sceneTokenHash` 有 **`unique + sparse`** 索引（`listIndexes` 读回 `unique:true` + `sparse:true`）。

**MongoDB 的 sparse 只排除"字段不存在"，`null` 仍会被唯一索引收录。**
旧实现 `invite.create` 固定写入 `sceneTokenHash: null`：

| 次数 | 结果 |
|---|---|
| 第 1 条（存量 `VWUW••••MZ9A`，`sceneTokenHash=null`） | 成功，占用唯一索引的 null 槽 |
| 第 2 条起 | 再写 null → `E11000 duplicate key` → 未捕获 → `internal_error` |

这解释了"此前可正常运行"：**只有第一条成功**，之后必然全部失败；与近期代码/依赖变更无关。

### 26.3 修复

| 文件 | 改动 |
|---|---|
| `server/modules/invites/index.ts` | 删除 `sceneTokenHash: null`，未启用小程序码时**省略该字段**（sparse 不索引缺失字段）；就地注释说明 |
| `infra/cloudbase/indexes.json` | 索引说明补充"sparse 不排除 null，禁止写 null" |
| `server/tests/m9-invite-create.test.ts`（新增） | 连续生成两条均成功；断言文档**不含** `sceneTokenHash` 键；同 mutationId 重放不重复建码 |
| `server/tests/m9-club-applications.test.ts` | 修正一处多余 `env` 字段（类型检查） |

存量那条 null **无需清理**：新记录不参与该索引，不会再冲突。

### 26.4 验证

```text
server tsc → 0 error
test:server → 138 pass / 0 fail（+2）
test        → 89 pass / 0 fail
build:cloud + verify:cloud:artifacts → 通过
fn deploy rakApi --force --install-dependency true → 部署成功
冒烟 fn invoke invite.create → identity_required（非 internal_error / not_implemented）
```

**待真机复验（NOT_RUN）**：在 App 内连续生成 2–3 个邀请码；预期全部成功，且新记录不含 `sceneTokenHash` 字段。

### 26.5 预防措施

1. **契约**：`unique + sparse` 字段未启用时**必须省略**，禁止写 `null`；索引声明处已就地标注。
2. **回归测试**：`m9-invite-create.test.ts` 守住"连续生成 + 不得写 null"。
3. **上线检查清单**：新增/修改唯一索引时，必须核对写入形状（缺失 vs null vs 唯一值）。
4. **监控**：日志服务已开通，建议对 `internal_error` 按 `action` 聚合告警。

---

## 27. 追加（2026-10-18）：解除"职务仅 owner 可自改"的限制

**需求（用户）**：本队资料页的「职务」应可修改，**无角色限制**。

**原实现（前后端各一处限制）**：
- 前端 `team-profile.tsx`：`canEditDuty = authStore.isSuper` → 非 owner 的输入框 `disabled`，提示"职务仅超级管理员可自改"；
- 服务端 `members/index.ts#updateMyProfile`：`if (input.duty !== undefined && !isOwner) throw permission_denied('仅 owner 本人可自改职务')`。

**修改**：

| 文件 | 改动 |
|---|---|
| `server/modules/members/index.ts` | 删除 `isOwner` 拦截；任何成员可改**自己的**职务（职务不参与授权）。改**他人**职务仍走 `member.updateProfile` 既有矩阵，未放宽 |
| `src/pages/me/team-profile.tsx` | 解除 `disabled`；提示改为"职务（可选）"；保存时始终提交 `duty`（空串 → null）；脏检查与未保存探针同步 |
| `server/tests/m3-members.test.ts` | 用例改为"普通成员可自改职务并落库"；owner 路径保留 |
| `docs/superpowers/specs/2026-10-17-rak-multi-team-isolation-design.md` §6.2 | 动作约束同步为"本人可改展示名与职务" |

**验证**：

```text
server tsc 0 / root tsc 0
test:server 138 pass / 0 fail
test 89 pass / 0 fail
verify:release 全通过（dist 已重建，含前端解除禁用）
build:cloud + verify:cloud:artifacts + fn deploy rakApi → 部署成功
管理侧冒烟 member.updateMyProfile → command_expired（说明动作已注册且到达业务校验）
```

> 冒烟说明：故意使用旧 UUIDv7，**未**执行写冒烟，避免管理侧调用可能携带身份而误改真实成员数据。
> 另记录一个观察：本次管理侧 `fn invoke` 到达了业务校验（而非 M0 时的 `identity_required`），
> 与早期结论不完全一致；因此**不再用合法 mutationId 做写冒烟**，真实写入验证一律交给真机。

**待真机复验（NOT_RUN）**：用**管理员（manager）**账号进入「本队资料」→ 修改职务 → 保存 → 重新进入确认已持久化；期望成功，且 A/B 队资料互不影响。

---

## 28. 追加（2026-10-18）：管理员/超管三项管理能力

### 28.1 需求与用户裁决

| 项 | 裁决 |
|---|---|
| 裁员对象 | **所有成员**都需双审批；结果为 `LEFT` |
| 双审批构成 | **两名不同的人各批一次**：一名 `manager` + 一名 `super_admin`；**发起人不能审批** |
| 解散范围 | 超管可解散**任意团队（含跨队）** |
| 超管任免 | **仅首位超管（`clubs.ownerMemberId`）** 可任命/罢免其他 `super_admin`；不可动 owner |

### 28.2 数据模型

- 新增集合：`rak_member_dismissals`（每队每目标一条，确定性 `_id`）、`rak_club_dissolutions`（每队一条）。
- `ClubStatus` 扩展 `DISSOLVED`：`resolveTenant` 拒绝进入、`team.listMine` 不再返回该队；
  **成员关系与业务数据保留**（历史可审计，解散是 O(1) 写，不因成员多超事务上限）。
- 新增索引 4 条（见 `infra/cloudbase/indexes.json`）。

### 28.3 服务端

| 模块 | 能力 |
|---|---|
| `modules/dismissals` | `requestDismissal`（manager+，禁止裁 owner/自己/已 LEFT）、`approveDismissal`（按角色填对应节点；两节点齐 → 同事务置 LEFT + 双栅栏 + 审计）、`rejectDismissal`（理由必填）、`listDismissals`（manager+，cursor 绑定 clubId+status） |
| `modules/dissolutions` | `dissolveByManager`（TEAM，manager+）、`requestDissolution`（TEAM，协助申请）、`listDissolutionRequests`（GLOBAL，任一 super_admin，跨队）、`decideDissolution`（GLOBAL，批准执行/驳回）、`dissolveAnyClub`（GLOBAL，跨队直接解散） |
| `modules/members#setRole` | 扩展 `targetRole='super_admin'`；改为按 **`clubs.ownerMemberId`** 判定首位超管（修复 `isOwner(role)` 把任意 super_admin 当 owner 的问题） |

**新增动作**（9 个）：`member.dismissal.request/list/approve/reject`、`club.dissolve`、`club.dissolution.request/list/decide`、`club.dissolveAny`。
全部写 `rak_audit_events`；审批/解散走 `runIdempotent` + `revision` 栅栏。

**已知边界（如实记录）**：
- 双人约束下，若团队只有 1 名 manager（或 1 名 super_admin）且发起人占其一，将无法凑齐两名审批人 → 需先补充对应角色成员。
- 跨队解散是**显式例外**：超管身份校验为"任一团队的 ACTIVE super_admin"，审计 `scope=GLOBAL`；
  这与"队内隔离"不冲突（不授予查看他队业务数据的权限，仅解散动作）。

### 28.4 客户端

| 文件 | 内容 |
|---|---|
| `services/cloud/admin-ops.ts`（新增） | 9 个动作封装（TEAM/GLOBAL、`expectedRevision`、`mutationId`） |
| `pages/admin/dismissals.tsx`（新增） | 发起裁员（选成员+理由）、双节点状态、批准/驳回；发起人不可批 |
| `pages/admin/dissolutions.tsx`（新增） | 跨队协助解散列表、批准/驳回、按团队 ID 直接解散（二次确认） |
| `pages/admin/club-settings.tsx` | 新增「危险操作」：直接解散本团队 / 申请超管协助解散 |
| `pages/super/roles.tsx` | 支持任命/罢免 `super_admin`（菜单按当前角色动态）；说明"仅首位超管可任免" |
| `pages/admin/home.tsx` | 新增「裁员管理」「团队解散」入口 |
| `store` / `services/cloud/member.ts` / `dto.ts` | 任免类型扩展 `super_admin`；`ClubStatus` 加 `DISSOLVED` |

### 28.5 验证（本机，PASS）

```text
server tsc 0 / root tsc 0
test:server 147 pass / 0 fail（+9：m10-admin-ops）
test 89 pass / 0 fail
verify:release 全通过（verify:routes 35 路由）
```

`m10-admin-ops.test.ts` 覆盖：
- 裁员：双人双角色齐备才 LEFT、发起人不能批、普通成员不能发起、不能裁 owner/自己、同节点重复审批拒绝、驳回/重提、列表权限与 DTO 不泄露全局身份；
- 解散：本队 manager 直接解散、解散后不可进入且列表过滤、协助申请由**跨队**超管批准、普通成员不能处理、超管跨队直接解散、非超管被拒；
- 超管任免：仅 owner 可任命/罢免 super_admin、普通超管不可任免、不可动 owner、目标必须在本队、审计留痕。

### 28.6 云侧部署（**已完成**，2026-10-18，经用户授权）

| 步骤 | 动作 | 结果 |
|---|---|---|
| 1 | 创建集合 `rak_member_dismissals`、`rak_club_dissolutions` | 一次性探针 → `{"ok":true,"results":[{created:true},{created:true}]}`；探针函数**已删除** |
| 2 | 创建 4 条索引 | `listIndexes` 读回：`dismissals_by_club_status`、`dismissals_by_target`、`dissolutions_by_status`、`dissolutions_by_club` ✔ |
| 3 | 集合 ACL | 两集合 `DescribeDatabaseACL` 读回 **ADMINONLY** ✔ |
| 4 | 重新部署 `rakApi` | 部署成功 |
| 5 | 冒烟 | `member.dismissal.list` → **`identity_required`**（非 `not_implemented`）→ 新动作已上线 |

**仍属 NOT_RUN（需真机）**：
1. 裁员双人双角色完整闭环（发起 → manager 批 → super_admin 批 → 目标离队）。
2. 管理员直接解散 / 协助申请由跨队超管批准 / 超管直接解散任意队。
3. 首位超管任命与罢免其他超管（含普通超管被拒的负向用例）。

**前端生效条件**：`dist/` 已重建（35 路由），需**重新上传体验版**。

---

## 29. 追加（2026-10-18）：裁员审批规则修正（首位超管自批 / 其他人两级）

### 29.1 新规则（用户第二次裁决，覆盖 §28 的双角色方案）

| 情形 | 审批路径 |
|---|---|
| **首位超管**（`clubs.ownerMemberId`）发起的申请 | 本人**第一阶段确认即完成**并立即执行（单节点，唯一允许"同一人完成全部"的例外） |
| **普通管理员**（manager）发起的申请 | ① 申请人本人完成第一阶段；② 另一位 **super_admin** 终审；两阶段齐才执行 |
| **非首位 super_admin** 发起的申请 | ① 本人第一阶段；② **另一位** super_admin 终审（申请人与终审人必须不同） |
| 禁止 | 同一人完成全部审批（首位超管除外）；非申请人做第一阶段；manager 做终审；申请人做终审 |

### 29.2 实现变更

| 层 | 变更 |
|---|---|
| 数据字段 | 以 `requesterIsPrimaryOwner`、`firstApprovedByMemberId/At`、`finalApprovedByMemberId/At` 取代旧的 `managerApproved*` / `superAdminApproved*` |
| 服务端 | `approveDismissal` 重写为两阶段状态机：FIRST（仅申请人本人）→ FINAL（另一位 super_admin）→ DONE；首位超管在 FIRST 即完成并置 LEFT |
| 视图 | 新增 `currentStage`（FIRST/FINAL/DONE）与 `requesterIsPrimaryOwner`，供前端自动流转 |
| 审计 | 审批审计的 `reason` 记录阶段与结果：`stage1:self` / `stage1:primary-owner` / `stage2:final`；身份与时间由 `actorMemberId`/`now` 记录 |
| 前端 | 裁员页按 `currentStage` 显示"第一阶段确认"/"最终审批通过"；非当前节点负责人按钮禁用并给出原因 |

### 29.3 验证（本机，PASS）

```text
server tsc 0 / root tsc 0
test:server 149 pass / 0 fail（裁员用例 6 个）
test 89 pass / 0 fail
verify:release 全通过（35 路由）
```

`m10-admin-ops.test.ts` 新增/覆盖：
- **首位超管自审批**：一次确认即 APPROVED + LEFT，`finalApprovedByMemberId=null`，审计 `stage1:primary-owner`；
- **普通管理员两级**：非申请人第一阶段被拒 → 本人第一阶段（PENDING）→ manager 终审被拒 → 首位超管终审执行；
- **非首位超管两级**：本人第一阶段 → 本人终审被拒 → 另一位超管终审执行；
- 阶段身份校验：普通成员不能发起、不能裁 owner/自己、申请人不能跨阶段自批。

### 29.4 云侧/前端生效

- **`rakApi` 已重新部署（2026-10-18，经用户授权）**：部署成功；冒烟 `member.dismissal.list` 返回 `identity_required`（非 `not_implemented`）。
- 前端需重新上传体验版（`dist/` 已重建，35 路由）。
- 真机闭环仍为 **NOT_RUN**（需按 §29.1 的三种情形逐项验证）。

## 30. 追加（2026-10-18）：任务附件上传打通（上传 + 提交绑定）

### 30.1 真源与范围

- 设计：`docs/superpowers/specs/2026-10-18-task-attachment-upload-design.md`（用户批准，含 D1/D2/D3）。
- 计划：`docs/superpowers/plans/2026-10-18-task-attachment-upload.md`（Task 1–8）。
- 范围：云模式下「选择即上传」+ `task.submit` 事务内绑定；**不包含**下载/预览（`file.downloadUrls`/`previewDraft` 仍 `not_implemented`）。

### 30.2 变更文件

| 层 | 文件 | 变更 |
|---|---|---|
| 服务端 | `server/modules/files/index.ts` | D1：`CONFIRMED` 且附件为 `DRAFT`、未绑定提交时允许 `file.cancel`；D2：`file.init` 回收过期/作废槽位（过期草稿分片标 `GC_PENDING`、过期未交付附件标 `GC_PENDING`、槽位置空） |
| 服务端 | `server/modules/tasks/index.ts` | `task.submit` 附件校验（归属/上传者/VERIFIED/DRAFT/期限/会话/轮次/槽位）→ `ATTACHED` + `submissionId`；未选槽位取消并 `GC_PENDING`；批次 `CLOSED`；task revision 只 +1 |
| 服务端测试 | `server/tests/m4-task-attachments.test.ts`（新建） | 11 用例：0 附件回归、绑定、部分选中、拒绝矩阵、幂等、非负责人 |
| 服务端测试 | `server/tests/m4-tasks.test.ts` | 删除「附件 = not_implemented」旧用例 |
| 服务端测试 | `server/tests/m5-files-chunks.test.ts` | D1 三态取消用例；D2 槽位回收用例 |
| 前端 | `src/utils/attachment-upload.ts` | 返回 `UploadedAttachment`（含 `sessionId`）；新增 `collectAttachmentIds`（唯一提交出口） |
| 前端 | `src/services/cloud/attachment.ts` | `uploadTaskAttachmentFromPath` 返回 `UploadedAttachment` |
| 前端 | `src/pages/task/detail.tsx` | 能力三态、选择即上传、逐片进度、移除即取消、`useUnload` 取消、提交前阻断 |
| 前端 | `src/store/index.ts` | `submit` 接收 `cloudAttachmentIds`，校验数量一致后透传 |
| 前端 | `src/types/domain.ts` / `src/services/cloud/legacy-view.ts` | `Task.revision` 可选字段与云端透出 |
| 门禁 | `scripts/verify-client-cloud.mjs` | 从 FORBIDDEN 移除 `rakFiles`（客户端受控上传函数，DESIGN §11）；保留 `rakMaintenance`/服务端模块/SDK 检查 |

### 30.3 关键实现口径

- 附件先全量校验再写入：任一失败整个事务回滚，不出现"绑了一半"。
- 选中：`DRAFT → ATTACHED`，`submissionId` 指向本次提交；session 保持 `CONFIRMED`。
- 未选中：session `CANCELLED`（`fence+1`），附件 `DRAFT → GC_PENDING`；不物理删除对象。
- 批次：只递增自身 revision，`CLOSED` 后本轮不可再 init。
- 前端云模式**不使用 `Taro.saveFile`**：微信本地存储配额约 10MB，单个 10MB 附件即触顶；直接以选择器临时路径分片上传。
- 已上传附件在端内**不可打开**，界面如实提示；管理员端只能看到数量（无元数据读取动作）。

### 30.4 门禁（本机，PASS）

```text
test            90 pass / 0 fail
test:server    160 pass / 0 fail
root tsc         0 error
server tsc       0 error
build:weapp      Compiled successfully（仅既有 Sass @import 弃用警告）
verify:release  通过（cloud config / no-client-db / artifacts / routes 35 / client:cloud）
build:cloud     3 函数产物：rakApi fdf525cd92f04a58… / rakFiles dcf47ce64d1a6f47… / rakMaintenance 79632b21c831251a…
```

### 30.5 偏差与裁决（如实记录）

| 项 | 说明 |
|---|---|
| saveFile 方案修正 | 设计初稿写「saveFile → upload」；实施前发现微信本地文件存储配额约 10MB，会在 10MB 附件上直接失败 → 云模式改为直接使用选择器临时路径；spec 已同步修正 |
| 门禁修正（用户裁决） | `verify:client:cloud` 原先把 `rakFiles` 当作服务端泄漏禁止，与 DESIGN §11「客户端受控分片上传」冲突；经用户确认后移除该条，其余服务端泄漏检查保留 |
| 导入路径修正 | `uploadTaskAttachmentFromPath` 实际导出在 `src/services/cloud/attachment.ts`（非 `utils/attachment-upload.ts`），计划文档已同步 |
| 旧测试删除 | `m4-tasks.test.ts` 的「附件 = not_implemented」由新的绑定用例取代 |

### 30.6 云侧与真机状态

- **`rakApi`、`rakFiles` 已于 2026-10-18 重新部署（经用户授权）**：两次 `fn deploy --force --install-dependency true` 均返回「云函数部署成功」。
- 只读冒烟：
  - `fn invoke rakApi`（合法信封 `task.submit`）→ `identity_required`（**非** `not_implemented`）；
  - `fn invoke rakFiles`（合法信封 `file.cancel`）→ `identity_required`（**非** `not_implemented`）。
  - 说明新版本处理器已注册生效；管理侧 `getWXContext()` 为空，故无法在 CLI 侧验证绑定事务本身。
- 真机验收：**NOT_RUN**（需重新上传体验版后按 spec §7 的 9 步执行）。
- 下载/预览：仍为 `not_implemented`，本轮未改变该裁决。
