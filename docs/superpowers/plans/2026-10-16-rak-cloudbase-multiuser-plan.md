# Rak CloudBase 多成员正式使用：AI 可执行实施计划

> **2026-10-17：本计划不再作为执行主入口。** 请按[多团队实施计划](2026-10-17-rak-multi-team-isolation-plan.md)及其[设计](../specs/2026-10-17-rak-multi-team-isolation-design.md)直接构建cloud-v2；本文件只供未冲突的基础云能力/业务/附件细则参考。以下“排除多社团切换”、单队owner与资料、v1无scope、单队缓存等已被覆盖，不应先实现后返工。当前目录有Git，以下“无.git”是旧快照；保护既有暂存修改，不reset/stage/commit。本文件复选框不表示已经开发或验证。

日期：2026-10-16（Asia/Shanghai）
状态：**只编制方案，所有实施项尚未开始**。
设计真源：`../specs/2026-10-16-rak-cloudbase-multiuser-design.md`（以下称 DESIGN）。
工作目录：`C:/Users/24800/Desktop/小程序/rak-control`。命令默认在该目录 PowerShell 执行。

## Goal / Scope / Architecture

目标：现有 Rak 任务、公告、成员/入会/邀请、ROI、绩效、可选任务附件变成云端共同使用；新设备/清缓存用同微信账号恢复已提交数据。

范围：Taro/React/MobX 前端适配；CloudBase 云函数、文档数据库、私有云存储；身份/权限/事务/幂等/文件补偿；正式初始化、环境配置、测试、部署/上线文档。

排除：迁移演示数据、OA主题、订阅消息、支付/银行对账、独立文件库、多社团切换、无关UI重做、绕过微信审核。用户已确认云端从空业务数据起步；仅保留本人可信owner和社团配置初始化。

架构：页面/Store → 领域服务 → cloud adapter → `rakApi/rakFiles` → 云端可信身份/授权 → 模块/仓库 → 云DB/私有对象。`rakMaintenance`仅可信后台。数据库客户端read/write全拒绝；业务文件下载经attachmentId授权；正式数据不回退demo。

本文件是后续实施依据，**不是已经完成的开发记录**。本轮只创建本文件与设计文档，不部署、改规则或业务代码。

## 执行规则（交给下一位AI）

1. 先完整阅读 DESIGN、当前项目说明及适用AGENTS，不仅依赖聊天摘要；用户当前指令优先于旧rak-auth文档。
2. 每阶段按行为测试→实现→真实验证推进；测试替身不能证明CloudBase权限/事务/文件有效。标记证据层，不用“测试都通过”含混总结。
3. 不伪造API/SDK方法、云资源状态或登录账号。缺环境能力时执行P0明确备选；不要填example.invalid通过构建后声称在线可用。
4. 不向用户索取AppSecret/API key，不打印本机凭据。需要扫码登录/开通计费/本人微信/第二测试账号时指出具体人工步骤，其余代码与可验证操作自行完成。
5. 不覆盖用户现有改动。此目录当前无.git：阶段前做精确文件备份+哈希，检查实际Git状态后决定；不要强制init、commit/push、硬重置或清理整个工作区。
6. `src` 是前端、`server` 是新云端源、`cloudfunctions`是自包含上传产物、`dist`是Taro产物。共享代码不从云函数目录外动态require。
7. 新脚本/文件路径、测试在下文均标为待创建。命令只有在对应任务建好之后才可执行。不能给不存在的脚本打勾。
8. 云化是新范围，旧2026-09-19 HTTP后端计划不与本计划并行执行。先ADR记录替代范围、同步文档；保留其历史依据。
9. 每个写接口都登记schema/角色/资源范围/事务/幂等/审计/错误；禁泛数据库代理、客户端role可信、任意fileID签名。
10. SDK版本、事件上限、TTL、查询上限、Node运行时都以P0能力报告为准；部署时不能自由换版本或放宽read/write规则。

## Verification：现有命令与拟新增命令

**当前已存在**（本轮未重跑）：

```powershell
pnpm test
pnpm exec tsc --noEmit --pretty false --skipLibCheck
pnpm build:weapp
pnpm build:weapp:prod
```

当前test脚本是 `node --experimental-strip-types --test tests/*.test.ts tests/*.test.mjs`，现17用例。旧生产构建要求真实HTTPS API_BASE；在P2改造前，不能无环境执行prod后期待成功。

**拟在P1/P2新增**：

