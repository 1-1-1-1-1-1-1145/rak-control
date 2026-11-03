# M8 运行时绑定规格（H-7 SDK 锁版 + 真实 SDK 装配）

日期：2026-10-18（Asia/Shanghai）
依据：[多团队 PLAN §M8](../docs/superpowers/plans/2026-10-17-rak-multi-team-isolation-plan.md)、[DESIGN §4/§6/§11](../docs/superpowers/specs/2026-10-17-rak-multi-team-isolation-design.md)、[M0 能力报告 §3.1](../docs/verification/cloudbase-capabilities-2026-10-17.md)
状态：**待用户批准**（本文件不产生任何云端写入）

---

## 1. 背景与已核实事实

| 事实 | 证据 |
|---|---|
| H-8 集合(20)/H-9 索引(26)/H-10 规则/H-12 三函数部署 已完成 | 能力报告 §3.1 补充表 |
| H-11（函数调用权限）由用户在控制台进行中 | 用户本轮消息 |
| SDK 已锁版 **wx-server-sdk 4.0.2**（内置 @cloudbase/node-sdk 3.17.2）；`getWXContext/uploadFile/downloadFile/getTempFileURL/deleteFile/runTransaction(run,retry)`；**无凭证签发 API、无 copyFile** | 能力报告 §3.1 #2/#5 |
| `uploadFile` 的 fileID = `cloud://<env>.<bucket>/<cloudPath>`，同路径 fileID 完全一致，**可确定性构造**（桶 `636c-cloud1-d4g36r8z6a8908540-1502866673`） | 能力报告 §3.1 #4 |
| 管理侧 `fn invoke` 的 `getWXContext()` **为空**（无 OPENID/APPID/SOURCE）→ 不能冒充微信身份 | 能力报告 §3.1 #2 |
| `build-cloud.mjs` 当前 `SDK_CANDIDATE = {version:null, locked:false}`，产物 `dependencies:{}`（**尚未写入版本**） | [build-cloud.mjs](file:///c:/Users/24800/Desktop/小程序/rak-control/scripts/build-cloud.mjs#L39-L40) |
| `loadApiRuntime()` 返回 `null`；`loadFilesRuntime()` 返回 `null` → 入口空处理器表，一律 `not_implemented` | [runtime.ts](file:///c:/Users/24800/Desktop/小程序/rak-control/server/entrypoints/runtime.ts)、[rak-files.ts](file:///c:/Users/24800/Desktop/小程序/rak-control/server/entrypoints/rak-files.ts#L13-L15) |

---

## 2. 核心冲突（本规格要解决的关键问题）

`server/repositories/store.ts` 定义：

```ts
export interface Database {
  read(collection: string, id: string): Doc | null          // 同步
  query(collection: string, predicate: (doc: Doc) => boolean): Doc[]  // 同步
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}
export interface Tx {
  get(collection: string, id: string): Doc | null           // 同步
  set(collection: string, doc: Doc): void                   // 同步
  remove(collection: string, id: string): void              // 同步
}
```

wx-server-sdk 的 `doc.get()/set()/remove()`、`runTransaction`、集合分页 `get()` **全部返回 Promise**。

**结论：同步接口无法绑定真实 SDK，直接"包装"在技术上不可行。** 该同步接口只对 `MemoryDatabase`（同步内存替身）成立。全服务端同步调用点约 **200+**（14 个模块 + `tests/helpers.ts` + 12 个 server 测试），全部按同步写法。

> 说明：`StorageAdapter`（`uploadObject/downloadObject/deleteObjects`）本就是 **异步**接口，`ApiRuntime.identity` 用到的 `getWXContext()` 是**同步**方法 → 二者**无冲突**；唯一冲突点是 `Database`/`Tx`。

---

## 3. 决策

### D1 —（关键，需批准）把 `Database`/`Tx` 改为异步接口

- 目标形态（`Promise<T>`，不用联合类型）：
  - `Database.read(collection,id): Promise<Doc | null>`
  - `Database.query(collection,predicate): Promise<Doc[]>`
  - `Database.tx<T>(fn): Promise<T>`（不变，本就异步）
  - `Tx.get(collection,id): Promise<Doc | null>`、`Tx.set(collection,doc): Promise<void>`、`Tx.remove(collection,id): Promise<void>`
- `MemoryDatabase` 语义不变，仅方法改 async（内部仍同步执行并返回已 resolve 的 Promise）。
- 全部调用点加 `await`；同步辅助函数（如 `announcements #memberName`、`club #publishedSummaries`、`helpers #readRevision`）随之改 async 并向上传播 `await`。
- **由 `tsc -p server/tsconfig.json --noEmit` 强制穷尽**：任何漏 `await` 处会编译失败，不会出现"测试绿、线上坏"。

被否决的替代：
- **(B) 不改接口、跳过 DB 绑定** — 则 `rakApi` 仍恒返回 `not_implemented`，M8 无法推进；本轮只剩 H-7/存储/身份骨架。可作为降级选项。
- **(C) 用 `Doc | Promise<Doc>` 联合类型、只在部分处 await** — 生产环境会把 Promise 当 Doc 使用而静默出错（测试用内存替身仍绿）→ **禁止**。
- **(D) 请求级"全集合预加载"缓存** — 违反 PLAN「扫描预算/不用 SDK 默认首批冒充全队」且不可控 → **禁止**。

### D2 — build-cloud 写入锁定 SDK 版本（H-7）

- `SDK_CANDIDATE = { name: 'wx-server-sdk', version: '4.0.2', locked: true }`。
- 每个产物 `cloudfunctions/*/package.json` 的 `dependencies` 写入 `"wx-server-sdk": "4.0.2"`。
- `manifest.json` 记录 `sdkCandidate`；`verify:cloud:artifacts` 必须仍通过。

### D3 — 运行时装配与配置来源

- 新增 `server/shared/cloud-sdk.ts`：**SDK 端口类型**（最小 API 面：`init?`、`getWXContext`、`database`、`uploadFile`、`downloadFile`、`deleteFile`）+ `loadCloudSdk()`（懒 `require('wx-server-sdk')`，`try/catch` → `null`）。
- `server/entrypoints/runtime.ts`：
  - 纯工厂 `createApiRuntime({ sdk, config, now? })`、`createFilesRuntime({ sdk, config, storage, now? })`（供**假 SDK** 单测）。
  - `loadApiRuntime()` / `loadFilesRuntime()`：读环境变量；**缺任一必填 → 返回 `null`**（fail-closed，入口 `not_implemented`）。`loadFilesRuntime` 由 `runtime.ts` 导出，`rak-files.ts` 改为引用它。
- 配置（**函数环境变量**，不进源码/日志；控制台配置，属人工步骤）：

| 变量 | 用途 | 缺失行为 |
|---|---|---|
| `RAK_APP_ID` | `expected.appId`（沿用已有脚本命名） | 返回 null → not_implemented |
| `RAK_CLOUD_ENV` | `expected.env` | 同上 |
| `RAK_JOIN_SECRET` | 申请入口 token HMAC 密钥（[join-token.ts](file:///c:/Users/24800/Desktop/小程序/rak-control/server/shared/join-token.ts)） | 同上 |
| `RAK_STORAGE_FILEID_ROOT` | `cloud://<env>.<bucket>`（U5 实测可确定性构造） | 存储适配 fail-closed（`storage_unavailable`） |

- identity：`sdk.getWXContext()` → `{ appId: ctx.APPID, openid: ctx.OPENID, env: ctx.ENV }`；缺 `OPENID/APPID` → `null`；由既有 `assertTrustedIdentity(identity, expected)` 守门（`app_mismatch`/`environment_mismatch`/`identity_required`）。

### D4 — DB 适配 `server/repositories/sdk-database.ts`

`SdkDatabase implements Database`：

- `read`：`database().collection(name).doc(id).get()`。
  - 文档不存在 → `null`：判定 `errCode === -502004` **或** message 含 `does not exist`/`not exist`/`不存在`，或返回 `data` 为空。
  - 其他错误 → `internal_error`（含集合不存在 `-502005`，如实暴露而非静默）。
  - *假设待云侧确认*：`-502004` 为文档不存在按官方 errCode 语义推定，本轮以假 SDK 覆盖，真实 errCode 待云侧实测（NOT_RUN）。
- `query`：**分页全量扫描 + JS 过滤**：`limit(500).skip(offset).get()` 循环至不足一页；**累计扫描条数 > `MAX_SCAN_DOCS = 20000` → 抛 `stats_unavailable`（不返回部分结果）**（对齐 [M6 绩效 MAX_SCAN](file:///c:/Users/24800/Desktop/小程序/rak-control/server/modules/performance/index.ts#L27)）。**偏差如实记录**（属待优化项）。
- `tx`：`db.runTransaction(async (t) => {...}, 3)`；`Tx.get/set/remove` → `t.collection(n).doc(id).get() / set({ data }) / remove()`（**仅 doc 级，禁用 where/add**，与 DESIGN §12「服务端事务仅 doc」一致）。返回值由**闭包捕获**（不依赖 `runTransaction` 返回外壳，规避未知返回结构）。平台冲突（`-501001` / `TransactionConflict`）→ `revision_conflict`。

### D5 — 存储适配 `server/storage/sdk-adapter.ts`

`SdkStorageAdapter implements StorageAdapter`：

- `uploadObject(path, bytes)` → `sdk.uploadFile({ cloudPath: path, fileContent: Buffer })` → `{ fileID: res.fileID }`（**用 SDK 返回值，不手拼**）。
- `downloadObject(fileID)` → `sdk.downloadFile({ fileID })` → `res.fileContent` → `Uint8Array`。
- `deleteObjects(fileIDs)` → `sdk.deleteFile({ fileList })` → 逐项 `{ fileID, status }`（**保输入顺序**）。
- `fileIdForPath(path)` → `` `${config.storageFileIdRoot}/${path}` ``（root 为**配置的实测值**；范围内确定性构造已被 U5 证明）。
- `capabilities()` → `{ adjudicated:true, uploadTransport:'function-chunks-v1', maxObjectBytes:10485760, downloadTtlSeconds:null }`（**不伪造 expiresAt/TTL**）。
- 备用 `downloadFileURL` 不实现（受控下载能力未实测，保持既有 `not_implemented`）。
- `adapter.ts` 的 `loadStorageAdapter()` 保持未裁决 fail-closed（未配置时）。

### D6 — 身份/授权路径不变

`assertTrustedIdentity`、`resolveTenant`、命令幂等、写栅栏一律不改语义。

---

## 4. 非目标（本轮不做）

- 不实现 `file.downloadUrls` / `file.previewDraft`（受控下载体量/流式能力未实测）。
- 不改 worker（`rakMaintenance`）平台来源校验（SOURCE 校准仍 NOT_RUN）。
- **不重新部署云函数**（云写入，需用户重新授权；H-11 完成后另行发起）。
- 不改前端 `src/**`（配色/字号/图标/布局一律不动）。
- 不创建/删除任何云资源。

---

## 5. 验收标准与验证命令

| 命令 | 期望 |
|---|---|
| `corepack pnpm test:server` | 全绿，且 ≥ 现 108（新增 m8 用例） |
| `node node_modules/typescript/bin/tsc -p server/tsconfig.json --noEmit` | 0 error（穷尽 await） |
| `corepack pnpm test` | 78/78 全绿 |
| `corepack pnpm build:cloud` | 三产物生成 |
| `corepack pnpm verify:cloud:artifacts` | 通过；且产物 `package.json` 含 `wx-server-sdk: 4.0.2` |
| `corepack pnpm verify:cloud:config` / `verify:no-client-db` / `verify:routes` | 通过 |
| `corepack pnpm verify:release` | 全绿 |
| 新用例 `server/tests/m8-runtime-binding.test.ts`（**假 SDK**） | identity 映射与守门；db `read`（含不存在→null）；`query` 分页与**超预算→stats_unavailable**；`tx` 冲突→`revision_conflict`、doc 级 set/get/remove；storage 五法映射；`fileIdForPath` 确定性 |

**云侧（需用户授权，另行发起）**：`build:cloud` → 复制到 `$env:TEMP\rak-deploy\functions` → `fn deploy` 三函数（`--install-dependency true`，Node20 云端装依赖）→ 冒烟：`rakApi` 合法信封应返回**真实业务码**（环境变量未配置时为 `not_implemented`；已配置但平台未初始化时应为 `setup_required`/`identity_required`），不再一律 `not_implemented`，**如实记录**实际返回。

`items` 中属真实云/真机者（真实身份 DB 读写、事务冲突真实 errCode、SOURCE 校准、U2/U4 字节）本轮一律 **NOT_RUN**。

---

## 6. 风险与回滚

- **风险**：200+ 调用点漏 `await`。**缓解**：接口直接用 `Promise<T>`（非联合类型），`tsc` 会逐处报错；回归网 186 用例（前端 78 + 服务端 108）。
- **风险**：真实 `doc.get()` 不存在时的 errCode 与假设不符。**缓解**：多重判定 + 云侧冒烟核对；不符则按实测修正并记录。
- **回滚**：`git` 未提交改动保留；如需回退，将 `store.ts` 恢复同步并删除新增文件（`MemoryDatabase` 原样保留）。

---

## 7. 需用户确认（批准后才进入执行）

1. **D1**：是否批准把 `Database`/`Tx` 改为异步接口（范围：server 全模块 + 测试，约 200+ 调用点）。
2. **D3**：环境变量命名与必填项是否照上表（`RAK_APP_ID` / `RAK_CLOUD_ENV` / `RAK_JOIN_SECRET` / `RAK_STORAGE_FILEID_ROOT`），并在函数控制台配置。
3. **D2**：SDK 锁版写入产物 `package.json`（`wx-server-sdk: 4.0.2`）是否确认。
4. 云函数**重新部署**授权：本轮不执行，待你 H-11 完成后再单独发起。
