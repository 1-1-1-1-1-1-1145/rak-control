# M5 执行日志：私有附件、跨成员授权与团队化后台（本机可执行部分）

日期：2026-10-17（Asia/Shanghai）。执行者：AI（严格按 PLAN §M5 与 DESIGN §11 执行）。
真源：PLAN §5（依赖顺序与阶段出口）、§M5、§3.2；DESIGN §11.1/§11.2/§11.3、§5.2、§12。
说明：本文件是**过程日志**。M5 的**真实字节传输**依赖 M0 上传/下载协议裁决，而
[M0 能力报告](./cloudbase-capabilities-2026-10-17.md) 已据实记录该裁决与全部云能力门禁为
**BLOCKED（未验证）**；因此本轮只完成「不依赖云能力」的 **fail-closed 骨架与拒绝用例**。

> **重要边界（不得越界解读）**：本轮产物是**骨架**，**不等于 M5 完成**。
> 依 PLAN §2.8「返回 `not_implemented` 的动作不是完成」与 §M5 出口「上传/下载能力关键门禁
> 未通过即不得称附件正式可用」，本文件**不**把任何 `file.*` 动作标为可用或通过。

## 1. 本轮已完成（含验证证据）

| # | PLAN §M5 / §3.2 要求 | 操作内容 | 产物 | 验证证据 |
|---|---|---|---|---|
| 1 | `server/storage/capabilities.ts`（§3.2 待创建，此前缺失） | 新增**能力声明**：`uploadTransport`/`maxObjectBytes`/`downloadTtlSeconds` 未裁决时一律为 `null`（**不写死** 10MiB、300 秒等未实测数字）；`resolveStorageCapabilities()` 返回未裁决快照；`assertStorageAdjudicated()` 未裁决即抛 `storage_unavailable` | `server/storage/capabilities.ts` | `m5-files-skeleton.test.ts`「存储能力未裁决：无假定值、未裁决即拒绝」用例通过 |
| 2 | `server/storage/adapter.ts`（§3.2 待创建，此前缺失） | 新增 `StorageAdapter` 接口 + 未裁决实现 `UnadjudicatedStorageAdapter`：`capabilities()` 恒为未裁决，`requireAdjudicated()` 即抛 `storage_unavailable`；`loadStorageAdapter()` 在 M0 裁决前恒返回该 fail-closed 实现（不签发凭证/不读字节/不删对象） | `server/storage/adapter.ts` | 同上用例「存储适配器：未裁决适配器拒绝一切传输要求」 |
| 3 | `server/modules/files/index.ts`（§3.2 待创建，此前缺失） | 新增附件模块 **fail-closed 骨架**：处理器**逐个动作**从注册表派生（`actionsFor('files')`），注册表内任何 `file.*` 都不会被静默漏掉；每个处理器先查能力门禁再抛 `not_implemented`（**不**签发凭证、**不**伪造 fileID/expiresAt、**不**静默忽略 `attachmentIds`） | `server/modules/files/index.ts` | `m5-files-skeleton.test.ts` 用例「注册表中每个 file.* 动作逐个 fail-closed，且不返回任何伪造字段」（覆盖表与注册表**严格一致**，新增动作未覆盖即失败） |
| 4 | `rakFiles` 入口注册（DESIGN §11、§12） | `entrypoints/rak-files.ts` 接线 `createFileHandlers(loadFilesDeps())`；`loadFilesDeps()` 只装配能力门禁（不伪造 DB/存储 SDK 绑定） | `server/entrypoints/rak-files.ts` | `dispatch.test.ts` 既有断言（`rakFiles`→`file.init` 为 `not_implemented`）保持通过；`test:server` 97/97 |
| 5 | `server/jobs/{file-verification,storage-cleanup,reconcile}.ts`（§3.2 待创建，此前缺失） | 新增三个后台任务**骨架**，各自导出 `JOB_TYPE` 与 `run()`，返回 `{ ok:true, handled:false, reason:'not_implemented', job }`（与 `entrypoints/rak-maintenance.ts` 现有骨架语义一致）；不读取 `event.clubId/source/type`（不把事件当系统权限），不产生任何校验/删除/对账副作用 | `server/jobs/file-verification.ts`、`storage-cleanup.ts`、`reconcile.ts` | `m5-files-skeleton.test.ts` 用例「后台任务骨架：三种任务均返回未实现，且类型互异」 |
| 6 | M5 本地测试（§M5「测试/验证」的本地可执行部分） | 新增 6 条用例：能力未裁决即拒绝、适配器拒绝传输、逐个 `file.*` fail-closed 且无伪造字段、`file.*` 必须 TEAM scope、payload 夹带 `clubId/actorRole` 被信封拒绝、后台任务骨架互异 | `server/tests/m5-files-skeleton.test.ts` | `test:server` 97/97（本轮 91 → 97） |
| 7 | 服务端类型检查**显式覆盖**（§3.2 目录归属的稳健性补强） | `server/tsconfig.json` 的 `include` 显式纳入 `modules/**`、`storage/**`、`jobs/**`，不再依赖导入链隐式覆盖（此前 `server/jobs/*` 仅因测试导入才被检查）；`tsconfig.build.json` **保持不变**（构建图仍由入口导入决定，避免把未接线代码打进发布包） | `server/tsconfig.json` | `tsc -p server/tsconfig.json --noEmit` exit 0；`test:server` 97/97 不变 |

