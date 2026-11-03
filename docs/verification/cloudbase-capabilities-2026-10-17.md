# Rak CloudBase 多团队使用 — M0 能力门禁报告

日期：2026-10-17（Asia/Shanghai）
依据：多团队 [DESIGN §16](../superpowers/specs/2026-10-17-rak-multi-team-isolation-design.md)、[PLAN M0](../superpowers/plans/2026-10-17-rak-multi-team-isolation-plan.md)、云化基线 [BASE-DESIGN §15](../superpowers/specs/2026-10-16-rak-cloudbase-multiuser-design.md)
工作目录：`C:/Users/24800/Desktop/小程序/rak-control`
状态：**E1（只读）/E2/E3 已 PASS；U1、U3、D1 实测为 FAIL（本 SDK 不支持或未达成）；U2/U4/W1/C1/O1 及 MT 系列仍待真实微信/真机或控制台。上传传输协议已裁决为 `function-chunks-v1`；下载 TTL 门槛未达成，待用户裁决。本报告不判定云端可用。**

执行前提说明：本次任务由用户确认，以 **2026-10-17 多团队方案**为执行主入口（用户选择）。
**更新（2026-10-17）**：用户已完成 CloudBase CLI 登录（H-4），本报告 §3 的远端只读资源快照已由本机 CLI **只读命令**实测填写；未改动任何远端资源（未建集合/未传函数/未改规则/未动数据）。

## 0. 摘要与结论

| 分类 | 结论 | 证据层 |
|---|---|---|
| 本地只读盘点（git/AGENTS/依赖/构建/测试/哈希） | PASS | 本机命令输出 |
| 远端只读资源盘点（环境/函数/触发器/集合/文档量/存储/规则现状） | PASS（2026-10-17 经 CLI 实测） | 本机 CLI 只读输出（§3） |
| 云能力门禁 | E1（只读）、E2、E3 **PASS**；U1、U3、D1 **FAIL**；U2/U4/C1/O1 及 MT 系列仍 BLOCKED/NOT_RUN | §2、§3.1（探针实测） |
| 上传传输协议裁决 | **已裁决：`function-chunks-v1`**（首选 exact-key PUT 的关键能力不成立）；分片客户端参数待 U4 真机 | §3.1 |
| 下载 TTL 裁决 | **原设计门槛未达成**（`maxAge` 未被实际执行）；须"受控下载适配"或"阻止附件上线" —— **待用户裁决** | §3.1 #8 |
| 环境与能力条件 | **部分明确**（环境/DB/函数/触发器/存储/规则已核实；配额与集合权限明细待控制台） | §3 |
| 云端“可用/通过”判定 | 不判定 | —— |
| 允许的后续工作 | M1–M7 本地部分与 M5 fail-closed 骨架（均已完成）；云端真实能力仍不可用 | 本地 |

按 PLAN M0 出口："上传/下载协议已裁决，环境与能力条件明确；缺云条件只允许后续本地工作，不判云端通过。" 当前**上传协议已裁决为 `function-chunks-v1`**，但**下载 TTL 门槛未达成**且 U2/U4 真机项未跑，故 **M5 附件仍不得声称可用**，M8/M9 保持阻塞。

## 1. 本地只读证据（PASS）

### 1.1 Git 快照与用户改动保护

- 仓库：`C:/Users/24800/Desktop/小程序/rak-control/.git`（**主目录确实有 Git**，与旧 2026-10-16 文档"无.git"快照不符；多团队 DESIGN §47 已更正）。
- 分支：`master`；远端：`origin git@git.weixin.qq.com:wx_a8bf102dcfdcec4c/mini-app.git`。
- HEAD：`ff901cfb4903d29f44638eafa1999db2bcc88085`（提交信息 "11"，2026-10-16 23:09:06 +0800）。
- `git status --short`：

```text
MM docs/superpowers/plans/2026-10-16-rak-cloudbase-multiuser-plan.md
MM docs/superpowers/specs/2026-10-16-rak-cloudbase-multiuser-design.md
?? .planning/2026-10-17-rak-multi-team-design/
?? docs/superpowers/plans/2026-10-17-rak-multi-team-isolation-plan.md
?? docs/superpowers/specs/2026-10-17-rak-multi-team-isolation-design.md
```

- `git diff --stat`（工作区相对索引）：两份 2026-10-16 文档各 +2 行（多团队取代声明横幅）。
- `git diff --cached --stat`（索引相对 HEAD）：两份 2026-10-16 文档 109 insertions / 77 deletions（既存暂存修改）。
- **处置**：全部保留，未 reset / stage / commit / 删未跟踪文件（遵守 PLAN 硬约束 2）。本报告与新增 evidence 文件为新增，不改动上述文件。

### 1.2 AGENTS 核查

- 项目内、`c:\Users\24800\Desktop\小程序`、`c:\Users\24800\Desktop`、`c:\Users\24800` **均无适用 `AGENTS.md`**。
- 仅存历史资料 `docs/archive/AGENTS.original.md`（不赋予部署授权）。
- 结论：本次无 AGENTS 约束，按 DESIGN + 用户最新决定执行。

### 1.3 依赖、运行时与云 SDK 现状

