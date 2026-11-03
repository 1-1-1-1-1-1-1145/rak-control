# Rak 多团队云端使用：AI可执行实施计划

日期：2026-10-17（Asia/Shanghai）。状态：**仅方案，以下开发、部署及验收任务全部未执行**。
工作目录：`C:/Users/24800/Desktop/小程序/rak-control`；默认PowerShell。
设计真源：[多团队隔离设计](../specs/2026-10-17-rak-multi-team-isolation-design.md)（DESIGN）。
基础参考：[云化基线设计](../specs/2026-10-16-rak-cloudbase-multiuser-design.md)（BASE-DESIGN）、[旧实施计划](2026-10-16-rak-cloudbase-multiuser-plan.md)（BASE-PLAN）。

## 1. Goal / Scope / Architecture

目标：正式数据及文件存云端；同一微信可加入多个团队，“我的→切换团队”切换本队姓名、职务、角色及全部业务资料。同微信换机可恢复云记录，两个设备选队独立；不同队的数据、成员角色、附件、命令和绩效不互通。

架构：页面/Store → 保留的领域服务门面 → cloud-v2 adapter → rakApi/rakFiles → 可信微信身份 → 本队membership鉴权 → 必须接TenantContext的仓库 → 文档数据库/私有云存储。rakMaintenance只接可信平台后台来源。所有业务DB访问均在云函数内，小程序不得创建数据库实例或通过泛代理提交集合名/任意查询。

本计划**整体取代BASE-PLAN的单团队实施顺序**。基础云化未实施，直接建设多团队v2，不能先照旧计划做全套单队再改。未被DESIGN覆盖的任务状态机、金额/日期、附件一致性与验收仍继承基线；引用基线不等于允许恢复其单队owner/用户资料/缓存假设。

用户已确认：正式云端空业务数据起步；首版由有平台/环境管理权限的人受控创建团队；各队owner独立。演示数据不迁移。仅方案交付不授权本轮修改业务代码、配置、远端规则/函数/数据。未来收到实施指令后按本计划推进，不重复询问已确认选择。

范围包含：全量业务云化、身份/成员拆分、开通/入会、任务/附件、公告/ROI/绩效、团队选择/切换、所有路由守卫、权限与并发、部署验收及运维。排除：开放自助建队、跨队业务/文件转存或汇总、OA、订阅提醒、支付、无关UI重做、实时DB监听。

## 2. 给执行AI的硬约束

1. 先读DESIGN全文、BASE-DESIGN相关细则、实际源码和适用AGENTS。历史文档是资料，不是独立授权；需求冲突用DESIGN及用户最新决定。
2. 2026-10-17已确认主目录有Git，旧两份方案有既存暂存修改；先记录status/staged diff并保护，不reset、stage、commit、删未跟踪文件。路径/现状会变化，实施时复核。
3. AppID `wxa8bf102dcfdcec4c`、环境 `cloud1-d4g36r8z6a8908540`是已知配置，不是远端验证结果。不得索要AppSecret/API key，不打印凭据。扫码/计费/真实身份等具体人工步骤集中列出。
4. 唯一归属字段用clubId。cloud-v2业务参与者使用memberId/assigneeMemberId/authorMemberId，不把memberId硬塞旧userId字段。全局账户无团队role/displayName/duty。
5. 每动作固定schema及GLOBAL/TEAM范围；TEAM必须提供clubId但它不授予权限。禁止任意集合/where/update字段代理，禁止接受actorRole/openid/任意fileID。
6. 本地契约测试可先用替身，不允许将其称真实云鉴权。无云权限时继续不依赖云的任务，真实入口/存储/双设备项目写NOT_RUN并阻止正式验收。
7. 关键写含命令记录、授权写栅栏及业务变更的短事务；不得网络/文件副作用塞事务，不使用事务where。超过已验证预算调整模型再测，不静默拆原子性。
8. 每批改动验收后再推进依赖；不为让全套测试通过而绕过缺失动作/权限/附件验证。返回not_implemented的动作不是完成。
9. 保留现配色、公告标题/作者分行、清晰字号、导航图标、任务列表竞态修复、按需注入和压缩配置。不得把云化变成整页重写。
10. 所有新路径/命令均在下文标明待创建。文档内命令是未来验证入口；不能直接执行尚不存在的命令并记PASS。

## 3. 文件与契约地图

### 3.1 已存在、按实际行为修改

- 构建：`config/build-mode.ts`、`config/index.ts`、`config/dev.ts`、`config/prod.ts`、`project.config.json`、`package.json`、`pnpm-lock.yaml`、`.gitignore`、`types/global.d.ts`。
- 客户端身份/调用：`src/app.ts`、`src/types/domain.ts`、`src/services/context.ts`、`src/services/domain-entry.ts`、`src/services/{auth,task,roi,club,member}.ts`、`src/utils/request.ts`、`src/utils/auth-contract.js`及其类型文件。
- Store/缓存：`src/store/index.ts`、`src/constants/index.ts`、`src/services/club.ts`中的二维码缓存、`src/demo/{runtime,adapter}.ts`（明确隔离，不将demo当云数据库）。
- 页面：`src/app.config.ts`、`src/components/page-shell.tsx`、`src/utils/permission.ts`、`src/pages/**`、`src/subpackage-admin/pages/**`。从配置生成完整路由表，当前26页不是改造后的固定总数。
- 现有测试：`tests/build-mode.test.ts`、`tests/demo-services.test.ts`、`tests/task-list-request-gate.test.mjs`。实施时先记录实际用例数，不把原17例当最终数。
- 现有文档：`docs/CONSTRUCTION.md`、`docs/DEVELOPMENT.md`、`docs/OPEN-QUESTIONS.md`、`docs/WECHAT-DEVTOOLS-GUIDE.md`、`docs/TASK-ATTACHMENTS-GUIDE.md`、`docs/adr/adr-0004-wechat-auth-client.md`、`adr-0005-state-and-request.md`、旧rak-auth提案。