## 2. 本轮门禁原始结果

```text
corepack pnpm test                 → tests 71 / pass 71 / fail 0
corepack pnpm test:server          → tests 97 / pass 97 / fail 0（本轮 +6：m5-files-skeleton）
corepack pnpm exec tsc -p server/tsconfig.json --noEmit → exit 0（0 错误；含显式纳入的 modules/storage/jobs 后复跑）
corepack pnpm exec tsc --noEmit --pretty false --skipLibCheck → exit 0（0 错误）
corepack pnpm build:cloud          → 成功，生成 3 个自包含函数目录：
   cloudfunctions/rakApi         digest=a114e992a1e1eea2…
   cloudfunctions/rakFiles       digest=cdbc4707b0081942…
   cloudfunctions/rakMaintenance digest=04c96a39cd3752fe…
corepack pnpm verify:cloud:config  → 通过：集合/规则/索引清单一致，无客户端公开读写与 worker 客户端 invoke
corepack pnpm verify:cloud:artifacts → 通过：3 个自包含函数目录结构/哈希/无禁用串
corepack pnpm verify:no-client-db → 通过
corepack pnpm verify:routes        → 通过：31 个路由均有页面/配置与守卫
corepack pnpm verify:client:cloud  → 通过：cloud prod 产物无演示数据/测试注入/服务端 SDK，且已内联云环境 cloud1-d4g36r8z6a8908540
corepack pnpm verify:release       → 通过（cloud:config / no-client-db / cloud:artifacts / routes / client:cloud 全部通过）

corepack pnpm test:cloud:integration → **exit 1（fail-closed，符合 PLAN §4 要求）**：
   BLOCKED：缺少真实环境/身份/独立只读断言所需配置；逐项缺失：
   RAK_CLOUD_ENV / RAK_APP_ID / RAK_FN_INVOKE_TEMPLATE / RAK_ADMIN_READ_TEMPLATE / RAK_FIXTURE_FILE；
   未产生任何真实云结论，未 skip 成 PASS。
node scripts/bootstrap-cloud-platform.mjs → **exit 1（fail-closed）**：列出 RAK_CLOUD_ENV / RAK_APP_ID / RAK_PLATFORM_INVOKE_TEMPLATE
node scripts/provision-cloud-team.mjs    → **exit 1（fail-closed）**：列出 3 个环境变量 + 5 个必填参数与用法
```

## 3. 本轮未完成（M5 待完成项，不得视为通过）

以下均因**同一个外部阻塞**：M0 上传/下载协议裁决与云能力门禁为 BLOCKED（本机无 CloudBase
环境访问权限与真实微信身份）。解锁条件见 [MANUAL-OPERATIONS](../MANUAL-OPERATIONS.md) H-1/H-4。