| 项 | 实际值 | 影响 |
|---|---|---|
| Node | v24.21.0 | 满足 `--experimental-strip-types` test 脚本 |
| pnpm | PATH 未直接暴露；`corepack pnpm` = 12.14.0 | 命令须经 `corepack pnpm` 运行；未做 install，未改锁文件 |
| npm | 11.19.0；全局目录 `C:\Users\24800\AppData\Roaming\npm` 不存在 | 影响 `npm i -g` 类全局安装（含 CLI） |
| wx-server-sdk | 锁文件与 node_modules 均**未包含** | M0 需先锁版再试验；当前不能声称已验证 SDK 行为 |
| @cloudbase/node-sdk | 同上未包含 | 同上 |
| CloudBase CLI（tcb/cloudbase） | 未安装 | 无法执行云端只读盘点 |

### 1.4 构建脚本与模式现状

- `package.json` scripts：仅 `build:weapp`、`build:weapp:prod`、`dev:weapp`、`test` 等；**尚无** `test:server`、`build:cloud`、`verify:*` 系列（M1/M2 待创建，未创建前不可运行或记 PASS）。
- `config/build-mode.ts`：仅解析 `demo` / `http`（`TARO_APP_DEMO` + 必填 HTTPS `TARO_APP_API_BASE`），**无 cloud 模式**。
- `config/index.ts` defineConstants 仅注入 `__RAK_DEMO_MODE__`、`__RAK_API_BASE__`；无 `__RAK_BACKEND__` / `__RAK_CLOUD_ENV__`。
- `project.config.json`：`miniprogramRoot: "dist/"`、`appid: wxa8bf102dcfdcec4c`；**无 `cloudfunctionRoot`**（与 DESIGN §45"待恢复"一致）。
- `src/app.ts`：仅 `uiStore.syncTabBarStyle()` + `authStore.bootstrap()`，无 `cloud.init`。
- 路由：`src/app.config.ts` 16 主包页 + 10 分包页 = **26 页**（与 DESIGN §39/§377 一致；实施后页数以配置重算，不再固定 26）。

### 1.5 测试与类型基线（只读运行）

- `corepack pnpm test` → **17/17 pass，0 fail**（Node 内置 test + strip-types）。
- `corepack pnpm exec tsc --noEmit --pretty false --skipLibCheck` → **退出码 0**。
- 运行未修改任何文件；未运行 `build:weapp` / `build:weapp:prod`（M0 无需，且 prod 现存配置为旧模式）。

### 1.6 精确文件哈希清单

见 [evidence/source-hashes-2026-10-17.txt](./evidence/source-hashes-2026-10-17.txt)（49 项 SHA-256）。用于实施前后比对，证明未覆盖用户既有改动。

## 2. 云能力门禁（除 E1 只读部分外，均 BLOCKED — 未验证）

状态枚举：PASS / FAIL / NOT_RUN / BLOCKED。除 E1 的**只读部分**外，以下均为 **BLOCKED**：缺少隔离试验环境、锁版 SDK 与真实微信身份，无法得出有效能力结论。

| 门禁 | 检查内容（DESIGN §16 / BASE §15 / PLAN M0） | 状态 | 阻塞原因 | 解除所需（人工） |
|---|---|---|---|---|
| E1 环境 | AppID 绑定、环境 `cloud1-d4g36r8z6a8908540` 归属/地域/模式、数据库类型与套餐、部署权限 | **PASS（只读部分）** | 只读已核实（§3）；**写入/部署权限**未验证；配额与集合权限明细 CLI 无读取命令 | 控制台核对配额（H-5）与集合权限（H-10）；部署阶段自然验证写权限 |
| E2 SDK/runtime | 目标 Node 运行时、wx 身份来源、Node 存储 SDK 临时凭证、锁版兼容 | **PASS** | —（2026-10-17 探针实测） | 已锁 `wx-server-sdk` **4.0.2**（内含 `@cloudbase/node-sdk` 3.17.2）、运行时 **Nodejs20.19**（实为 v20.19.3）；`getWXContext()` 提供 OPENID/APPID/UNIONID/ENV/SOURCE |
| E3 事务/索引 | doc-only 事务、冲突重试、100 操作/30 秒、复合排序/唯一索引与游标查询 | **PASS（能力层）** | 索引仍需按 H-9 在控制台建（复合/唯一） | 见 §3.1 #1 |
| U1 受限上传 | 全凭证只允许 staging exact-key PUT；改 key/method/final、读/删/列举/自签其他对象失败；有效期可证 | **FAIL（本 SDK 不支持）** | `wx-server-sdk` 4.0.2 **无凭证签发 API**，也**无** `copyFile` | 依 M0 裁决改走 `function-chunks-v1`（§3.1 #5） |
| U2 手机传输 | 微信 raw PUT 10 MiB 真机成功、超时取消可恢复；非 multipart | **NOT_RUN** | 需真机与真实微信身份（H-18/H-19） | 真机试验 |
| U3 冻结 | copyFile `overwrite:false`、客户端不能改 final、可有界读取 candidate | **FAIL（本 SDK 不支持）** | 服务端 `uploadFile` 对同一路径**直接覆盖**（实测 `sameFileID=true`），无冻结语义 | 冻结改由"唯一 candidate 路径 + 校验后发布"实现（§3.1 #4） |
| U4 分块备选 | 事件上限、256 KiB 片、10 MiB 组装、资源/费用达标 | **NOT_RUN（部分可测）** | 服务端侧可行性未测；事件上限与客户端片传必须真实微信 | 裁决后真机试验 |
| U5 对象恢复 | 预登记 path 副作用丢响应后可恢复规范 fileID、验证/删除；同 path 映射稳定、错环境拒绝 | **部分 PASS** | 规范 fileID 可由 `cloud://<env>.<bucket>/<path>` **确定性构造**（实测同路径两次上传 fileID 完全一致，无需 listFiles）；缺失对象/错环境行为待补测 | 见 §3.1 #4 |
| D1 下载 | 服务端私有 URL 可用、实际 TTL ≤ 300s 且可验证 | **FAIL（实际 TTL 不可控）** | 私有临时 URL 可签发、带签名、可 GET 200；但 `maxAge` **未被实际执行**：`maxAge=20` 的 URL 在 35s 后（且无缓存预热）仍返回 200，返回体也不含实际到期时间 | **不能伪造 expiresAt**：须实现"有实际限期能力的签名适配/受控下载"或**阻止附件正式上线**（§3.1 #8） |
| W1 worker | 平台可信定时来源、客户端禁 invoke、lease/fence 有效 | **部分 PASS** | 管理侧 invoke 的 `getWXContext()` 为**空**（无 OPENID/APPID/SOURCE）→ **不可**凭它以微信用户身份授权；客户端 invoke 拒绝与定时来源需真实客户端/平台配置 | 见 §3.1 #2 |
| C1 小程序码 | openapi 权限、scene 长度/解析、page/env_version 可用 | BLOCKED | 无公众号平台访问 | 用户授权后验证 |
| O1 备份/费用 | 数据/字节备份恢复、告警、配额与预算 | BLOCKED | 无控制台 | 用户确认套餐 |
| MT-P0-a 跨队拒绝 | 真实身份 TEAM scope 跨队查询拒绝、不泄露存在性 | BLOCKED | 需真实微信身份 | 隔离环境多身份 |
| MT-P0-b membership 唯一 | `rak_members` `hash(clubId,userId)` 唯一键/索引可用 | BLOCKED | 无环境 | 隔离试验 |
| MT-P0-c 打包边界 | TEAM scope 贯穿打包边界、前端依赖树不含 server/管理 SDK | BLOCKED | 待 M1 产物后验证 | M1 后静态检查 |
| MT-P0-d club 写栅栏热点 | `club.mutationSeq` 写栅栏在各队并发的容量表现 | BLOCKED | 无环境 | M8 容量测试 |
| MT-P0-e 测试夹具覆盖 | 所有读/统计/后台测试夹具含多队覆盖 | BLOCKED | 待夹具创建 | M1–M6 |