### 3.2 待创建；命名可有小幅调整，但责任与测试不可省

```text
server/
  entrypoints/{rak-api,rak-files,rak-maintenance}.ts
  contracts/{request-v2,actions,dtos,errors}.ts
  shared/{identity,authorization,tenant-context,validation,transaction,command,cursor,logging}.ts
  modules/{auth,teams,provisioning,members,join,invites,tasks,announcements,roi,performance,files}/
  repositories/{identities,users,clubs,members,join,invites,tasks,submissions,commands,audit,uploads,attachments,jobs}/
  storage/{adapter,capabilities}.ts
  jobs/{file-verification,storage-cleanup,reconcile}.ts
  tests/{contracts,authorization,membership,provisioning,join,commands,tasks,files,statistics,multi-team}*.test.ts
infra/cloudbase/{collections,indexes,database-rules,storage-rules,function-rules}.json
cloudfunctions/{rakApi,rakFiles,rakMaintenance}/   # build:cloud生成，自包含部署包
scripts/{build-cloud,verify-cloud-artifacts,verify-cloud-config,verify-no-client-db,verify-release}.mjs
scripts/{bootstrap-cloud-platform,provision-cloud-team}.mjs
scripts/cloud-integration/                        # 真实微信调用器+独立只读断言
src/services/{backend,attachment,team}.ts
src/services/cloud/{client,auth,team,task,club,member,roi,attachment}.ts
src/store/{account,team-session,switch-coordinator,command-tracker}.ts
src/utils/{backend-error,team-guard,pending-intent,scoped-cache}.ts
src/pages/me/{team-select,team-join,team-join-status,team-profile,account}.tsx
tests/{cloud-client,cloud-auth-contract,team-context,team-switch,team-links,service-mode}*.test.*
docs/api/cloud-v2.md
docs/adr/adr-0006-cloudbase-multiteam-backend.md
docs/{CLOUD-DEPLOYMENT-GUIDE,CLOUD-OPERATIONS-GUIDE,MULTI-TEAM-GUIDE}.md
docs/verification/{cloudbase-capabilities,multi-team-acceptance,route-guard-matrix,action-matrix}-YYYY-MM-DD.md
```

职责：server为云端源；cloudfunctions为可单目录上传产物，不能require目录外源码；dist为Taro产物。每函数仅打包需要的模块，前端依赖树绝不包含server或管理员SDK。页面还需同名`.config.ts`及按现样式组织的SCSS；不得只新建tsx漏注册路由。

协议以DESIGN §5–§11为准：apiVersion=2；scope为GLOBAL或TEAM.clubId；目标角色用targetRole，状态用targetStatus；所有DTO字段投影及错误码在cloud-v2.md单一来源维护。command.status按原scope查，团队enter不保存全局currentClub。

## 4. Verification：现有与待创建命令

**当前实际存在，本轮未运行：**

```powershell
pnpm test
pnpm exec tsc --noEmit --pretty false --skipLibCheck
pnpm build:weapp
pnpm build:weapp:prod
```

当前prod仍是旧模式配置；M2前不预期无HTTP配置可成功云构建。测试会读取实际依赖，先检查Node/pnpm版本，不自行更新整个锁文件。

**在M1/M2新增并验证，创建之前不能运行或标通过：**

| 命令 | 必须验证的真实责任 |
|---|---|
| `pnpm test:server` | server/tests中schema、授权、仓库契约、事务、故障/并发；替身层标明 |
| `pnpm build:cloud` | 锁定运行时/SDK，构建3个自包含函数目录 |
| `pnpm verify:cloud:artifacts` | 每目录index.js/package.json/完整生产依赖，hash清单，无秘密/测试注入/外部require |
| `pnpm verify:cloud:config` | 代码查询与集合/复合索引/权限/函数来源清单对应，无public-write/worker客户端invoke |
| `pnpm verify:no-client-db` | 检查前端源及构建依赖/产物中的真实DB调用和泛代理，覆盖别名/间接导出；文档、合法组件doc字符串不误报 |
| `pnpm verify:routes` | 从app.config生成路由/角色/作用域/生命周期矩阵，检测新增页缺配置和守卫 |
| `pnpm verify:release` | 组合以上静态与发布包检查；拒生产demo/http/未实现action，不冒充真实云测试 |
| `pnpm test:cloud:integration` | 隔离环境真实微信调用与独立只读DB断言；缺env/身份/证据非零退出，不能skip后全绿 |

未来cloud构建应在受控子进程注入TARO_APP_BACKEND=cloud及已核实TARO_APP_CLOUD_ENV，再执行prod及release；不在文档给出未经验证的部署CLI参数。若直接用PowerShell设置环境变量，先保存原值并在finally逐一恢复，不能擦掉原终端配置。