- [ ] **真实字节传输（`file.putChunk` / 受限 PUT）** → **NOT_RUN**：M0 未裁决传输协议，骨架**不假设**任何协议。
- [ ] **`file.init` 两阶段（事务内定 session/attachment、事务外签发）** → **NOT_RUN**：签发需真实能力与 `actualExpiresAt` 依据。
- [ ] **session/attempt/credential/chunk/attachment/batch 仓库与状态机** → **NOT_RUN**：未创建（无消费者，避免假设协议）。
- [ ] **freeze-before-verify（不可覆盖 candidate / 分片 manifest / hash / 流式组装 / recoverByPath）** → **NOT_RUN**。
- [ ] **期限管理（init+30 分钟 / confirm+24 小时 / 凭证实际到期 / GC +5 分钟）** → **NOT_RUN**：骨架不写死任何数字。
- [ ] **`file.status/confirm/cancel`、`file.downloadUrls`、`file.previewDraft` 真实实现与逐件授权反查** → **NOT_RUN**。
- [ ] **后台 worker 全链（平台来源校验、从 job 读 clubId、跨队 attempt 拒绝、发布事务栅栏）** → **NOT_RUN**：骨架只返回未实现。
- [ ] **UI 上传进度/失败重试/取消/确认/结果未知** → **NOT_RUN**；页面按「不可打开」如实标注（M7 #28），未伪造成功。
- [ ] **真实 0B/10MiB/超限、并发、TTL、GC/恢复竞争、部分删除失败** → **NOT_RUN**（M8 真实环境）。
- [ ] **M8 隔离云部署与真实双团队攻防、M9 真机/双设备验收** → **NOT_RUN**：本机无云访问与真实微信身份。

## 4. 说明与偏离记录

- **无方案偏离**。新增 `server/storage/*`、`server/modules/files/*`、`server/jobs/*` 三项均在
  PLAN §3.2「待创建」清单内（`storage/{adapter,capabilities}.ts`、`modules/files/`、
  `jobs/{file-verification,storage-cleanup,reconcile}.ts`），此前从未创建。
- **`FilesDeps` 只含能力门禁**：骨架阶段无需数据库/存储 SDK 绑定（无动作产生副作用），
  故 `loadFilesDeps()` 只装配 `StorageAdapter`，不伪造 DB 绑定；真实实现时再扩展。
- **错误码选择**：`file.*` 保持 `not_implemented`（沿用既有语义，`dispatch.test.ts` 既有断言不变）；
  能力门禁单独用 `storage_unavailable`。二者均为 fail-closed，语义分工明确：
  「功能未上线」 vs 「能力未裁决」。
- **`server/jobs/*` 未进入 `cloudfunctions/rakMaintenance` 产物**：当前仅由测试/类型检查覆盖，
  `tsconfig.build.json` 的入口图不含它们；待 M5/M8 worker 真实接线时再纳入构建，避免发布未使用代码。
- **`server/tsconfig.json` 显式 include `modules/storage/jobs`**（本轮新增，见 §1 #7）：仅使类型检查
  覆盖**可显式验证**（不再依赖导入链），不改变任何运行时/构建行为（`tsconfig.build.json` 未改动）。
- **能力快照不写死实测数字**：`maxObjectBytes`/`downloadTtlSeconds` 未裁决时为 `null`，
  待 M0 裁决通过后由运维结论填充真实值（不在源码中固化未验证数字）。

## 5. PLAN §M5 原始 checklist 逐条对照（本轮收尾审计）