**关键裁决**：上传传输协议（签名 PUT vs `function-chunks-v1`）**尚未裁决**。在 U1–U3/U5 未通过前，M5 附件正式上线保持阻塞，不预先写成可完成。

## 3. 远端只读资源快照（2026-10-17 实测 — 仅只读命令，未改任何远端资源）

采集方式：本机 `corepack pnpm dlx --package=@cloudbase/cli cloudbase <只读子命令> -e cloud1-d4g36r8z6a8908540`
（env list / env detail / fn list / fn detail / storage list / storage rules get / db model list / db nosql execute / api scf ListTriggers）。

| 项 | 实测结果 |
|---|---|
| 环境 | `cloud1-d4g36r8z6a8908540`（套餐 **个人版**、来源 云开发、地域 ap-shanghai、状态 正常、创建 2026-10-09 18:55:55、到期 2027-04-09 23:59:59）；该账号下**仅此 1 个环境** |
| AppID | `wxa8bf102dcfdcec4c`（项目配置；`env detail` 的 App ID 列为空，绑定关系待控制台 H-2 复核） |
| 数据库 | **文档型**（`db nosql` 可用）；实例 `tnt-4e7cfz2kw`、ap-shanghai、RUNNING |
| 集合 | 共 5 个，**全部为既有 OA 子系统**：`oa_validation_applications`、`oa_validation_members`、`oa_validation_events`、`oa_validation_audit`、`oa_validation_status_history`；**不存在任何 `rak_*` 集合** |
| 记录数 | 上述 5 个集合各 **1 条**（既有数据，**不得**清理/覆盖） |
| 现有云函数 | `oaValidation`、`quickstartFunctions`（均 Nodejs16.13，模板/既有）；**`rakApi`/`rakFiles`/`rakMaintenance` 均不存在** |
| 现有定时触发器 | 两个函数 `TotalCount = 0`（无触发器） |
| 云存储 | 文件列表为空（0 文件）；桶 `636c-cloud1-d4g36r8z6a8908540-1502866673`（CDN `tcb.qcloud.la`，ap-shanghai） |
| 云存储权限规则 | **仅创建者及管理员可读写**（非公开；是否等价于"客户端 read/write=false"待 H-10 在控制台确认） |
| 静态托管 | 已开通 online（`cloud1-d4g36r8z6a8908540-1502866673.tcloudbaseapp.com`） |
| 日志服务 | **未开通**（排障/告警前需开通，属 H-26 前置） |
| 配额/集合权限明细 | 个人版非资源点计费 → `env usage`/`env info` **无法输出**；集合级权限 CLI 无读取命令 → 需控制台（H-5/H-10） |
| 业务数据核查 | **无本方案业务数据**（无 `rak_*` 集合、无本项目函数）→ 可安全执行"空云初始化"；但存在 OA 元数据（每集合 1 条），**禁止**任何整库/整桶清理 |