| 命令 | 责任/预期 |
|---|---|
| `pnpm test:server` | server/tests/**/*.test.ts 的领域/仓库契约/故障测试 |
| `pnpm test:cloud:integration` | 有隔离环境和真实身份时运行；缺配置明确非零退出，不能跳过后全绿 |
| `pnpm build:cloud` | 编译三自包含云函数部署包 |
| `pnpm verify:cloud:artifacts` | 每目录index.js/package.json/生产依赖完整，哈希清单，未打包凭证/本机配置 |
| `pnpm verify:no-client-db` | 扫描src/build，拒绝客户端DB调用/间接泛DB代理；配合人工/云拒绝用例 |
| `pnpm verify:cloud:config` | 集合/索引/规则/环境与部署清单一致，不含public-write与worker客户端invoke |
| `pnpm verify:release` | 组合静态/包内容门禁，明确不代替云/真机验收 |

测试运行时优先复用现有Node内置test与TypeScript strip；如目标Node与TS语法不兼容，构建到测试JS后执行，禁止临时安装一整套测试框架而不解释。

所有云集成运行工具需分离“可信微信身份调用器”和“管理员只读断言器”：不能用管理员SDK代替member调用来证明授权正确；也不能允许测试专用event.openid在发布包生效。没有第二账号时对应真身份用例保持未完成。

## 依赖图与阶段出口

```text
P0 环境/能力证据与上传协议裁决
  → P1 ADR、数据契约、构建骨架、规则/索引清单
  → P2 前端cloud模式与云调用/身份契约
  → P3 云端鉴权、初始owner、入会/邀请/成员
  → P4 任务状态机/幂等/交付历史
  → P5 私有附件完整闭环（依赖P0上传裁决/P4轮次）
  → P6 公告/ROI/绩效/社团功能全量覆盖
  → P7 全页面守卫/缓存/并发与错误体验整合
  → P8 隔离环境部署与恶意/故障测试
  → P9 双账号真机/恢复演练/正式验收交付
```

P3后可并行开发P4/P6，P5依赖任务轮次契约；同一个文件Store/类型多人修改需主实施者协调。不用“先全部前端写完再发现服务端身份契约不适配”的顺序。

## P0. 只读盘点与能力验证——阻止从假设开工

**读取现有文件**
`project.config.json`、`package.json`、`pnpm-lock.yaml`、`config/{build-mode,index}.ts`、`src/app.ts`、`src/services/*`、`src/types/domain.ts`、`docs/DEAD-CODE-CLEANUP.md`、两个旧rak-auth提案。

**待创建**
`docs/verification/cloudbase-capabilities-YYYY-MM-DD.md`、隔离能力试验fixture（不进入生产注册动作）、只读资源清单。

- [ ] 确认主项目、备份范围；记录是否有.git、已有改动/可恢复备份，不操作OA/其他项目。
- [ ] 核对AppID与环境；盘点远端函数/定时器/数据库/规则/存储；记录而不擅自删除旧订阅函数。
- [ ] 确认该环境文档数据库、事务、Node运行时、云SDK初始化、身份上下文；禁用/关闭HTTP公开触发入口，除非另有认证设计。
- [ ] 读取官方当前SDK文档与发布包；固定wx-server-sdk/@cloudbase版本、锁文件/完整性值；记录两个SDK的方法差异/返回结构。
- [ ] 在隔离非生产环境验证DB read/write false、storage read/write false；客户端仍可call允许函数，worker客户端拒绝。
- [ ] 验证doc事务行为、冲突/有限重试、runTransaction返回外壳、索引方向/唯一约束、复合游标条件和查询上限。
- [ ] 完成DESIGN §15 U1-U3：全部返回凭证只允许exact-key staging PUT，改key/method/final、读取/删除/列举/自行签其他对象均失败；证明实际最晚有效期、10MiB真机rawPUT、冻结禁止覆盖/有界验证。不能用multipartPOST替代。
- [ ] U1-U3任一关键门槛失败，记录原因并选择function-chunks-v1；验证事件body限制、片长、10MiB资源/成本/手机性能。P0只验证所需最小试验，别建立第二业务后端。
- [ ] 验证下载实际TTL≤300秒、批量逐项结果、提前30秒刷新；这是固定上线门禁，不是当前SDK已保证。不能做到时实现可控期限签名适配或阻塞附件上线，不拉长策略/编造expiresAt。
- [ ] 验证DESIGN §15 U5：对象副作用成功但SDK响应丢失时，storage adapter能按预登记路径恢复规范fileID、确认存在/字节并精确删除；不拼cloud://、不假设copy已存在错误带ID。验证候选getUploadMetadata同path返回规范ID且不覆盖的服务端恢复流程，返回的新授权只留服务端；未通过的transport/副作用类型不能标可恢复。
- [ ] 确认可信定时来源、openapi小程序码权限、预算/备份能力；无小程序码能力采用文本邀请码，业务核心不被二维码阻塞。
- [ ] 清理**本阶段授权范围内**的隔离试验资源；保留报告/测试输入及脱敏证据。