| # | PLAN §M5 条目（原文要点） | 判定 | 证据 / 原因 |
|---|---|---|---|
| 1 | 只实现 M0 已通过 transport；init 预占固定 3 槽、1..10MiB、只递增 batch revision；session 绑定 club/task/uploaderMember/revision/round 不可重绑 | **NOT_RUN** | M0 传输协议未裁决；骨架不假设协议（`capabilities.ts` 未裁决即拒绝） |
| 2 | init 两阶段（事务内定 session/attachment、事务外签发）；凭证预登记、`actualExpiresAt` 有真实依据；返回前重查权限与 fence | **NOT_RUN** | 需真实能力；骨架抛 `not_implemented` |
| 3 | 云存储 SDK 客户端直访拒绝；签名 PUT 只能云函数签发 exact-key 限权上传；路径由服务端生成 `clubs/{clubId}/...` | **部分 PASS** | 客户端直访拒绝：`infra/cloudbase/storage-rules.json`（`clientAccess` read/write=false）由 `verify:cloud:config` 硬门禁通过；exact-key 签发与路径生成属真实实现 → **NOT_RUN** |
| 4 | freeze-before-verify（唯一不可覆盖 candidate→有界读取/hash；分片不可变片/manifest；`recoverByPath`） | **NOT_RUN** | 依赖 M0 裁决 |
| 5 | 期限管理（init+30 分钟 / confirm+24 小时 / GC 晚于最晚凭证 +5 分钟）；VERIFYING 可取消、迟到 worker 不发布 | **NOT_RUN** | 骨架不写死未实测数字 |
| 6 | 交付只接白名单 integrityState/scanState；BLOCKED/未知拒绝；**无病毒扫描如实标注** | **部分 PASS** | 如实标注：附件在 UI 明确「不可打开」且不伪造成功（M7 #28）；白名单与扫描状态机 → **NOT_RUN** |
| 7 | `downloadUrls` 只接 `attachmentIds`、逐件同队授权反查；草稿预览仅本人；URL 逐项、TTL≤300 秒、`fileID` 不下发 | **部分 PASS** | 契约收窄已在本地可验证：`ACTION_DATA_SCHEMAS['file.downloadUrls']` 仅允许 `attachmentIds`，多余字段被信封拒绝（`contracts.test.ts`「未知字段拒绝」同类断言 + 本轮「payload 夹带字段被拒」用例）；真实授权反查与 TTL → **NOT_RUN** |
| 8 | 临时 URL/凭证不入 DB/日志；cache 含完整 ctx+实际 expiry；切队立即清展示/URL；选择器/saveFile/下载回调校验 epoch | **部分 PASS** | 客户端侧（切队清展示/URL、epoch 栅栏）在 M7 完成（见 `m7-execution-log` #28/#37）；服务端 URL/凭证不落库 → **NOT_RUN**（无实现） |
| 9 | 一 session 一 staging attempt；candidate/chunk/final 唯一路径；GC 不可逆抢占 `GC_PENDING` 再精确删除；恢复与 GC 互斥 | **NOT_RUN** | 依赖 M0 裁决 |
| 10 | worker 只信平台调用、从 job 读 clubId 验全链；A job 配 B attempt 拒绝；ATTACHED 历史不因切队/TTL/维护删除 | **部分 PASS** | 骨架不读 `event.clubId/source/type`（不把事件当权限），且无副作用；真实 job 全链 → **NOT_RUN** |
| 11 | worker 无本人上下文，由 `session.uploaderMemberId` 反查 user；发布事务检查 NORMAL/member/club/任务权限并写栅栏与 fence | **NOT_RUN** | 依赖真实实现 |
| 12 | UI 进度/重试/取消/确认/结果未知/交付门禁/多轮展示；**0 附件可交**；停止调度 ≠ 撤回已发 PUT | **部分 PASS** | **0 附件可交**：`task.submit` 无附件路径已实现（`server/modules/tasks/index.ts`）；带 `attachmentIds` 时**明确抛** `not_implemented`（不静默忽略，`m4-tasks` 覆盖）；上传相关 UI → **NOT_RUN** |
| 13 | 测试：0B/10MiB/超限、第四槽、第二件不使第一件失效、同名/hash 异队、VERIFYING 取消、签发丢响应、选 3 交 1/0、旧轮、GC/恢复竞争、worker 异队、部分签名/删除失败、过期/丢响应/hash | **部分 PASS** | 本地骨架用例（6 条）覆盖「未裁决即拒绝 / 无伪造字段 / 无副作用 / 夹带字段拒绝 / 类型互异」；以上真实字节/hash/TTL 场景全部 **NOT_RUN**（需 M0+M8） |