> 采集注意事项（本地工具层，不是云端结论）：Windows PowerShell 5.1 → `corepack.cmd` 会吞掉参数中的双引号，`db nosql execute --command '<JSON>'` 无法直接传参；本次改用 **argv 数组直传**（不经 shell 引号层）取得结果。后续 `RAK_ADMIN_READ_TEMPLATE`（独立只读断言通道）建议采用同形态，以保证参数保真。

> 处置原则不变：**不删除、不停用**任何既有远端资源（上述 OA 集合/函数/静态托管均属他人既有资产，只记录不清理）。

### 3.1 M0 云能力试验证据（探针 `rakProbe`，2026-10-17）

方式：临时部署探针云函数 `rakProbe`（`Nodejs20.19`、`wx-server-sdk` **4.0.2**、云端安装依赖；**M0 完成后按 fixture 精确删除**），
用 `fn invoke -d @<params>.json` 逐动作调用。试验资源前缀固定：集合 `rak_probe_*`、存储 `probe/rakM0/`。

| # | 门禁 | 试验 | 原始结论（节选） |
|---|---|---|---|
| 1 | E3 | 事务回滚 / 提交 / 读改写 / 100 操作 | 回滚：事务内 `doc.set` 后抛错 → 该文档**不存在**（`document with _id probe-rollback does not exist`）✓；提交：2 个文档均落库 ✓；读改写：事务内 `get`→`set` 回写 42，落库 42 ✓；`{"ops":100,"ms":4672}` 成功（≈47ms/op，远低于 30s 预算）✓ |
| 1b | E3 | 并发同文档事务 | 一方 `ok`、另一方 **`TransactionConflict`（-501001）显式失败**，`finalN=1` 无丢写；传入 `retry=3` 未被自动吞并 → 冲突必须显式重试处理 |
| 1c | E3 | 排序/查询 | 单字段 `orderBy`、`where + orderBy`、多字段 `orderBy` **均成功**（未见缺索引报错）；正式集合仍按 H-9 建复合/唯一索引 |
| 2 | E2 / W1 | 运行时、SDK、身份来源 | `node v20.19.3`、`sdk 4.0.2`；**管理侧 invoke 的 `wxContext.keys = []`**（无 OPENID/APPID/SOURCE）→ 不得凭管理侧调用冒充微信用户身份；`getWXContext()` 在真实客户端调用时应提供 OPENID/APPID/ENV/SOURCE |
| 3 | E1/H-8 | 读不存在的集合 | 报 **`-502005 DATABASE_COLLECTION_NOT_EXIST`** → **集合不会自动创建**，H-8 必须先建集合再跑业务 |
| 4 | U5 / U3 | 规范 fileID 与同路径覆盖 | `uploadFile({cloudPath,fileContent})` → fileID = `cloud://<env>.<bucket>/<cloudPath>`，同路径两次上传 **fileID 完全一致**（可确定性构造，无需 listFiles）✓；但同一 `cloudPath` 再次上传 **`sameFileID=true` 内容被覆盖** → **无 `overwrite:false` 冻结语义** |
| 5 | U1 | SDK 能力面（锁版核对） | 有 `getWXContext/uploadFile/downloadFile/getTempFileURL/deleteFile/createCollection/runTransaction(run,retry)/startTransaction`；**无凭证签发 API**、**无 `copyFile`** |
| 6 | D1 | 私有临时 URL 与到期 | `getTempFileURL({fileList:[{fileID,maxAge:300}]})` → `status:0`、URL 带 `sign`、函数内 `fetch` 得 **HTTP 200 / 32B**；但返回体**无 `maxAge` 字段**，URL 查询参数仅 `sign`/`t`（`t` 为 10 位数字 ≈ 生成时间）→ **实际 TTL 无法从返回体取得**，需延迟复验 |
| 7 | U5 | 缺失对象 | `deleteFile` 对不存在的 fileID 返回逐项状态 **`-503003 storage file not exists`**（显式失败，不静默） |
| 8 | D1 | **实际 TTL 复验（决定性）** | `maxAge=20` 且**不预取**（排除 CDN 缓存热身）→ 35s 后仍 **HTTP 200 / 64B** → 请求的 `maxAge` **未被实际执行**；`getTempFileURL` 返回体亦无 `maxAge`/到期字段 → **URL 的实际期限不可控、不可验证** |

**上传传输协议裁决（依 PLAN §M0「首选协议任何关键能力不成立则选 function-chunks-v1」）**：
首选「云函数签发 exact-key 受限 PUT + `copyFile overwrite:false` 冻结」的两项**关键能力在本 SDK 均不成立**
（无凭证签发 API、无 `copyFile`、同路径可直接覆盖）→ **裁决为 `function-chunks-v1`**。
分片字节参数（256 KiB 片）与客户端片传、10 MiB 组装仍须 **U4 真机验证**；**在 U4 通过前，M5 附件不得声称可用**。

**下载 TTL 裁决**：M5 原设计要求"临时 URL 实际 TTL ≤ 300 秒且可验证"，实测 `maxAge` **未被实际执行**（§3.1 #8）→
该门槛**未达成**。依 DESIGN §11.2「不支持时实现有实际限期能力的签名适配或阻止附件正式上线，**不能伪造 expiresAt**」，
M5 下载路径必须二选一：**(a)** 实现有实际限期能力的受控下载（如云函数代理下载 / 自管签名适配）；**(b)** **阻止附件正式上线**。
两者均为产品/安全取舍，**需用户裁决**，本轮不擅自选定。