**验证方法**：微信真实非成员调用试验函数；有权管理端只读比对写前/写后数据；官方SDK类型/包源码核对；真实私有对象改key、过期、超限、重放测试。没有已验证CLI前不写虚构部署命令。

**出口**：能力报告逐项有PASS/FAIL/BLOCKED；上传transport已确定，未通过能力不进入后续“已完成”。没有云权限时可继续本地骨架/单测，但P8/P9保持阻塞。

## P1. 固化架构替代、契约和可独立部署骨架

**待修改**
`docs/CONSTRUCTION.md`、`docs/DEVELOPMENT.md`、`docs/OPEN-QUESTIONS.md`、`docs/adr/adr-0004-wechat-auth-client.md`、`adr-0005-state-and-request.md`、`docs/proposals/rak-auth-{wechat-auth,task-attachments}-contract.md`、`docs/TASK-ATTACHMENTS-GUIDE.md`、旧backend计划状态、`package.json`、`project.config.json`、`.gitignore`。

**待创建**
`docs/adr/adr-0006-cloudbase-business-backend.md`、DESIGN §4.2 server/infra/script骨架、`docs/api/cloud-v1.md`。

- [ ] ADR明确唯一云真源、保留产品规则、旧HTTP为legacy且无双写；给旧提案加“非当前实施路线”入口链接，不删除历史。
- [ ] 从DESIGN列出每个action的输入/输出、schema、角色、资源范围、错误、幂等；清除事件中可自报的openid/clubRole/createdBy。
- [ ] 定义云会话与HTTP会话不同DTO，CloudSession包含SETUP_REQUIRED及referenceExpiresAt；CloudAttachment与LocalDemoAttachment不同DTO；统一AppError保留code/retryable，明确setup_required/not_implemented的开发及发布门禁。
- [ ] 冻结schema/动作清单：file.previewDraft与downloadUrls分开；club.dashboard/profile.summary有明确计数投影；join/invite身份例外、code|sceneToken互斥联合、完整扫描/排名游标均进入API契约。
- [ ] 定义server领域/仓库接口，读写别散到入口；创建三个entry，只固定注册动作，未知action/version拒绝。
- [ ] 云函数依赖锁定；生产打包共享模块，自包含依赖，worker配置只给需要定时器的函数。没有timer的函数不必为形式统一乱加trigger。
- [ ] infra列出集合、索引、数据库/存储拒绝规则、函数白名单/worker禁invoke、环境清单；包括upload_batches、upload_credentials、storage_attempts与参考号hash索引（稀疏/部分唯一能力P0验证），仅部署选定transport需要的集合。业务初始化不和DDL混在公开函数。
- [ ] 根项目恢复cloudfunctionRoot；打包检查miniprogramRoot、requiredComponents、压缩/图标不被破坏。
- [ ] 新增server测试/构建/产物检查脚本，README/DEVELOPMENT写明运行条件；不添加生产秘密值。

**验证**：`pnpm test`（旧用例仍绿）；`pnpm test:server`（输入/分发/拒绝规则用例）；`pnpm build:cloud`；`pnpm verify:cloud:artifacts`；`pnpm verify:cloud:config`。

**出口**：三个上传目录可独立打包；尚无业务动作可绕开身份访问DB；旧新文档只有一个当前架构入口。

## P2. 增加cloud构建、云客户端与身份契约

**待修改**
`config/{build-mode,index,dev,prod}.ts`、`types/global.d.ts`、`src/constants/index.ts`、`src/app.ts`、`src/services/{domain-entry,auth,task,roi,club,member}.ts`、`src/utils/auth-contract.{js,d.ts}`、`src/store/index.ts`、`tests/build-mode.test.ts`。

**待创建**
`src/services/cloud/client.ts`、`src/services/backend.ts`、`src/utils/backend-error.ts`、`tests/{cloud-client,cloud-auth-contract,service-mode}.test.*`。

- [ ] 实现demo/cloud/http明确模式，cloud缺env/生产demo/矛盾变量均fail-fast；cloud不用API_BASE。
- [ ] 云初始化完成后才bootstrap；统一callFunction信封、requestId、版本、ok分支校验、传输vs业务错误。
- [ ] 请求不能自动fallback demo/HTTP；未知结果不映射empty数组。cloud错误能被旧页面/Store识别。
- [ ] authStore消费CloudSession；去掉cloud对accessToken的要求；与HTTP legacy契约分别验证，不注入伪造JWT。SETUP_REQUIRED只显示本人参考号/有效期和帮助，UNBOUND显示入会，不能误当ACTIVE或空数据。
- [ ] 同账号/环境缓存namespace和generation保护；退出/权限失败清全局业务Store及URL缓存。
- [ ] 各领域门面显式选择adapter，覆盖member/invite/club/qr；暂未完成动作明确not_implemented，不误走HTTP。