## 5. 依赖顺序与阶段出口

```text
M0 本地/远端现状与能力门禁
 → M1 v2契约/模型/构建/拒绝规则
 → M2 cloud调用与双层不可变上下文（契约测试，不声称真实登录）
 → M3 真实身份/受控多队开通/选队/入会/成员
 → M4 任务状态机/命令/轮次
 → M5 私有文件/后台/共享（依赖M0上传裁决与M4轮次）
 → M7 所有页面的切换协调与竞态整合
 → M8 隔离云真实入口与双团队攻防
 → M9 真机/换机/恢复/使用文档与验收
M3 → M6 公告/ROI/绩效/摘要/所有列表 → M7
```

M4与M6可在M3后分模块并行；共享domain.ts/Store/注册表由一个集成负责人协调。M5字节传输若被平台能力阻塞，可继续M6/M7的独立内容；不将附件悄悄降回本地并宣称全量完成。M2出口只本地契约通过；M3出口是服务端实现与本地测试完备，全部真实身份场景统一在M8，避免“必须先线上验收才允许继续写后端”的循环。

## M0. 证据、快照与云能力裁决

**输入**：DESIGN、BASE-PLAN P0、实际项目/SDK/现有环境。**产物（待创建）**：capabilities报告、精确文件hash清单、远端只读资源快照、隔离试验夹具。

- [ ] 记录`git status --short`、`git diff --stat`、`git diff --cached --stat`及相关文件hash，保留用户已有修改；核查适用AGENTS与实际依赖/构建脚本。
- [ ] 只读核对AppID与环境绑定、文档数据库类型/套餐/运行时、现存函数/定时器/规则/数据。若发现真实业务云数据，停止“空云初始化”并单独制定备份/归属映射迁移；不得默认覆盖。
- [ ] 通过官方文档与锁版SDK类型/源码、隔离试验证明身份上下文、DB规则、doc-only事务、冲突重试、100操作/30秒等当前边界；这些数字实施时复核。
- [ ] 验证SDK支持的真实索引/排序/复合游标；member确定性主键、全局邀请码/申请入口hash查找；评估member/user/club写栅栏热点，不使用全平台串行锁。
- [ ] 按BASE-DESIGN §15及BASE-PLAN P0完整验证上传U1–U3/U5：exact-key PUT凭证的所有能力和实际最晚到期、10MiB真机字节上传、不可覆盖candidate冻结、按预登记path恢复规范fileID、精确删除。禁止猜测SDK或手拼cloud://。
- [ ] 首选协议任何关键能力不成立则选function-chunks-v1；验证256KiB解码片长、10MiB约40片、最大2并发的事件限制/时间/内存/费用，有界流式组装/hash。不能把分片当无需云能力验证。
- [ ] 验证私有下载实际有效期≤300秒、逐项status、过期刷新；不支持时实现有实际限期能力的签名适配或阻止附件正式上线，不能伪造expiresAt。
- [ ] 验证客户端DB各类读写/聚合/监听均拒绝、storage SDK直访拒绝、允许业务函数invoke、worker仅可信平台源；event.source或clubId不能冒充后台。
- [ ] 核对后台触发/小程序码能力/备份与告警/成本；文本邀请码为二维码能力不足的明确降级，不阻塞核心入队。仅精确清理本次授权的隔离试验资源。

**验证**：真实SDK最小试验+真微信调用+独立只读断言，报告PASS/FAIL/BLOCKED、锁版和原始脱敏证据。**出口**：上传/下载协议已裁决，环境与能力条件明确；缺云条件只允许后续本地工作，不判云端通过。

## M1. 固化多团队v2契约、数据模型及函数骨架

**修改**：domain.ts、package.json、project.config.json、.gitignore、既有架构/接口文档。**创建**：server contracts/shared骨架、infra、构建/验证脚本、ADR、cloud-v2.md。

- [ ] 从每个现有领域service方法列action矩阵，逐行记录schema、scope、角色、资源关系、幂等、事务、审计、错误及测试ID；task.*等不是一个可模糊实现的泛动作。未注册动作拒绝。
- [ ] 确定身份与成员DTO：AccountView最小accountKey；TeamSession本队club/member/permissions；所有业务author/assignee/reviewer改member引用。对外不泄露他人全局userId/openid/其他队关系。
- [ ] 实现RequestScope联合类型、apiVersion=2信封及响应scope校验。注册表精确允许GLOBAL/TEAM；拒绝payload夹入clubId/actorRole/任意集合或fileID；合法setRole仅targetRole/setStatus仅targetStatus。
- [ ] 按DESIGN §5创建全部集合/主键/索引清单，包括join_entry_states、provisioning_operations、credentials/attempts/chunks/jobs/commands。每份团队业务文档有clubId；缺失归属拒绝而非默认当前队。
- [ ] 仓库API必须TenantContext，getById亦比对clubId，count/aggregate/lookup/search同授权过滤；只有明确的全局账户仓库可无队，不能给业务仓库rawCollection逃逸。
- [ ] 身份/权限错误、范围不匹配、cursor_scope_mismatch、revision_conflict、result_unknown、统计失败等定义语义；异队/不存在统一resource_not_found。当前队禁止与全局账号失效错误分开。
- [ ] 生成三个独立云函数产物与正式权限配置；project.config识别cloudfunctions/；数据库客户端read/write=false、私有文件访问默认拒绝。先fail-closed骨架，不临时公开DB方便开发。
- [ ] 添加test:server/build:cloud/各verify脚本并用最小合法/非法fixture证明门禁有效；前端/发布依赖无服务端SDK和运维凭据。ADR明确替代旧rak-auth主业务路线，无双写。