**未覆盖（NOT_RUN，需真实微信/真机）**：U2（10 MiB 真机字节上传、客户端 exact-key 约束、`saveFile` 行为）、
U4（客户端片传与事件上限）、W1（客户端 invoke 拒绝、定时来源）、C1（小程序码）、O1（备份/费用）；
另：缺失对象/错环境 fileID 的行为、D1 实际 TTL 复验。

## 4. 隔离试验夹具计划（待创建 — 依赖 SDK 锁版）

在 SDK 锁版（E2）前不创建代码夹具，避免伪造 API。计划内容：

- 夹具目标：仅验证能力（身份上下文/DB 规则/事务/索引/上传/下载/恢复/worker），不写入生产注册动作。
- 隔离环境、非生产数据；试验资源按 fixture ID 精确清理，不整库/整桶删除。
- 需覆盖：DB 客户端 read/write deny、doc 事务冲突与重试、复合游标、U1–U5、D1 TTL、W1 平台来源、跨队拒绝。
- 产物路径建议（M1 起）：`scripts/cloud-integration/`（真实微信调用器 + 独立只读断言器）。

## 5. 需用户完成的人工步骤（阻塞解除清单）

按 PLAN §7 与 DESIGN §14，**不索取 AppSecret/API key**。需用户执行：

1. **环境与登录** —— **CLI 登录已完成（2026-10-17，H-4）**，只读盘点已执行（§3）。**仍需你在控制台复核**：AppID 与环境的绑定关系（H-2）、套餐配额（H-5）、集合级权限（H-10）。
2. **环境隔离 —— 已裁决（2026-10-17 用户确认）：不另建独立环境**（H-3 跳过），沿用 `cloud1-d4g36r8z6a8908540`。风险：真实能力试验与正式使用同处一环境；本报告与后续 M8 记录均按"**无隔离环境**"标注，试验数据需按 fixture ID 精确清理（不得整库/整桶清理）。
3. **真实测试身份**：至少第二个微信账号 + 第二台设备（真机）加入体验/测试名单，用于真实身份调用与跨设备验收（不可用模拟器角色切换冒充）。
4. **小程序码权限**：确认 openapi/公众号平台能力是否可用；不足时按 DESIGN §7.2 降级为手工邀请码（不阻塞核心入队）。
5. **基础能力/费用**：确认数据库/私有存储/定时/备份能力与预算告警；阈值依据实测。本报告不猜价格。
6. **团队信息**：确认拟建两队名称/`slug`/各队真实 owner 及本人参考号（受控开通用）。
7. **审核材料**：隐私声明、类目与正式审核资料（正式发布前需要）。

> 本机 npm 全局目录 `C:\Users\24800\AppData\Roaming\npm` 缺失，全局安装 CLI 可能需先修复 npm prefix（`npm config get prefix` 或改用 `pnpm dlx`/`npx`）。此为本地环境问题，非云端权限。

## 6. 边界与证据层声明

- 本报告本地部分为 **本机命令直接证据**；云能力部分为 **BLOCKED**，非 FAIL，也非 PASS。
- 未查询远端控制台，故不断言远端资源存在与否（DESIGN §31 同口径）。
- 未安装/未锁版 SDK，故不写任何"已验证 SDK 行为"的结论。
- 未创建云函数、未改规则、未部署、未动线上数据；`project.config.json` 等业务文件未改。

## 7. M0 变更记录（本次实际写入的文件）

| 文件 | 动作 | 说明 |
|---|---|---|
| `docs/verification/cloudbase-capabilities-2026-10-17.md` | 新建 | 本报告 |
| `docs/verification/evidence/source-hashes-2026-10-17.txt` | 新建 | SHA-256 哈希清单 |
| `docs/verification/cloudbase-capabilities-2026-10-17.md` | 更新（2026-10-17 晚） | CLI 登录就绪后补入 §3 远端只读资源快照；E1 只读部分转 PASS；记录 H-3 不另建环境的裁决 |
| 其余业务/配置/文档 | 未改 | 既有暂存与工作区改动保持原样 |

**远端资源变更记录**：

- 只读盘点阶段（§3）：**未**创建/删除集合、**未**改规则、**未**写数据，仅只读命令。
- M0 能力试验阶段（§3.1，**已获用户明确授权**）：下表中的资源均按 fixture 前缀精确创建、精确删除，并已复核回收。

| 资源 | 动作 | 复核结果 |
|---|---|---|
| 云函数 `rakProbe`（`lam-5ot7g16t`，Nodejs20.19） | 创建 → 删除 | 部署成功；删除后状态"函数删除中"；`fn list` 仅剩 `oaValidation`/`quickstartFunctions` |
| 集合 `rak_probe_tx`、`rak_probe_limit` | 创建 → drop | `listCollections` 复核：仅剩原有 5 个 `oa_validation_*` |
| 存储对象 `probe/rakM0/*` | 上传 → 删除 | TTL 试验对象由函数内自删；其余 `deleteFile` 返回 `status 0`；`storage list` 复核为空 |

**补充（2026-10-18，H-8，经用户授权）**：