**有意义测试**：cloud不带API_BASE成功解析配置；env缺失失败；伪造cloud响应/权限数组非法fail-closed；函数传输成功但ok:false仍抛业务错；401/403清缓存；旧身份迟到响应被丢弃；不回退demo。

**验证**：`pnpm test`、`pnpm exec tsc --noEmit --pretty false --skipLibCheck`；配置测试隔离进程而非污染当前终端环境。

**出口**：云调用信封、CloudSession、模式选择和缓存隔离的本地契约测试通过，正式设置页无演示身份；服务端尚未实现时明确显示不可用。真实可信bootstrap在P3实现并验收，不以替身响应声称已登录云端。

## P3. 云端权限、受控owner、入会和成员全闭环

**待创建/修改**
`server/shared/{identity,authorization,validation,transaction,logging}.ts`、modules `{auth,club,members,invites,join}`、相应repositories；`scripts/bootstrap-cloud-owner.mjs`（仅受控运维）、`src/services/cloud/{auth,club,member}.ts`；登录/申请/管理成员/任免/邀请页面。

- [ ] 平台上下文只在handler内取；拒缺失身份/错AppID/错环境，单社团由配置解析；event伪造字段不可信。
- [ ] 每次bootstrap事务get-or-create确定性identity+唯一user，初始化前后首次进入均适用；并发同openid仅一个user。profiles与membership状态分离；每调用实时鉴权；join.submit/status、invite.redeem仅要求可信identity，既有DISABLED/LEFT不能绕过。
- [ ] 实现SETUP_REQUIRED和受控一次性owner初始化：本人随机参考号存hash映射/30分钟到期/有效期内复用，受控校验未使用且人工确认本人。初始化填写owner展示名，消费参考号，不将晋升放公开注册表。重复执行不改变owner；既有初始化不覆盖。
- [ ] 权限矩阵统一manager只能管理member；super可任免manager/member；任何业务接口不能降级/禁用/转移owner。
- [ ] 关键写事务membership mutationSeq栅栏，使禁用/任免竞争有明确排序；避免只读membership导致并发写绕禁用。
- [ ] 邀请创建/撤销/分页、codeHash与masked展示、12位输入改造；create仅当次显示完整码，不进通用命令缓存。丢响应同键恢复inviteId/maskedCode/shareCodeAvailable:false，UI撤销重建。兑换携displayName并与额度/member/user创建原子；重复兑换不多扣，禁用/离队不能凭邀请码恢复。
- [ ] 申请提交/本人状态、管理列表、审核revision互斥；同人当前申请唯一，重提留审计。ACTIVE提交申请返回already_member；邀请码入会同步收敛PENDING；审批遇已ACTIVE只收敛申请，不覆盖role/status/joinedAt/姓名，申请批准新成员才采用申请name。
- [ ] 名册visibility在云端落实；普通成员最小DTO，无openid、联系方式全量外泄。
- [ ] 小程序码按P0能力实现：sceneToken高熵且受长度限制，私有invite存token及hash，只用于受控二维码生成；兑换schema互斥code/sceneToken，两路使用同invite额度/过期/撤销/成员事务。token不进DTO/日志，不向非成员返回手工码；不可用时UI写明并提供文本码。

**测试**：信任event攻击、初始化前后并发首次bootstrap、参考号复用/过期/已消费、首次登录抢owner、manager提权/操作manager、owner禁用、已停用重新兑换、末次额度竞争、邀请码丢响应、两种兑换同额度、申请与邀请竞争、已manager的旧申请审批不降权、真实展示名、目录开关、脱敏DTO、跨club记录ID。

**验证**：`pnpm test:server`；P8真实隔离环境A02/A03/A04/P01/P02/I01/I02，不能用管理员SDK调用代替。

**出口**：真实隔离环境bootstrap能返回SETUP_REQUIRED/入会/ACTIVE等可信状态；真实owner能邀请第二个真实账号成为member，再任命manager；非成员无内部读权。

## P4. 任务状态机、命令幂等与独立交付历史

**待创建/修改**
`server/shared/command.ts`、modules/tasks、repositories/{tasks,submissions,commands,audit}；`src/services/cloud/task.ts`、`src/types/domain.ts`；`src/services/task.ts`编辑能力门面核对；任务详情/验收界面。

