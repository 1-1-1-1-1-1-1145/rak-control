# M8 运行时绑定 — 任务清单（tasks）

依据同目录 [spec.md](./spec.md)。**顺序不可调整**；每步完成即对照验收标准自检。

约定：`pnpm` 一律用 `corepack pnpm`；不 reset/stage/commit；不打印密钥；不伪造云/SDK 结果；未跑通项标 NOT_RUN。

---

## T1 存储/数据库接口异步化（D1）

- [x] T1.1 改 `server/repositories/store.ts`：`Database.read` → `Promise<Doc|null>`；`Database.query` → `Promise<Doc[]>`；`Tx.get` → `Promise<Doc|null>`；`Tx.set` → `Promise<void>`；`Tx.remove` → `Promise<void>`；`MemoryDatabase` 方法改 async，语义/写栅栏/版本校验不变。
- [x] T1.2 依 `tsc` 报错逐个给调用点加 `await`：`modules/{api-handlers,command,context,auth,teams,members,join,invites,tasks,announcements,roi,performance,club,files,provisioning}/index.ts`、`shared/audit.ts`。
- [x] T1.3 同步辅助函数改 async 并向上传播 `await`：`announcements #memberName/#memberNameWith`、`club #publishedSummaries`、`modules/context.ts #resolveTenant/#bumpMutationSeq`、各模块 fence helper。
- [x] T1.4 `tests/helpers.ts`：`addMemberWithIdentity`（tx.set）、`readRevision`、`readMutationSeq` 改 async；同步更新所有引用它们的测试（含 tsc 未报但含 `tx.set` 的 m4/m6/m7 测试）。
- [x] T1.5 自检：`tsc -p server/tsconfig.json --noEmit` = **0 error**（改造前 490）；`corepack pnpm test:server` = **108 pass / 0 fail**；`corepack pnpm test` = **78 pass / 0 fail**；自查 `tx.set(` 103/103 已 await、无 `tx.remove`，无 `as any`/`@ts-ignore` 新增。

## T2 SDK 端口与配置（D3）

- [x] T2.1 新增 `server/shared/cloud-sdk.ts`：`CloudSdk` 端口类型（`getWXContext(): {APPID?,OPENID?,ENV?,SOURCE?}`、`database(): SdkDatabase`、`uploadFile`、`downloadFile`、`deleteFile`）+ `loadCloudSdk(): CloudSdk | null`（懒 `require('wx-server-sdk')` + 最小形状校验，try/catch → null）。
- [x] T2.2 `server/entrypoints/runtime.ts`：`RuntimeConfig`（`appId/env/joinSecret/storageFileIdRoot`）与 `readRuntimeConfig(env=process.env)`；缺任一必填 → null。
- [x] T2.3 `createApiRuntime({sdk,config,now?})`：装配 `db=SdkDatabase`、`identity`（getWXContext 映射）、`expected={appId,env}`、`joinSecret`、`now`。
- [x] T2.4 `createFilesRuntime({sdk,config,storage?,now?})`：同上 + `storage`（缺省 `SdkStorageAdapter`）。
- [x] T2.5 `loadApiRuntime()`/`loadFilesRuntime()`：`loadCloudSdk()` + `readRuntimeConfig()` 任一为 null → 返回 null。
- [x] T2.6 `server/entrypoints/rak-files.ts`：改为 `import { loadFilesRuntime } from './runtime.ts'`（删除本地 null 实现）；`rak-api.ts` 头注释同步更正为 M8 已装配。
- [x] T2.7 自检：`tsc` 0 error。

## T3 DB 适配（D4）

- [x] T3.1 新增 `server/repositories/sdk-database.ts`：`SdkDatabase implements Database`。
- [x] T3.2 `read`：doc 不存在 → null（errCode -502004 与平台文案双重判定）；集合不存在（-502005）与其他错误 → `internal_error`（如实暴露）。
- [x] T3.3 `query`：`skip(offset).limit(500)` 分页全扫 + JS 过滤；累计扫描 > `MAX_SCAN_DOCS=20000` → `stats_unavailable`（不返回部分结果）。
- [x] T3.4 `tx`：`runTransaction(fn, 3)`；`Tx` 用 `doc(id).get()/set({data})/remove()`（写入剥离 `_id`）；闭包捕获返回值；`-501001`/`TransactionConflict` → `revision_conflict`。
- [x] T3.5 顶部注释**如实记录**：query 全扫描 + 扫描预算；仅 doc 级事务；doc-not-found errCode 待云侧确认；`runTransaction` 返回外壳声明为 `unknown`（不按猜测取值）。