| 资源 | 动作 | 复核结果 |
|---|---|---|
| 集合 `rak_*`（20 个，清单见 MANUAL-OPERATIONS §L） | 创建（一次性函数 `createCollection`） | `created:20 / exists:0 / failedCount:0`；`listCollections` 复核共 **25** 个 = 20 个 `rak_*` + 原有 5 个 `oa_validation_*`（**未触碰既有集合**） |
| 云函数 `rakProbe`（第二次部署，仅用于建集合） | 创建 → 删除 | 部署成功、调用成功；`fn delete` 成功；`fn list` 已无 `rakProbe` |
| 索引（26 条，15 个 `rak_*` 集合） | 创建（文档型数据库命令通道 `createIndexes`，分批） | 复核 `listIndexes`：**26/26 存在**；`unique:true` **6** 条、`sparse:true` **2** 条，标志确实生效；无报错、无"已存在"冲突 |
| 数据库集合 ACL（20 个 `rak_*`） | 变更 `PRIVATE` → **`ADMINONLY`**（API `TCB.ModifyDatabaseACL`） | 逐集合 `DescribeDatabaseACL` 读回 **20/20 = ADMINONLY** |
| 云存储 ACL | 变更 → **仅管理员可读写**（`storage set-acl`） | `storage rules get` 复核 = 仅管理员可读写 |
| 云函数 `rakApi`（`lam-0upamazt`）/ `rakFiles`（`lam-0lpqdzlt`）/ `rakMaintenance`（`lam-i94lcvyb`） | 部署（Nodejs20.19，CLI `fn deploy`，源为 `cloudfunctions/` 逐字节复制） | `fn list` 三个函数均"部署完成"；**冒烟**：`rakApi` 对合法信封返回 `not_implemented`（运行时未绑定，符合 fail-closed 预期）；`rakFiles` 收到 `auth.bootstrap` 返回 `validation_failed`（跨函数路由栅栏线上生效） |

> 未创建 `rak_upload_credentials` / `rak_storage_attempts` / `rak_jobs` / `rak_rate_limits` / `rak_stats`（服务端代码无引用；
> 前两者属已否决的 exact-key 方案）。**H-8 集合、H-9 索引、H-10 规则、H-12 函数部署均已完成**（上表）；**仅剩 H-11（函数调用权限，须控制台设置）**，随后进入 M8「SDK 运行时绑定 → 平台初始化 → 受控开通」。

**补充（2026-10-18，小程序内「开通新团队」功能，经用户授权）**：

| 资源 | 动作 | 复核结果 |
|---|---|---|
| 集合 `rak_club_applications` | 创建（一次性探针函数 `createCollection`） | `{"ok":true,"created":true}`；探针函数已 `fn delete` 精确删除 |
| 索引 4 条 | 创建（`db nosql execute` 的 `CommandType=COMMAND` + `createIndexes`） | `listIndexes` 读回 4/4：`club_applications_by_club_status`、`club_applications_by_applicant`、`clubs_slug_unique`、`clubs_display_code_unique`；`unique:true` **2 条** |
| 集合 ACL | `TCB.ModifyDatabaseACL` → `ADMINONLY` | `DescribeDatabaseACL` 读回 `AclTag=ADMINONLY` |
| 云函数 `rakApi` | 重新部署（新增 `team.newApplication.*` 五动作） | 部署成功；冒烟 `team.newApplication.submit` 返回 **`identity_required`**（非 `not_implemented`） |

> 部署前只读预检：`rak_clubs` 2 条，`slug`/`displayCode` 无重复，唯一索引可安全创建。
> 通道更正：`TCB.CreateCollection` 已下线；`RunCommands` 不接受裸 `create`/`createIndexes`，
> 须用 `[{TableName, CommandType:"COMMAND", Command:"<JSON 字符串>"}]`。

未改动：既有 `oa_validation_*` 集合与函数、存储权限规则、静态托管；已创建 20 个 `rak_*` **空集合（仅结构，无数据）**，**未写入任何正式业务数据**。

**下一步（按 PLAN 顺序）**：

1. **待用户裁决（阻塞 M5 设计）**：下载路径二选一 —— (a) 实现有实际限期能力的受控下载适配；(b) 阻止附件正式上线。
2. **待真机/真实微信（H-18/H-19）**：U2（10 MiB 客户端字节上传）、U4（256 KiB 分片客户端片传与事件上限，用于最终确认 `function-chunks-v1`）、W1（客户端 invoke 拒绝、定时来源）、MT-P0-a（真实身份跨队拒绝）。
3. **待控制台（用户）**：H-2 AppID 绑定复核、H-5 配额、H-9 索引创建、H-10 数据库/存储规则改 deny、H-11 函数调用规则、C1 小程序码、O1 备份/费用。
4. **可继续的自动工作**：M5 的 `function-chunks-v1` 服务端骨架（分片元数据/组装/校验）可依裁决推进；真实字节与 TTL 相关项在真机前保持 NOT_RUN。

## 8. 补充（2026-10-18）：H-7 SDK 锁版 + 本机可验证的 M8 运行时绑定

**范围**：仅**本机可验证**部分（代码 + 假 SDK 单测 + 产物）。**未做任何云端写入**（未重新部署函数、未改规则/索引、未写业务数据）。
规格与任务：[spec.md](../../.planning/2026-10-18-m8-runtime-binding/spec.md)、[tasks.md](../../.planning/2026-10-18-m8-runtime-binding/tasks.md)。