- [ ] 实现DESIGN任务六状态及条件，任务编辑仅OPEN，服务端作者/时间/负责人赋值。
- [ ] claim事务双人竞争恰一成功；submit事务创建独立round/submission并绑定0..3附件、检查taskRevision和targetRound。读最多3槽，所选转ATTACHED，其余session取消/fence++、DRAFT附件转GC_PENDING，再封闭batch；无附件/无batch也成立。按最坏读写预算验证事务上限。
- [ ] 首先无附件交付闭环，文件待P5接入；不得为让测试绿跳过attachment校验。
- [ ] approve/reject指定当前submission+expectedRevision，迟到审核拒绝；archive只APPROVED→DONE。
- [ ] 公共Task DTO不包含他人的交付/附件/私人备注；submission接口仅负责人/管理者。
- [ ] 命令UUIDv7+可信serverTime校准/年龄校验；inputHash覆盖apiVersion/action/data/expectedRevision并排除requestId；事务结果、24h/7d/30d窗口、查询重新鉴权，identity-only入会仅恢复本人最小结果，过期旧键不重做。
- [ ] 明确SUCCEEDED/DETERMINISTIC_REJECTED/ACCEPTED_JOB/ABSENT_IN_WINDOW/EXPIRED：暂未查到命令不等于失败，原事务可能仍提交；只能原mutationId+同payload有限重试，ACCEPTED_JOB不当文件已确认。resultUnknown不生成重复submission/审计/记录。
- [ ] 重交历史不覆盖/不删除旧文件；拒绝/通过记录不可被新轮覆盖。

**测试**：所有合法/非法迁移、claim并发、重复submit、审核与重交竞争、24h+7d+30d时间边界、提交前查询暂不存在/提交后响应丢失、同键不同expectedRevision冲突、成员禁用与submit竞争、权限变化后旧结果投影、选3交1或0时剩余草稿关闭。

**验证**：`pnpm test:server`、`pnpm test`；P8真实T01/T03/T04/P01。

**出口**：无附件真实任务流可双账号完成；数据库有独立交付/审计/幂等记录，无前端自造状态成功。

## P5. 私有附件、跨设备授权、回收与对账

**待创建/修改**
`server/modules/files/*`、`server/jobs/{file-verification,storage-cleanup,reconcile}.ts`、相应uploads/upload-batches/upload-credentials/storage-attempts/attachments/chunks/jobs仓库；`src/services/{attachment,cloud/attachment}.ts`；`src/utils/task-attachments.ts`、附件policy、`src/pages/task/detail.tsx`、管理验收/历史呈现；附件操作文档。

- [ ] 固定P0选择的transport与策略（签名PUT优先，门禁失败分块），init返回显式协议；不是客户端自行猜SDK参数。
- [ ] 服务端通过任务下一轮固定batch文档（长度3/索引0..2）预留名额；init/cancel/expire/submit共同写它，释放比较原sessionId，不能事务where计数。上传预占只递增batch.revision，不递增task业务revision；第二附件不能使首件失效。限制size/count/rate，会话绑定可信user/taskRevision/targetRound/环境，路径不接收用户输入。
- [ ] file.init第一阶段幂等事务只返回稳定session/attachmentId；第二阶段事务外签名，不缓存token/URL进commands。签发attempt记录原revision/fence及实际/保守到期，返回凭证前再鉴权/校验；丢响应同键恢复同槽，取消/停用/过期后不返回凭证。UNKNOWN按已证明最大有效期保守GC。
- [ ] 区分uploadExpiresAt=init+30分钟、confirmedUntil=confirm+24小时与latestSignatureExpiresAt；INIT/UPLOADING/VERIFYING/RETRYABLE_FAILURE检查前者，CONFIRMED提交检查后者；GC等实际授权到期+5分钟安全余量。不能用业务TTL代替平台签名到期。
- [ ] 签名PUT：私有规则仍拒直接SDK操作；仅exact-key staging；先copy唯一candidate overwrite:false再bounded读取校验；不能先校验staging再复制。
- [ ] 分块如启用：索引/片长/base64/hash严格校验、同片幂等、片不可变、<=2并发；确认冻结manifest、增量hash+/tmp流写、限制资源。
- [ ] confirm可返回处理中；worker租约/fence、失败可恢复；VERIFYING允许取消，释放槽/fence++，迟到worker不得复活。RETRYABLE_FAILURE仅到期前显式重试；CONFIRMED不再签上传凭证。
- [ ] 安全状态严格枚举：integrityState=VERIFIED，scanState仅NOT_CONFIGURED/PASSED/UNSCANNABLE白名单，session.state=CONFIRMED且attachment.lifecycleState=DRAFT、confirmedUntil有效才可提交；缺失/未知/BLOCKED均拒绝。submission引用一旦写入即ATTACHED，不再草稿GC。
- [ ] file.downloadUrls只收attachmentIds，真实membership/任务关系/ATTACHED/安全白名单检查；file.previewDraft只收attachmentId且限本人的当前有效CONFIRMED/DRAFT；file.status不签URL。逐项结果保输入顺序，不用原fileID假成功；临时URL实际≤300s、提前30s刷新，url/签名不日志不落DB。
- [ ] UI实现选择、进度、重试、取消、确认、提交门禁、历史文件、预览与下载保存；0附件可提交。
- [ ] 不支持预览格式显示可下载/不可打开，未知/加密文件标未扫描；已知恶意拒绝，不把MIME检查称病毒检测。
- [ ] 每session一个STAGING storageAttempt，共享多次credentialAttempt的最晚凭证边界；每candidate/chunk/final attempt独占唯一路径，不为每次重签建可独立GC却指向同staging的对象记录。所有副作用先登记路径，响应未知按P0实测recoverByPath恢复规范fileID，禁止拼ID；恢复采用/发布与GC写同一attempt文档。先事务不可逆标GC_PENDING再delete，只删该attempt对象；fence不能撤销已发对象删除请求。
- [ ] GC与submit写同一附件状态；只回收未引用草稿/失败candidate/chunks；依据attempt清单逐项对账、不虚构listFiles，delete逐项重试/墓碑、重放staging期满二次回收。10分钟扫描不是删除SLA；到期无引用对象24小时回收SLO，超时告警。
- [ ] 任务归档/重提不删历史；云模式彻底移除按localPath删除正式数据的逻辑，本地demo仍独立保留。