**测试/验证**：schema分支及拒绝用例、无scope/异scope/未知action；`pnpm test`、`pnpm test:server`、`pnpm build:cloud`、两个cloud verify。**出口**：契约可独立测试、自包含函数可打包，尚未实现业务必须明确不可用。关联MT11/12/20。

## M2. cloud调用、账户与团队双层上下文

**修改**：构建模式、app.ts、领域服务入口、request.ts、auth-contract、现有Store出口。**创建**：cloud client/backend、AccountContext/TeamContext、scoped-cache、对应前端测试。

- [ ] cloud独立于demo/legacy HTTP，不要求HTTP accessToken/API_BASE；缺env/生产demo/矛盾变量fail-fast。正式包只cloud，错误不fallback演示。cloud.init完成后才能bootstrap。
- [ ] callFunction适配统一传输/业务错误、版本、字段/响应scope；不将ok:false当成功或空数组。参数只来自schema，不透传Taro/HTTP身份字段。
- [ ] AccountContext包含backend/env/appId/accountKey/accountEpoch；首次bootstrap未知key时用bootstrapAttemptId。TeamContext额外包含clubId/memberId/epoch/membershipRevision。换账号/环境/登出递增两层；普通切队只递增团队epoch。
- [ ] GLOBAL请求捕获AccountContext与queryGeneration，TEAM请求捕获TeamContext；retry/finally/toast/navigation/refresh同一发起ctx。A→B→A不可仅按clubId放行。
- [ ] 服务门面显式注入ctx；旧request重登录/重放不能重新读取当前club再发送旧业务。cloud与HTTP DTO明确适配，未实现云动作抛not_implemented。
- [ ] 首版不持久化业务列表/权限；允许最小索引用backend/env/appId/account/club/member/resource/schema命名空间；上次选队仅本机建议。全局主题可共享，不误当身份。
- [ ] 全局列表/入队结果只能更新本人账户级状态；加入C时切到B后的响应不能自动改B或进入C。旧账号GLOBAL错误/结果不清新账号数据。

**测试/验证**：伪造响应/错scope/缺env/业务错误/不回退；旧账号bootstrap和team.list迟到；A列表/finally在B回填、A→B→A；`pnpm test`、类型检查、`pnpm verify:no-client-db`。**出口**：本地替身契约完备；不以此宣称真实云登录。关联MT06/07/09/19/20。

## M3. 真实身份、受控多队开通、选队入队及成员

**创建/修改**：server auth/teams/provisioning/members/join/invites及仓库、authorization/command基础、平台/团队受控脚本；cloud auth/team/member客户端；账户/入队状态类型。

- [ ] handler内读getWXContext，校验真实AppID/env/OPENID；并发bootstrap确定性identity/user唯一。user只有NORMAL/BLOCKED平台状态；BLOCKED仅本人最小状态/静态帮助，其余GLOBAL/TEAM拒绝。
- [ ] 平台初始化与每队开通分开。参考号30分钟/未消费复用，已消费不返回可用号；显式replaceConsumed换发，不能取得其他人的身份。受控创建不进入公共action注册表。
- [ ] provisioning_operations主键hash(appId,env,provisioningId)，规范inputHash；先读已完成恢复；新clubId在事务外生成一次、重试复用。club/member/唯一owner/审计/消费参考号/操作成功记录同事务。不同输入同键拒绝、双键争同参考号只成功一次。
- [ ] team.listMine按本人membership.createdAt/id分页，20默认50最大、只最小队摘要；join.mine独立分页。team.enter实时授权，不写server currentClub；owner在A的权限不传播B。
- [ ] 关键写事务触碰user.securityMutationSeq、actor membership.mutationSeq及本队club.mutationSeq；全局入队写触碰user/目标club，受控平台封禁/团队维护/禁用分别写同栅栏。冲突重读权限；事务预算加上这些写。
- [ ] 批准申请/受控恢复owner等权限授予还检查目标user.NORMAL并写目标securityMutationSeq；与actor为同人时去重。目标封禁先提交则不能新增有效权限，不能仅验证操作者。
- [ ] joinKey≥128bit，hash查找，resolve只返回有意分享的最小队名与本人短效token；签名绑定account/app/env/club/entry/version/issuedAt/expiresAt/tokenVersion。密钥只服务端配置，不进源码/日志。
- [ ] rotate与首次join.submit共同写本队join_entry_states和club栅栏；撤销后旧token不能产生新申请。已成功同键命令先恢复本人最小结果，过期/轮换不误报失败；未知首次执行才检查当前token。
- [ ] 邀请12位手工码/受控scene互斥，服务端解析目标。create当次显示明文，命令恢复只masked/id，丢响应撤销重建。额度扣减、membership及申请收敛原子；重复不多扣，不覆盖已ACTIVE的role/name/joinedAt。LEFT/DISABLED不能借码/申请恢复。
- [ ] 每队owner唯一；普通接口不能授super/禁用/降级/转移owner。manager只管理member，owner可管理manager/member。targetRole/targetStatus受动作白名单；本队本人改姓名、owner本人可改duty，上级更新对象按矩阵。
- [ ] 名册开关与DTO脱敏在云函数执行；非成员只账户/自己的申请/入队能力，不能看内部任务、公告、ROI、名册或文件。