| 项 | 结论 | 证据 |
|---|---|---|
| **H-7** SDK 锁版写入产物 | **完成** | 锁 `wx-server-sdk@4.0.2`；写入三产物 `cloudfunctions/{rakApi,rakFiles,rakMaintenance}/package.json` 的 `dependencies`；`manifest.sdkCandidate={name:'wx-server-sdk',version:'4.0.2',locked:true}`；`verify:cloud:artifacts` 通过 |
| **D1** DB 接口异步化 | 完成 | `server/repositories/store.ts` 的 `Database`/`Tx` 改为 `Promise<T>`；全服务端 200+ 调用点加 `await`（`tx.set(` **103/103** 已 await）；server `tsc` 490 error → **0**；`test:server` 108 → **120** |
| **D3** 运行时装配 | 完成（本机） | 新增 `server/shared/cloud-sdk.ts`（SDK 端口 + 懒加载）、`server/entrypoints/runtime.ts`（`createApiRuntime/createFilesRuntime` + `readRuntimeConfig` + `loadApiRuntime/loadFilesRuntime`，缺 SDK 或必填环境变量 → **null**） |
| **D4** DB 适配 | 完成（本机） | 新增 `server/repositories/sdk-database.ts`：`read`/`query`/`tx`；`query` 分页全扫 + 扫描预算 `MAX_SCAN_DOCS=20000` → `stats_unavailable` |
| **D5** 存储适配 | 完成（本机） | 新增 `server/storage/sdk-adapter.ts`：`uploadObject` 用 SDK `fileID`；`downloadObject` 取 `fileContent`；`deleteObjects` 逐项保序（缺失项非 0）；`fileIdForPath` 用**配置的**前缀；`downloadTtlSeconds=null`（**不伪造**） |
| 假 SDK 用例 | 完成 | `server/tests/m8-runtime-binding.test.ts`（12 用例） |
| 门禁 | 全绿 | 前端 **78**、服务端 **120**、server `tsc` **0**、根 `tsc --skipLibCheck` **0**、`verify:release`（含 client:cloud）通过 |

**偏差 / 待优化（如实记录）**：

1. `Database.query(predicate)` 是**任意 JS 谓词**，SDK 无法下推 → 实现为**全量分页扫描 + JS 过滤**（页 500、预算 20000）；属待优化项（可改投影/索引下推）。
2. 事务仅 **doc 级** `get/set/remove`（DESIGN §12）；`runTransaction` 的**返回外壳结构未实测** → 端口声明为 `unknown`，适配层用**闭包捕获**回调返回值（不按猜测取值）。
3. 「文档不存在」按 `errCode === -502004` 与平台文案（探针实测形如 `document with _id X does not exist`）双重判定；**该 errCode 待云侧实测确认（NOT_RUN）**；集合不存在（`-502005`）**不**视为文档不存在，如实抛 `internal_error`。
4. `fileIdForPath` 依赖**配置的** fileID 前缀（`RAK_STORAGE_FILEID_ROOT`），非手拼猜测；SDK 能力面未列 `getUploadMetadata`，而 U5 已证明同路径 fileID 可确定性构造。
5. worker（`rakMaintenance`）平台来源 / SOURCE 校准仍 **NOT_RUN**。

**仍属 NOT_RUN（需真实云/真机）**：真实微信身份的 DB 读写、事务冲突的**真实** errCode 与重试行为、真实字节上传/下载、worker SOURCE 校准、U2/U4、MT01–MT22 真实项。

### 8.1 云侧部署与冒烟（2026-10-18，经用户授权）

| 步骤 | 动作 | 结果 |
|---|---|---|
| 环境变量配置 | `cloudbaserc.json` 的 `functions[].envVariables`（`RAK_JOIN_SECRET` 本机生成、未回显）→ `tcb config update fn rakApi/rakFiles` | 两函数「配置更新成功：`envVariables=4项`」；只读回读 **4 键**齐全 |
| 重新部署 | 项目根 `fn deploy {rakApi,rakFiles,rakMaintenance} --force --install-dependency true`（读 `cloudbaserc.json` 的 envId/functionRoot/envVariables） | 三函数均「云函数部署成功」 |
| 部署后复核 | `config pull` 回读 | `rakApi`/`rakFiles` 环境变量**仍在**（4 键）；`rakMaintenance` 无（按设计） |
| 冒烟 1 | `fn invoke rakApi`（合法信封 `auth.me`，GLOBAL） | `{"ok":false,"error":{"code":"identity_required","message":"缺少可信微信身份，请重试","retryable":false}}` ✔ |
| 冒烟 2 | `fn invoke rakFiles`（合法信封 `file.status`，TEAM） | 同上 `identity_required` ✔ |

**首次冒烟暴露并修正的真实缺陷**：运行时装配时**未调用 `cloud.init()`** → 云端 `sdk.database()` 抛
`Cloud API isn't enabled, please call init first`（本机假 SDK 无法复现该前提）。已修正：`CloudSdk` 端口把
`init` 纳入必需能力面与形状校验，`createApiRuntime/createFilesRuntime` **先 `sdk.init({ env: 配置环境 })`**
再绑定数据库/存储；用例同步断言 `init` 被调用且 `env` 为**配置值**。修正后重新构建、重新部署，冒烟通过。

**结论（真实云证据层）**：云函数运行时**已真实绑定** —— SDK 已安装（云端装 `wx-server-sdk@4.0.2`）、
`init` 已生效、数据库与存储绑定成功、函数环境变量读取成功、信封校验与身份守门在线上生效并返回**稳定业务码**。
管理侧 `fn invoke` 的 `getWXContext()` 为空 → `identity_required` **符合预期**（**不是** `not_implemented`，
故不能据此判"附件/业务可用"）。