**测试**：DESIGN T02/F01-F07；另测name路径穿越、0B/10MiB/10MiB+1、fakeMIME、未知scanState拒绝、4并发init恰3槽、第二附件不使首件失效、VERIFYING取消/worker迟到、签发与取消竞态、签发丢响应不另占槽、选3交1/0关闭其余、草稿预览越权、GC与恢复采用竞争、copy后崩溃、DB失败对象孤立、删除一半失败、老片覆盖/不同hash、URL泄露检查。

**验证**：`pnpm test:server`、前端adapter单测、`pnpm test:cloud:integration`；两个真微信账号实文件互验，含手机网络/最大文件；字节hash核验对象冻结。

**出口**：成员A上传并提交后，管理者B在另一设备下载相同hash；无关memberC、非成员/已禁用均失败；历史完整、GC不误删。

## P6. 公告、ROI、绩效、社团与列表覆盖

**待创建/修改**
modules/{announcements,roi,performance,club}、repositories相应文件、`src/services/cloud/{club,roi,task}.ts`、公告/ROI/团队/首页页面、`src/utils/format.ts`、相关Store/类型/表单。

- [ ] 公告CRUD/发布/归档与草稿访问云端过滤，revision+幂等+审计；管理员和超管均有发布入口；保留标题/作者分行。
- [ ] ROI表单保留元字符串，server严格转分、安全整数、非负/小数位/人数/日期/上限校验；软删并留审计。
- [ ] 上海周期：accountingDate为YYYY-MM-DD字符串，使用同类型左闭右开日历边界，不拿UTC Date比较；无periodStart时沿用创建日。CANCELLED保留口径、近6月补0、all总额与趋势区别；0成本null比例。
- [ ] 绩效保持现定义，曾驳回从历史按task去重；禁止客户端传分。mine仅本人、list仅manager+，score desc/userId asc游标；dashboard仅manager+取top5。服务端穷尽聚合/内部分页，容量预算未完成返回stats_unavailable，不用SDK默认首批冒充全员；任免页不依赖全员绩效。
- [ ] 社团设置schema与名册开关，拒任意settings/任意logoURL写入；不擅自新增logo上传功能。
- [ ] 全列表cursor契约，公告三字段cursor与其余复合cursor分开；queryFingerprint/generation、筛选清空/失败不推进；无限数组改分页。
- [ ] 搜索字面量转义/长度/授权范围；记录无全文索引的规模边界；依据查询执行结果补索引，不声称普通索引加速子串。
- [ ] 首页/团队/个人卡片改调club.dashboard/profile.summary明确摘要，不伪造fetchTasks(size:1).total；manager才读待验收/榜单，名册关闭仍可授权在册总数、不泄露成员明细；空云环境合理空状态，标asOf但不承诺多查询单快照。
- [ ] 单行字段拒控制符；多行字段CRLF/CR统一LF，允许LF但拒其他控制符；前后端同规则，公告真实换行不误拒绝。

**测试**：草稿直读/详情泄露、发布失败不跳成功、中文公告LF/CRLF、0.1+0.2精度、上海跨月/季度/年、日期类型、取消/软删、0成本、绩效历史去重/同分游标/超默认批次/扫描预算失败、名册关闭计数仍正确、同timestamp>2页、分页失败/筛选迟到、缺索引报错、未知分类拒绝。

**验证**：`pnpm test:server`、`pnpm test`；云N01/R01/R02/L01；双账号发布后刷新可见、ROI另一设备一致。

**出口**：现有领域service能力逐项映射云action，无member/invite/club/qr旁路HTTP；所有云端空/失败状态正确。

## P7. 26页守卫、错误与缓存整合