## T4 存储适配（D5）

- [x] T4.1 新增 `server/storage/sdk-adapter.ts`：`SdkStorageAdapter implements StorageAdapter`（`uploadObject` 用 SDK fileID；`downloadObject` 取 `fileContent`；`deleteObjects` 逐项保序、缺失项非 0；`fileIdForPath` 用配置 root，未配置即拒绝；`capabilities()` 裁决快照，`downloadTtlSeconds:null`）。
- [x] T4.2 注释记录：`getTempFileURL` 的 `maxAge` 未被执行（D1 FAIL）→ 不提供下载 URL。

## T5 用例（假 SDK）

- [x] T5.1 新增 `server/tests/m8-runtime-binding.test.ts`（**假 SDK**，12 个用例）：`readRuntimeConfig` 必填/缺省/去尾斜杠；`loadApiRuntime/loadFilesRuntime` 缺失即 null；identity 映射与 `identity_required`/`app_mismatch`/`environment_mismatch` 守门（含 ENV 缺失不回落）；db `read`（命中/不存在→null/集合不存在→internal_error）；`query` 跨页过滤与**超预算→stats_unavailable**；`tx` doc 级 get/set/remove（假 SDK 拒绝 data 含 `_id`，验证剥离）、闭包捕获返回值、冲突→`revision_conflict`、业务拒绝原样冒泡；storage 五法（字节往返/保序/fileID 确定性/缺前缀与缺 fileID 拒绝）；`createFilesRuntime` 存储可注入。
- [x] T5.2 自检：`corepack pnpm test:server` = **120 pass / 0 fail**（原 108 + 新增 12）。

## T6 H-7 SDK 锁版写入产物（D2）

- [x] T6.1 `scripts/build-cloud.mjs`：`SDK_LOCK = { name:'wx-server-sdk', version:'4.0.2', locked:true }`；产物 `package.json.dependencies` 写 `"wx-server-sdk":"4.0.2"`；manifest 记为 `sdkCandidate`；头注释同步更正。
- [x] T6.2 跑通 `corepack pnpm build:cloud` + `corepack pnpm verify:cloud:artifacts`；核对 `cloudfunctions/rakApi/package.json` = `{"wx-server-sdk":"4.0.2"}`、`manifest.sdkCandidate.locked=true`。

## T7 全量门禁

- [x] T7.1 `corepack pnpm test` = **78 pass / 0 fail**；`corepack pnpm test:server` = **120 pass / 0 fail**；`tsc -p server/tsconfig.json --noEmit` = **0 error**；根类型检查（既有约定形式 `corepack pnpm exec tsc --noEmit --skipLibCheck`）= **0 error**。
- [x] T7.2 `verify:cloud:config`、`verify:no-client-db`（无客户端 DB 调用/无服务端 SDK 泄漏）、`verify:routes`（31 路由）、`verify:client:cloud`（cloud prod 产物无演示/测试注入/服务端 SDK）全部通过。
- [x] T7.3 `corepack pnpm verify:release` 通过（含 client:cloud）。

## T8 文档与执行日志

- [x] T8.1 更新 `docs/verification/cloudbase-capabilities-2026-10-17.md`：新增 §8「H-7 SDK 锁版 + 本机可验证的 M8 运行时绑定」，含结论表与 5 条偏差（query 扫描预算、`runTransaction` 外壳未实测、doc-not-found errCode 待云侧、worker SOURCE NOT_RUN）。
- [x] T8.2 更新 `docs/MANUAL-OPERATIONS.md`：§0 状态刷新；H-7 标注**已完成**；新增「函数环境变量」步骤（`RAK_APP_ID/RAK_CLOUD_ENV/RAK_JOIN_SECRET/RAK_STORAGE_FILEID_ROOT`）；H-11 标注**用户进行中**。
- [x] T8.3 新增执行日志 `docs/verification/m8-execution-log-2026-10-18.md`（逐步骤操作/验证、门禁输出、偏差、NOT_RUN、文件变更、过程缺陷与修正）。