**审计结论**：PLAN §M5 十三条 checklist 中 **0 条完整 PASS**；6 条为**部分 PASS**（仅本机可验证的
静态/契约/骨架部分）；真实字节传输、期限、GC、worker 与全部真实文件场景 **NOT_RUN**，且**未以任何
方式伪造**。M5 出口「所有文件元数据与后台团队归属闭环、上传/下载能力关键门禁通过」**未达成**。

## 6. 证据边界（不得越界解读）

- 本轮只验证 **fail-closed 行为与契约收窄**（未裁决必定拒绝、无伪造字段、无副作用）；
- **成功路径未在本机执行**：附件正式可用必须等 M0 上传/下载协议裁决 + M8 部署 + M9 真机；
- 骨架**不是**完成：依 PLAN §2.8，`not_implemented` 的动作不计入完成，也不会被当作可用能力暴露给页面；
- 本机无 CloudBase 环境访问权限与真实微信身份——这是 §3 全部 NOT_RUN 项的唯一根因。
（**该根因已部分解除**：用户已完成 CLI 登录并授权能力试验，见 §7。）

## 7. 补充（2026-10-17 晚）：M0 裁决落地 + `function-chunks-v1` 服务端实现

前置：用户完成 CloudBase CLI 登录（H-4）并授权在该环境做能力试验；M0 云能力门禁已**实测**
（证据见 [cloudbase-capabilities-2026-10-17.md](./cloudbase-capabilities-2026-10-17.md) §3/§3.1）。
试验探针函数按 fixture 精确创建并**已删除**，试验集合/存储对象均已复核回收（同上 §7 资源变更记录）。

### 7.1 两条裁决（执行真源；需与本文件并读）

| # | 议题 | 裁决 | 依据 |
|---|---|---|---|
| 1 | **上传传输协议** | **`function-chunks-v1`（受控分块）** | 首选「云函数签发 exact-key 受限 PUT + `copyFile overwrite:false` 冻结」的两项关键能力在锁版 SDK 均**不成立**（无凭证签发 API、无 `copyFile`、同路径可直接覆盖）→ 依 PLAN §M0「首选协议任何关键能力不成立则选 function-chunks-v1」 |
| 2 | **下载/预览路径** | **云函数代理（受控下载）—— 用户明确裁决** | `getTempFileURL` 的 `maxAge` **未被实际执行**（`maxAge=20` 的 URL 在 35s 后仍 HTTP 200，且未做缓存预热），无法满足「临时 URL 实际 TTL ≤ 300 秒且可验证」；DESIGN §11.2 允许「实现有实际限期能力的签名适配」替代 → 取此路径，**不伪造 expiresAt**、不下发 URL |

> 两条都是 DESIGN 明确允许的收敛，**不是静默偏离**。但 (2) 的落地机制（云函数响应体量/流式能力）
> **尚未实测**，故 `file.downloadUrls` / `file.previewDraft` 当前仍**显式 `not_implemented`**。

### 7.2 本轮实现（`function-chunks-v1` 服务端）