**仍属 NOT_RUN（需真实微信身份/真机）**：真实身份下的 DB 读写与写栅栏、事务冲突的**真实** errCode/重试、
真实字节上传下载（U2/U4）、worker SOURCE 校准（W1）、H-14 之后的受控开通与 MT01–MT22。
**H-11（函数调用权限 = 环境级云函数安全规则）**：**已完成（2026-10-18，经用户授权由 AI 经 API 配置并读回复核）**。
实测改前为 `{"*":{"invoke":true}}`（所有来源含未登录均可调用）；已写入
`{"*":{"invoke":"auth != null"},"rakMaintenance":{"invoke":false}}`（`TCB.ModifyResourcePermission` → `Success:true`；
`DescribeResourcePermission` 读回一致）。**仅约束客户端调用**：管理侧 `fn invoke rakMaintenance` 仍成功。
**更正**：此前"CLI 无该字段 → 只能控制台"的结论不完整——官方接口可读写该规则。

### 8.2 平台初始化（H-14，2026-10-18，经用户授权）

**执行前补齐的最小受控 worker 入口**（原缺口：受控脚本要求 `rakMaintenance` 返回 `{initialized:true}`，
但该函数只返回 `not_implemented`，仓库内不存在任何 `platformInitialize` 处理入口）：

- `server/entrypoints/runtime.ts`：新增 `readPlatformConfig()`（仅 `RAK_APP_ID`+`RAK_CLOUD_ENV`，**不持有业务密钥**）、
  `MaintenanceRuntime` / `createMaintenanceRuntime()` / `loadMaintenanceRuntime()`。
- `server/entrypoints/rak-maintenance.ts`：按 `event.kind` 分发；`platformInitialize` → 幂等 `initializePlatform()`；
  未知 kind 或运行时缺失 → `not_implemented`；`appId` 与**配置**不一致 → `app_id_mismatch`（无副作用）。
  授权依据是平台强制的 `rakMaintenance.invoke=false`（H-11），**不**采信 `event.source/type/clubId`（W1 仍 NOT_RUN）。
- `scripts/bootstrap-cloud-platform.mjs`：修正响应解析 —— `tcb fn invoke --json` 的 stdout 是外壳
  `{data:{RetMsg}}`，函数原始返回值在 `data.RetMsg`（原脚本直接 `JSON.parse(out)` 会取不到 `initialized`，该假设此前未实测）。

| 步骤 | 动作 | 结果 |
|---|---|---|
| 环境变量 | `tcb config update fn rakMaintenance` | `envVariables=2项`（`RAK_APP_ID`/`RAK_CLOUD_ENV`；worker 不持有 `RAK_JOIN_SECRET`） |
| 部署 | `fn deploy rakMaintenance --force --install-dependency true` | 部署成功 |
| 执行 1 | `node scripts/bootstrap-cloud-platform.mjs` | 平台已初始化（`already=false`） |
| 执行 2（幂等） | 同上 | 平台已初始化（`already=true`，未重置） |
| **独立只读核验** | `tcb db nosql dump rak_system_config --file-type json` | `{"_id":"main","appId":"wxa8bf102dcfdcec4c","schemaVersion":1,"platformInitializedAt":1792305910614,"maintenanceFlags":{}}` ✔ 无 `clubId`/`ownerUserId` |

**注**：管理通道 `db nosql execute` 不支持文档级 `find`（仅库级命令）；文档级只读核验改用 `db nosql dump`（已实测可用）。

**仍属 NOT_RUN（需真实微信身份/真机）**：H-15/H-16/H-17 受控开通（参考号须本人真实微信触发 `auth.bootstrap`）、
MT01–MT22、worker 来源校准（W1）、真实字节（U2/U4）。

## 9. 补充（2026-10-18）：任务附件上传打通（资源/函数变更）

**范围**：`task.submit` 在事务内绑定 `rak_attachments`，`file.cancel` 允许丢弃未交付草稿，`file.init` 回收过期槽位。

| 资源 | 动作 | 复核结果 |
|---|---|---|
| 集合 `rak_attachments` / `rak_upload_batches` / `rak_upload_sessions` / `rak_upload_chunks` | **仅代码写入绑定**（无新增集合、无新增索引、无 ACL 变更） | 索引清单不变；集合 ACL 维持 `ADMINONLY` |
| 云函数 `rakApi` | 重新部署（`task.submit` 绑定逻辑） | **已部署（2026-10-18，经用户授权）**；冒烟 `task.submit` → `identity_required`（非 `not_implemented`）✔ |
| 云函数 `rakFiles` | 重新部署（`file.cancel` D1 / `file.init` D2） | **已部署（2026-10-18，经用户授权）**；冒烟 `file.cancel` → `identity_required`（非 `not_implemented`）✔ |

> 客户端门禁说明：`scripts/verify-client-cloud.mjs` 的 FORBIDDEN 已移除 `rakFiles`（客户端受控分片上传的公开函数，DESIGN §11）；
> `rakMaintenance`、`server/modules/`、`@cloudbase/node-sdk` 仍禁止出现在客户端产物。
>
> 下载/预览能力未改变：`file.downloadUrls` / `file.previewDraft` 继续 `not_implemented`，不伪造 `expiresAt`。