**待修改**
`src/components/page-shell.tsx`、`src/utils/permission.ts`、新增统一guard、`src/store/index.ts`、`src/pages/**`、`src/subpackage-admin/**`、`src/pages/me/settings.tsx`、路由/环境相关测试。

- [ ] 从app.config生成26页清单，逐页列登录/角色/资源/生命周期数据请求；有source但未配置的页面不得误当可访问页面。
- [ ] guard在bootstrap完成后响应式加载，SETUP_REQUIRED/未入会/待审/停用/降权先阻止内部加载；引导页本人申请/兑换动作不被ACTIVE守卫误拦截；深链和下拉刷新同样保护。
- [ ] 管理权限缺失不先发查询；但测试同时直调函数确认服务端拒绝，不能只测按钮隐藏。
- [ ] TeamStore失败传播、ROI列表翻页失败不跨页、公告列表错误不冒充空；依赖成功后才能toast/导航。
- [ ] 身份切换/退出/禁用清全部Store、URL/详情/游标generation；迟到响应不回填；no offline privileged access。
- [ ] cloud隐藏演示角色/重置和样例标识；demo继续明确标记本地演示。云模式业务失败有重试/帮助，不出现演示人。
- [ ] 上传/提交双击门禁、处理中/结果未知状态、失效附件反馈；按钮热区和当前视觉不回退。
- [ ] 检查构建tree-shake/入口依赖，生产产物不可调用本地demo adapter；必要时mode专属entry/alias。只隐藏按钮不等于从发布包去掉危险调试入口。

**验证**：`pnpm test`、`pnpm test:server`、`pnpm exec tsc --noEmit --pretty false --skipLibCheck`、`pnpm verify:no-client-db`、`pnpm build:cloud`、`pnpm verify:cloud:artifacts`。

**cloud构建**（P2脚本完成后）：

```powershell
# TARO_APP_CLOUD_ENV 必须是P0已核实的隔离环境；正式版本改成核实后的prod环境。
$env:TARO_APP_BACKEND = 'cloud'
$env:TARO_APP_CLOUD_ENV = '<已核实的隔离环境ID>'
try {
  pnpm build:weapp:prod
  if ($LASTEXITCODE -ne 0) { throw 'Cloud production build failed' }
  pnpm verify:release
  if ($LASTEXITCODE -ne 0) { throw 'Release artifact verification failed' }
} finally {
  Remove-Item Env:TARO_APP_BACKEND, Env:TARO_APP_CLOUD_ENV -ErrorAction SilentlyContinue
}
```

执行者需先保存/恢复终端原有同名变量；上例假定原变量未设置。不得通过把真实生产环境写进默认构建配置规避验证。

**出口**：26页有守卫/数据加载矩阵；cloud构建无demo行为，按需注入/压缩/20张图标与既有排版仍保留。

## P8. 隔离云部署、真实入口攻防与故障注入

**待创建**
`docs/verification/cloud-acceptance-YYYY-MM-DD.md`、`docs/verification/evidence/`（脱敏截图/结构化结果）、`scripts/cloud-integration/`测试调用和断言工具、部署manifest。

- [ ] 授权范围内建集合/索引/规则→三函数→受控初始化→前端cloud构建，按DESIGN部署顺序，不开公开DB过渡。
- [ ] 记录函数版本/hash、SDK/运行时、DB/存储/调用规则实际快照（脱敏）；核对源与部署产物同一版本。
- [ ] A01-O01矩阵逐项执行；非成员/member/manager/super/disabled/left真实身份组，至少双真实微信必要场景不以模拟代替。
- [ ] 客户端直接DB读写监听/直接storage读写均失败；client伪造身份/任意fileID/外社团ID不影响数据；拒绝请求前后只读快照无业务写。
- [ ] 并发claim、同key重试/暂不存在、事务冲突、旧审核、末次邀请码/申请兑换竞争、初始化后新账号、禁用栅栏、同timestamp分页均云端跑通。
- [ ] 附件并发/故障实测：第四槽拒绝、三件不互相使taskRevision失效、只交一件或零件关闭其他会话、VERIFYING取消、签发前后鉴权、GC与对象采用互斥、下载真实TTL≤300秒；任一关键门禁未通过不可声称附件可正式共享。
- [ ] 故障注入仅隔离环境：DB已提交响应丢失、对象已写DB失败、worker中断/租约过期、部分删除失败、签名过期、GC与提交竞态。测试专用注入不能进入发布函数。
- [ ] 实测10MiB/3文件、至少2并发用户，记录耗时/函数次数/内存峰值/暂存容量/下载流量；按数据设置预算告警，费用不是估空数。
- [ ] worker客户端invoke拒绝；伪造event.type/source不能获得系统权限；定时任务正常处理并写最小日志。
- [ ] 核查无敏感URL/完整openid/邀请码/附件内容日志；检查打包源映射和环境文件没有secret。
- [ ] 测试资源/数据清理按fixture ID精确范围；不能清空整个社团或bucket；保留证据和清理结果。