| # | 内容 | 产物 | 验证 |
|---|---|---|---|
| 1 | 集合登记 `rak_upload_chunks` / `rak_attachments`（infra 已声明） | `server/repositories/collections.ts` | `verify:cloud:config` 通过 |
| 2 | 存储适配层扩展 `uploadObject/downloadObject/deleteObjects/fileIdForPath`；**未裁决即拒绝** | `server/storage/adapter.ts` | 既有 fail-closed 用例不变 |
| 3 | `file.init`：3 槽预占、1B..10MiB、**只递增 batch revision（首建=1）不动 task revision**、绑定 club/task/uploaderMember/revision/round、`mutationId` 幂等（丢响应不另占槽）、30 分钟期限 | `server/modules/files/index.ts` | 槽位上限 / 幂等 / revision 不变 / 授权与 revision 不符 等用例 |
| 4 | `file.putChunk`：**副作用先登记**→事务外上传→回写 STORED；片长严格（中间片=256KiB、末片=剩余）、越界/非法 base64 拒绝、同 index 幂等（异内容冲突） | 同上 | 「分片」用例组 |
| 5 | `file.status`：只回状态与已收/缺失序号（**无 fileID/URL**） | 同上 | 同上 |
| 6 | `file.confirm`：完备性 → **有界读回+逐片 hash 复核+组装总长校验** → 发布唯一终态对象 → 事务落库（VERIFIED / `scanState=NOT_CONFIGURED` 如实标注 / +24 小时）→ 尽力清理 staging | 同上 | 含**读回被篡改必须拒绝发布**用例 |
| 7 | `file.cancel`：`fence++`、转 `GC_PENDING`、释放槽位；**已确认不可取消** | 同上 | 「取消」用例（含不可取消、槽位复用） |
| 8 | `file.downloadUrls` / `file.previewDraft`：**显式 `not_implemented`**（不以临时 URL 冒充受控下载） | 同上 | 专门用例 |
| 9 | 入口 `loadFilesRuntime()` 在 M8 绑定 SDK；未绑定即空处理器表 fail-closed | `server/entrypoints/rak-files.ts` | `dispatch.test.ts` 既有断言不变 |
| 10 | 本地用例 11 条（状态机/不变量/越权/过期/篡改/无静默漏项） | `server/tests/m5-files-chunks.test.ts` | `test:server` **97 → 108** |
| 11 | **客户端分片上传链路**：`src/utils/attachment-upload.ts`（纯编排：`planChunks` 256KiB 切分、**有限并发 2**、同片一次重试、**服务端回显必须与本地计划一致**否则拒绝、任一分片失败即**取消并显式抛出**、不下发 fileID）+ `src/services/cloud/attachment.ts`（`rakFiles` 调用封装 + Taro 按偏移读 base64 + 进度/取消/状态） | `src/utils/attachment-upload.ts`、`src/services/cloud/attachment.ts` | 前端用例 **71 → 78**（+7：分片数学/编排顺序/并发上限/失败取消/缺片对账/契约不符/超限） |

### 7.3 本轮门禁原始结果（§2 为上一阶段快照，以本节为准）

```text
corepack pnpm test                      → tests 78 / pass 78 / fail 0（+7：attachment-upload）
corepack pnpm test:server               → tests 108 / pass 108 / fail 0（+11：m5-files-chunks）
corepack pnpm exec tsc -p server/tsconfig.json --noEmit → exit 0
corepack pnpm exec tsc --noEmit --pretty false --skipLibCheck → exit 0
corepack pnpm build:cloud               → 成功：rakApi 0eabd22ee782434c… / rakFiles e63138ce00c2a909… / rakMaintenance ac705b071e633c4a…
corepack pnpm verify:cloud:artifacts    → 通过
corepack pnpm verify:release            → cloud:config / no-client-db / cloud:artifacts / routes(31) / client:cloud 全部通过
```

### 7.4 仍未完成（**不得**视为可用，覆盖 §3/§6 对应项）

- **真实字节/真机**：U2（10MiB 客户端字节上传）、U4（256KiB 客户端片传与事件上限）→ 需真实微信+真机（H-18/H-19）；**通过前附件不得声称可用**。
- **受控下载落地**：云函数代理下载的响应体量/流式能力待实测（需再做一次探针试验）。
- **SDK 绑定**：`loadFilesRuntime()` 仍返回 null（M8 装配）；本机实现仅由替身层驱动，**不代表真实云鉴权**。
- **后台 worker**：`file-verification`/`storage-cleanup`/`reconcile` 仍为骨架（`handled:false`）；GC 只标记 `GC_PENDING`，不实际回收。
- **客户端上传链路**：服务端契约与客户端编排/适配均已固定（§7.2 #11），但**页面入口接线**（任务详情"添加附件"→上传→带 `attachmentIds` 提交）与真实 `chooseMessageFile/saveFile` 流程**未接线**，需真机验证（H-18/H-19）。
- **§5 十三条 checklist**：第 1/2/5/9/11 条仍为 NOT_RUN（期限/attempt/GC 细节与 worker 发布未实现）；第 3/6/7/8/10/12/13 条由本轮推进为**部分 PASS**（见上表）。