**测试/验证**：重复/并发bootstrap；两队不同角色资料；普通首登抢owner；开通丢响应/重启/同键异输入/同参考号双开通/同人新号第二队；rotate-submit竞争与令牌过期恢复；末次邀请码竞争/申请邀请竞争；任免/封禁/维护竞争；`pnpm test:server`、前端契约、build/verify cloud。

**出口**：本地服务端与契约测试完整，多队最小种子fixture可用；真实身份部署验证留M8。关联MT01–04/11/12/14/15/21。

## M4. 本队任务、命令幂等与独立交付轮次

**创建/修改**：tasks/submissions/commands/audit、cloud/task、task service、任务/审核类型与列表。保留现任务筛选竞态门禁。

- [ ] 按基线六状态实现发布、OPEN编辑、认领、交付、通过/驳回、重交、APPROVED归档；所有成员引用同队，服务器赋author/member/time。任务公共DTO不含他人说明/附件/私人备注。
- [ ] claim双人同队竞争只一个成功；A超管不能用B scope配A任务。submit创建独立round/submission，0..3 attachmentIds，历史不覆盖；当前负责人/轮次/revision/安全附件全校验。
- [ ] 本阶段先实现无附件真实数据路径；有attachmentIds但M5尚未实现时拒绝，不默默忽略或伪造上传。审批只当前submission+expectedRevision，旧审核拒绝。
- [ ] 命令键含canonical(scope)/可信actor/action/mutationId；inputHash含apiVersion/action/scope/data/expectedRevision，不含requestId。实现UUIDv7年龄及可信serverTime校准、24h重试/7天结果/30天保留。
- [ ] SUCCEEDED/DETERMINISTIC_REJECTED/ACCEPTED_JOB/ABSENT_IN_WINDOW/EXPIRED语义按基线；暂不存在不等于失败，不用新键重做。结果读取重新鉴权，同mutationId两队互不泄露。
- [ ] submit事务读固定batch最多3槽：所选转ATTACHED，未选session取消/fence++、DRAFT附件GC_PENDING、关闭batch；无batch或零附件也成立。此契约为M5固定接口，含授权栅栏的最坏预算目标≤40操作。
- [ ] 客户端最小命令追踪器隔离scope；A未知写切B后不在B继续下一步/刷新/toast；回A重新授权后查原命令。重启无原payload只查询，不虚构重放。

**测试/验证**：全部非法迁移/双人claim/重复交付/旧审核/响应丢失/暂不存在/时间窗口/同键异payload/禁用竞争/跨队指针；`pnpm test:server`、`pnpm test`、类型检查。**出口**：任务与轮次模型可验证、命令无重复业务写；待M8真实入口复验。关联MT08/09/11/13/18。

## M5. 私有附件、跨成员授权与团队化后台

**创建/修改**：files模块、所有upload/batch/credential/attempt/chunk/attachment/job仓库、storage adapter、后台jobs；attachment服务、task-attachments工具、任务详情和管理验收/历史UI。

- [ ] 只实现M0已通过transport；init预占固定3槽，每件1..10MiB，只递增batch revision，task业务revision不因第二附件变化。session绑定club/task/uploaderMember/revision/round，所有派生记录clubId一致不可重绑。
- [ ] init第一阶段幂等事务定session/attachment，第二阶段事务外签发；credential/attempt预登记、actualExpiresAt有真实能力依据。返回凭证前重查权限与fence；丢响应不另占槽，取消/停用/过期不得返回新凭证。
- [ ] 云存储SDK客户端直访拒绝。若采用签名PUT，只能云函数签发exact-key限权字节上传；不能把数据库访问或任意对象权限下放客户端。路径由服务端生成clubs/{clubId}/...，不收用户自定路径。
- [ ] 按基线freeze-before-verify：不可覆盖唯一candidate后再有界读取/hash；分片则不可变片/manifest、hash/片长校验/有限并发及流式组装。未知副作用按实测recoverByPath，不能手拼ID或虚构listFiles。
- [ ] uploadExpiresAt=init+30分钟、confirmedUntil=confirm+24小时、平台凭证实际期限分别管理；GC至少晚于最晚凭证实际到期+5分钟。VERIFYING可取消/fence++，迟到worker不发布；状态重试边界明确。
- [ ] 交付只接VERIFIED及明确scanState白名单、CONFIRMED+DRAFT+有效confirmedUntil；BLOCKED/未知拒绝。无病毒扫描如实标注；文件格式尽量可选，能否预览按平台能力，未知格式提供下载/不支持打开状态。
- [ ] downloadUrls只接attachmentIds，逐件反查同队交付/任务/有效成员/负责人或管理关系；草稿预览只本人当前有效草稿。无关成员/非成员/其他队管理员拒绝。URL逐项返回、实际TTL≤300秒、过期重新授权；原fileID不下发作失败fallback。
- [ ] 所有临时URL/凭证不入DB/日志，cache包含完整ctx+实际expiry；切队立即清展示和URL。选择器/saveFile/下载回调校验epoch，只清明确本次新建未引用临时文件。
- [ ] 一个session一个staging attempt，多次credential共享最晚到期；candidate/chunk/final各唯一路径。GC不可逆抢同attempt/attachment=GC_PENDING，再精确删除，恢复采用与GC互斥；已发delete不能靠fence撤回。
- [ ] worker只信平台调用，从job读取clubId并验证全链；A job配B attempt拒绝。ATTACHED历史不因切队/TTL/队维护删除；扫描10分钟、回收24小时是监控SLO，非平台保证。
- [ ] worker无本人上下文，由session.uploaderMemberId反查内部user；最终采用/CONFIRMED事务检查其NORMAL、member/club有效/任务权限，并写上传者user/member/club栅栏及fence。VERIFYING中封禁先完成则旧worker不能发布；系统清理/对账例外继续且不能改为业务授权。
- [ ] 接UI进度/失败重试/取消/确认/结果未知/交付门禁/多轮附件展示；0附件可交。停止本地上传调度不等于撤回已发PUT，切队取消与GC状态需如实说明。