## T9 云侧配置与重新部署（已获用户授权，2026-10-18 执行）

- [x] T9.0 函数**环境变量**（用户授权）：本机 `cloudbaserc.json`（含密钥，已加入 `.gitignore`）→ `tcb config update fn rakApi/rakFiles`；只读回读 **4 键**齐全；`RAK_JOIN_SECRET` 本机生成、**未回显**（详见执行日志 §8）。
- [x] T9.1 `build:cloud` → 项目根 `fn deploy {rakApi,rakFiles,rakMaintenance} --force --install-dependency true`（云端装 `wx-server-sdk@4.0.2`）→ 三函数均「部署成功」。
- [x] T9.2 冒烟：`rakApi`（`auth.me` 信封）与 `rakFiles`（`file.status` 信封）均返回 **`identity_required`**（非 `not_implemented`）—— 证明运行时真实绑定 + 守门生效。
- [x] T9.3 **首轮冒烟暴露真实缺陷并修正**：装配缺 `cloud.init()`（云端 `database()` 抛 "Cloud API isn't enabled"）。已把 `init` 纳入端口与形状校验、两个工厂先 `init({env: 配置值})` 再绑定，用例断言 `init` 调用与 env；修正后重新构建 + 重新部署 + 冒烟通过。证据与响应原文见执行日志 §9。

## T10 未决/需人工项（登记完成，不可由 AI 替代）

- [x] T10.1 已在文档登记（`MANUAL-OPERATIONS.md` §0/§B/§L、`m8-execution-log-2026-10-18.md` §5/§7/§9/§10）：
  - **H-11 函数调用权限** —— **已完成（§10）**：真实机制是环境级「云函数安全规则」，经 `TCB.ModifyResourcePermission` 写入
    `{"*":{"invoke":"auth != null"},"rakMaintenance":{"invoke":false}}` 并读回复核；控制台「权限控制」入口亦可用（保姆级指南见 MANUAL §L H-11）；
    客户端行为层验证仍 NOT_RUN（须真机小程序）；
  - **H-14 平台初始化** —— **已完成（2026-10-18，见 T11 与执行日志 §11）**：补齐受控 worker 入口后经受控脚本执行，`already=false`/`already=true` 幂等，独立只读核验 `rak_system_config/main` 字段正确；
  - H-15/H-16/H-17 参考号与受控开通（须**真机真实微信**；管理侧 invoke 无身份，不得冒充）；
  - W1 SOURCE 校准、U2/U4 真机字节（须 H-18/H-19）；
  - 受控下载落地需另探针实测「函数响应体量/流式」。

## T11（追加，经用户授权 2026-10-18）H-14 平台初始化：补齐受控 worker 入口并执行

- [x] T11.1 最小受控 worker 入口：`readPlatformConfig()`（仅 AppID/环境，不持有业务密钥）+ `MaintenanceRuntime`/`createMaintenanceRuntime()`/`loadMaintenanceRuntime()`；`rakMaintenance` 按 `event.kind` 分发（`platformInitialize` → 幂等 `initializePlatform()`）；异 appId/缺运行时 → 拒绝且无副作用。
- [x] T11.2 用例 3 个（平台配置读取、worker 运行时装配且不持有密钥、受控分发幂等与拒绝）；`test:server` 120 → **123**。
- [x] T11.3 修正 `scripts/bootstrap-cloud-platform.mjs` 响应解析（兼容 `tcb fn invoke --json` 的 `data.RetMsg` 外壳）。
- [x] T11.4 `config update fn rakMaintenance`（2 项环境变量）→ `build:cloud` + `verify:cloud:artifacts` → `fn deploy rakMaintenance --force --install-dependency true`。
- [x] T11.5 执行 H-14：受控脚本连跑两次（`already=false` / `already=true` 幂等）；**独立只读核验** `rak_system_config/main` 字段正确且无 `clubId`/`ownerUserId`。