**验证**：`pnpm test:cloud:integration`配真实用户调用器+独立只读断言器；人工真机结果另附；所有未执行项显示NOT_RUN及原因。

**出口**：关键权限/一致性/文件用例全PASS，无“能build所以已上线”结论。非关键能力如QR降级在UI和报告中明确。

## P9. 真机体验版、备份恢复与最终交付

**待创建/更新**
`docs/CLOUD-DEPLOYMENT-GUIDE.md`（独立云环境/函数部署说明）、`docs/CLOUD-OPERATIONS-GUIDE.md`（owner、权限、备份恢复、费用、故障）、`docs/WECHAT-DEVTOOLS-GUIDE.md`（区分demo/cloud）、`docs/TASK-ATTACHMENTS-GUIDE.md`、OPEN-QUESTIONS状态、最终验收报告。

- [ ] 本人owner、管理者、普通成员两个及以上账号在体验版实际走：入会→任务发布/claim→附件交付→跨设备验收/驳回重交→公告发布→ROI→角色任免。
- [ ] 移除/清缓存后同微信重进，任务/公告/收支/已交付文件恢复；换另一微信不继承权限；待审核/被停用页面与直调都受限。
- [ ] 名册开关、草稿隐藏、普通成员只能看自己交付、管理者和超管发布入口均验证。
- [ ] 隔离备份恢复演练，校验云数据与ATTACHED字节、owner身份/规则/索引、30日幂等保留；明确文件不是随数据库JSON一起自动备份。
- [ ] 输出需要用户完成的剩余平台配置：扫码登录/环境费用/本人身份确认/体验成员/隐私与审核材料；只列真实未完成项，不再索取已有AppID/env。
- [ ] 写清导入哪一层（根目录而非只拷dist；miniprogramRoot指dist），构建前变量、函数目录显示、选择正确环境、上传部署、客户端/云日志位置、如何判断成功和出错回滚。
- [ ] 构建/功能/安全/真机/恢复分别给PASS或LIMITED/FAIL结论；有关键未完成不得评为“可以正式共同使用”。
- [ ] 未获得发布范围授权时停在可审查体验版/文档；本轮用户仅方案，不因本计划提前执行上传/审核。

**最终完成条件**：DESIGN §1.2全部可观察结果成立，验收证据存在；没有requiredNotRun、未修复越权/丢写/文件错误；云端业务不依赖本机存储。

## 需求→实施→验收追踪

| 需求 | 实施阶段 | 验收 |
|---|---|---|
| 云数据持久化、清缓存/换机恢复 | P2/P3/P4/P6/P9 | A01、双设备恢复 |
| 云数据库仅函数访问 | P1/P2/P3/P8 | A04/A05、静态扫描+真实拒绝 |
| 管理员真实设置、非成员限制 | P3/P7/P8 | A02/A03/P01/P02 |
| 任务多人协作、并发/重试 | P4/P7/P8 | T01/T03/T04/L01 |
| 可选任意格式附件、跨设备授权与历史 | P0/P5/P8/P9 | T02/F01-F07 |
| 公告管理/超管发布和排版 | P6/P7/P9 | N01+真机截图 |
| ROI精度与绩效口径 | P6 | R01/R02+绩效fixture |
| 邀请/申请/成员/设置完整覆盖 | P3/P6/P7 | I01/I02/P02 |
| 空云起步、无样例泄漏 | P3/P7/P9 | 初始表仅club/owner；无demo人物 |
| 错误不假成功、权限撤销缓存 | P2/P4/P7/P8 | resultUnknown/403/迟到响应 |
| 部署规则、函数目录、费用/备份 | P0/P1/P8/P9 | B01/O01/D01+部署清单 |

## 方案自查与风险交接

本计划已将以下易漏问题写成硬要求：新cloud模式不依赖HTTP URL；cloud身份不造JWT；member/invite/qr旁路全部覆盖；DB事务不写where/外部副作用；member禁用与写竞争排序；分页失败不推进与公告不同排序；幂等30天清理后旧键不能重执行；文件先冻结后校验、无任意fileID签名、草稿GC不删历史；空数据初始化不混示例。

实施仍需P0验证真实环境和SDK。剩余外部依赖不是“随便一个API地址”：平台登录/归属、套餐配额、可信本人身份、第二账号真机、审核/隐私、备份能力。不能得到这些证据就精确标记阻塞项；其余本地代码与单测可并行推进。

下一次请求实施时，从P0开始按本计划执行；本次交付到此，不把复选框虚假勾选。