**测试/验证**：0B/10MiB/超限、第四槽、第二件不使第一件失效、同名/hash异队、VERIFYING取消、签发丢响应、选3交1/0、旧轮、GC/恢复竞争、worker异队、部分签名/删除失败、过期/丢响应/hash。`pnpm test:server`、前端adapter测试、cloud build/verify；真实最大文件与TTL在M8。

**出口**：所有文件元数据与后台团队归属闭环，所有失败显式，上传/下载能力关键门禁未通过即不得称附件正式可用。关联MT10/11/16/17/20/22。

## M6. 其余全部业务的本队隔离与统计

**创建/修改**：announcements/roi/performance/club模块与仓库、cloud适配；公告/ROI/团队/首页/个人页面及Store。

- [ ] 公告创建/发布/编辑/置顶/归档按现service能力逐项实现，草稿只本队管理者可见，普通成员只PUBLISHED；manager与owner发布入口均保留。标题/作者分行，不退回局促排版。
- [ ] ROI按元字符串严格转整数分、日期YYYY-MM-DD按上海左闭右开周期，0成本比例null，软删/取消/近6月补0/all口径沿基线；查询/汇总/趋势每一步clubId一致。错误不冒充0或空。
- [ ] 绩效按本队memberId计算，曾驳回从交付历史按task去重；mine只本人、全榜manager+，score desc/memberId asc有界游标，dashboard top5。超扫描预算返回stats_unavailable，不用SDK默认首批当全队。
- [ ] profile.summary/club.dashboard显式动作、本队权限/最小摘要；不伪造fetchTasks(size:1).total。成员目录关闭仍可返回授权在册总数，不泄露明细。
- [ ] 名册/申请/邀请码/任务/公告/ROI所有列表固定clubId+查询指纹+稳定排序游标，账户列表用account；同timestamp跨3页不漏重，异队cursor拒绝，翻页失败保原cursor。
- [ ] 搜索字面转义/长度/本队范围；聚合lookup两端同队，无索引/规模超限明确失败；不声称普通索引可加速任意子串全文搜索。
- [ ] 所有写服务端白名单、revision、命令/审计、相关actor/club/user栅栏；单行控制符/多行LF规则沿基线。空云返回合法空态，不注入演示内容。

**测试/验证**：每种业务A/B明显不同fixture、详情/搜索/计数/聚合与列表同过滤；草稿越权、金融精度/上海跨月、绩效去重/同分、名册关闭、超默认批次/缺索引错误。`pnpm test:server`、`pnpm test`、类型检查。**出口**：领域service→action矩阵无遗漏，无遗留HTTP业务旁路。关联MT01/02/08/11/18/20。

## M7. “我的→切换团队”及所有页面防串队

**修改**：me/profile/settings、auth/login/join-status、app.config、page-shell、全部路由及Store；**创建**：team-select/join/join-status/profile/account页面、switch-coordinator、guard、pending-intent、路由矩阵。

- [ ] “我的”常显当前队name/displayCode、本队姓名/职务/role与切队入口；单队也可加入其他队。无可用队只展示账户/入队入口，不加载内部宫格；无跨队任务/ROI/绩效汇总。
- [ ] 冷启动先账户→team.listMine；上次队先enter重验，未验证前不展示缓存权限；完整列表仅一队可自动enter，有hasMore不能假定唯一。0队/仅待审/停用/维护/重名/多页/网络失败均有确定UI。
- [ ] 新独立加入页供已在A的人加入B；GLOBAL兑换/申请成功只更新本人状态，不被旧login AUTHED自动reLaunch覆盖，不自动替换A。
- [ ] 协调器处理脏表单/文件/在途上传/未知写：留当前或放弃本机未提交编辑；未知A写原命令追踪，不新键重做；停止新片/确认并尽力取消A上传，保留服务端超时/回收兜底。
- [ ] 切换时epoch++、清受保护展示/Store/页面局部/QR/URL/分页/弹窗/表单；目标enter带switchAttemptId，核对账户/环境/代次/scope后一次MobX action安装完整会话；reLaunch到我的并新epoch挂载。
- [ ] 切换失败activeTeam=null回选择页，不恢复旧缓存；返回A也重验。当前队降权/停用/维护仅失效本队；旧A错误不能清B。全局账号失效另行清两层。
- [ ] 全部async的commit/catch/finally/toast/navigation二次API校验原ctx，特别任务选择器/saveFile/交付清理、首页计数、我的绩效、ROI编辑回填、公告create→publish；旧A create后不继续在B publish。
- [ ] 新业务深链apiVersion/clubId/resourceKind/resourceId；异队先验证最小授权目标并走同一切换，取消则不消费intent。仅id旧链接限当前READY队，不全库找归属。pendingIntent绑定accountEpoch/目标/switchAttempt，一次消费。
- [ ] 路由守卫先完成bootstrap/enter再load，所有useDidShow/useEffect、返回旧栈、下拉刷新、深链及管理页直接进入都覆盖；新增队选择页不能被ACTIVE guard循环拦截。
- [ ] global/team/cache/URL/命令指针按归属清理；退出不整目录删其他文件，不承诺撤回用户已另存内容。云模式无演示人物/角色切换/重置；demo/HTTP明确独立，不能给旧HTTP伪造多队能力。

**测试/验证**：测试受控Promise按A/B/A顺序返回，检查数据/toast/导航/busy/下一步；GLOBAL加入C期间切B、换账号旧list、快速选队失败、脏编辑、旧intent、上传回调。`pnpm test`、`pnpm test:server`、类型检查、verify:routes/no-client-db、prod cloud build及release。

**出口**：当前配置全部路由有矩阵，cloud包无demo/管理员SDK/测试注入，现配色字号图标与按需注入/压缩保持。关联MT01–10/14/15/19/20。

## M8. 隔离云部署与真实双团队攻防验收

**前置**：M0能力已通过，M1–M7相关本地验收通过，具备授权隔离环境与真实微信身份。**产物**：部署hash/规则/索引快照、真实action测试、证据与成本报告。

- [ ] 按集合/索引/安全规则→3函数→受控平台初始化→两队及owner→cloud客户端的顺序部署；先拒绝规则，无公开DB过渡。函数目录在开发者工具可识别，运行版本与本地hash相符。
- [ ] 建最小隔离fixture：账号X=A owner/B member，Y=A member/B manager，Z不在目标队；另可受控调整待审/停用。创建两个明显不同的任务/公告/ROI/文件；无真实生产社团数据。
- [ ] MT01–MT22逐项执行真实可执行部分，所有UI绕过直接callFunction测试使用真实低权微信；独立只读管理员断言写前写后。管理员SDK伪装event.openid不能作为可信入口测试。
- [ ] 注入跨队task/member/submission/attachment/session/attempt/job/cursor/command，包含同人同时在A/B；统一拒绝、不泄漏存在性且无越权写。DB get/query/count/update/add/remove/aggregate/watch、直接存储SDK与worker客户端调用均拒绝。
- [ ] 并发认领/末次邀请码/入会入口轮换/开通重试/封禁与写栅栏/维护、数据库提交丢响应、命令暂不存在、事务回滚在真实SDK验证。只读结果按请求时授权，不声称能撤回历史已读内容。
- [ ] 文件真实10MiB/3件/至少2并发用户，检查exact-key范围/期限/冻结/hash/恢复规范ID/逐项失败/过期刷新/GC竞争；A上传A管理者下载成功，B管理员/无关A成员/停用者拒绝。
- [ ] 可信worker调度/租约/取消/GC，只在预登记精确对象测试中断与部分删除失败，不扫描整桶清理；故障注入代码不进发布包。
- [ ] 记录延迟、调用次数、内存峰值、暂存/下载量及每队配额与平台共享费用；设置实际预算/告警。日志不含URL/邀请码/完整openid/全量联系方式/跨队关联。
- [ ] 未执行项写NOT_RUN且说明真实原因，不伪造skip为PASS；测试数据按fixture ID精确清理，留脱敏证据。

**验证**：`pnpm test:cloud:integration`+独立只读断言+真实存储证据；UI/双设备留M9。**出口**：关键鉴权/一致性/文件门禁全PASS，无越权/未知数据丢写；缺配置不判正式可用。

## M9. 真机、多设备恢复与交付

**创建/更新**：独立CLOUD-DEPLOYMENT/OPERATIONS/MULTI-TEAM指南、现WECHAT-DEVTOOLS/TASK-ATTACHMENTS指南、最终验收报告。

- [ ] 至少两个真实微信、两台设备完成：受控开通两队→邀请/申请→切队→发布/认领→可选附件交付→另一设备验收/驳回重交→公告→ROI→本队角色/资料修改。不能用模拟器角色切换冒充真实权限。
- [ ] 同微信两设备分别A/B并发；设备1切队不改变设备2目标。清缓存/移除/换机后同微信同AppID/环境重新进入，云端已交付数据及文件恢复；本机未上传草稿不承诺恢复。
- [ ] 依MT19验旧深链/旧返回栈/换账号/换环境；依MT03验A停用不影响B；A owner/B member两套本队展示名/职务/权限/绩效不互通。
- [ ] 隔离备份恢复演练：DB与文件分别备份；恢复A全关联集合/owner/member/commands/jobs/文件映射，核验B完全未改。跨环境文件受控复制并核hash，不替换字符串fileID。
- [ ] 导入指南明确根目录而非只dist、miniprogramRoot=dist、构建模式/本地配置/环境选择、云函数目录及上传顺序、日志/失败判断/回滚；三函数不是旧订阅三函数。
- [ ] 团队指南写明我的切队、同名编号、入队申请/邀请码、owner与平台运维区别、资料/权限/在途操作/文件过期边界。云模式设置不允许自选角色。
- [ ] 运维指南列平台初始化与每队开通的幂等恢复、参考号换发、owner丢号受控恢复、规则/索引/版本/预算/备份及事故排查；不把环境管理权限分给团队管理员。
- [ ] 汇总所需用户事项及状态：扫码/有权环境、费用确认、两队名称与owner本人参考号、体验账号/设备、隐私与审核材料；已给的AppID/env不重复索取。未授权公开发布则停在可审查体验版和文档，不自行提交审核。

**最终出口**：DESIGN §1.2和MT01–MT22每项有PASS/NOT_RUN/FAIL及证据层；静态、本地、真实云、真机、恢复分别给结论。任一关键NOT_RUN/FAIL不得写“可以正式共同使用”。本轮仅方案，所有上述项保持未执行。

## 6. 需求→任务→证据追踪

| 要求/验收ID | 实施阶段 | 最低证据 |
|---|---|---|
| 云端持久化/仅函数DB MT20 | M0/M1/M2/M8/M9 | 源和产物扫描+真实客户端拒绝+清缓存重读 |
| 本队身份资料/权限 MT01、MT02 | M1/M3/M6/M7 | 服务端DTO/权限测试+X跨队真机展示 |
| 停用/待审/全局封禁 MT03、MT12 | M3/M7/M8 | 状态/写栅栏竞争+真实低权直调 |
| 0/1/多队/同名/多页 MT04 | M3/M7 | 分页契约+UI状态+真队列表 |
| 切换失败/并发意图 MT05 | M2/M7 | 延迟Promise/失败注入+无旧闪现 |
| GLOBAL/TEAM旧回调 MT06 | M2/M7 | 数据/toast/finally/导航断言 |
| A→B→A MT07 | M2/M7 | epoch而非clubId测试 |
| 公告多步/ROI回填 MT08 | M6/M7 | 旧create不publish/旧编辑不回填 |
| 未知写/令牌过期恢复 MT09 | M3/M4/M7/M8 | 丢响应/原键恢复/无重复写 |
| 上传切换 MT10 | M5/M7 | picker/PUT/confirm迟到及归属断言 |
| 资源/member/cursor混队 MT11 | M1/M3/M4/M5/M6/M8 | 真实低权函数+只读DB无写 |
| scope命令 MT13 | M4/M8 | 同mutationId两队隔离/查询拒绝 |
| 双设备 MT14 | M3/M7/M9 | 同微信两设备独立操作 |
| 加入第二队/轮换竞争 MT15 | M3/M7/M8 | 已在A加入B+rotate/submit顺序测试 |
| 私有文件共享 MT16 | M0/M5/M8 | 真微信允许/拒绝/真实TTL/字节hash |
| worker/GC MT17 | M5/M8 | 系统来源拒伪造+跨队对象不误删 |
| 所有业务统计 MT18 | M3/M4/M6/M8 | action全量映射+超批次/搜索/聚合 |
| 账号/缓存/深链 MT19 | M2/M7/M9 | 新旧链接/取消/换机/换账号 |
| 受控开通 MT21 | M3/M8 | 重启/双开通/已消费/同键异输入 |
| 配额/备份恢复 MT22 | M0/M5/M8/M9 | A恢复不改B、同hash文件互不影响 |

基础云化A/T/F/N/R/L/O等验收继续按BASE-DESIGN跑，同队fixture与多团队MT矩阵叠加，不以MT通过免除任务/附件/财务原规则。

## 7. 人工配置与未验证事项清单

| 项目 | 由谁完成/现实步骤 | 对任务的影响 |
|---|---|---|
| 远端环境权属/登录 | 用户本人扫码，有权账号核实AppID/env；AI整理本地配置与步骤 | 未完成可写本地代码，不能真实部署/验收 |
| 云能力/套餐/费用 | 有权平台管理者确认数据库/私有存储/定时/备份及预算 | M0记录，不猜价格；不足按门禁处理 |
| 团队开通 | 确认每队名称/owner，本人获取参考号，平台运维执行受控开通 | 不索要secret；同人第二队需新参考号 |
| 真实测试身份 | 多微信体验名单与两台设备；用户配合扫码/切账号 | 单元/模拟不能代替跨人/设备证据 |
| 隐私/正式审核 | 实际资料收集用途、文件与联系方式保留、类目/隐私文案 | 正式发布前需要实际确认，不能凭代码通过 |
| 上传/TTL/规范fileID恢复 | AI先用隔离能力试验证明当前SDK/套餐 | 失败选择已列备选；不能把不可能能力写成完成 |

独立可推进路径：环境权限未就绪时完成schema、拒绝测试、构建、领域服务及上下文协调；PUT不成立改已验证函数分片；二维码不成立用手工码；统计/索引失败显式不可用并修复，不以本机数据或0兜底。

## 8. 执行记录格式与交接规则

每阶段记录日期、源码hash、涉及action/集合/路由、实际命令/退出码/用例数、证据层、未跑原因、需要人工的具体一步。真实验收另记AppID/env、SDK/运行时、函数包hash、脱敏账号与角色、fixture和预期/实际结果。

证据状态只用PASS/FAIL/NOT_RUN/BLOCKED并解释，不把“计划具备”写成“功能已有”。本文件所有复选框保持未勾选，直到实施与对应验证真的完成。完成设计交付只代表文档足够执行，不代表云数据库/云函数/文件共享已经上线。
