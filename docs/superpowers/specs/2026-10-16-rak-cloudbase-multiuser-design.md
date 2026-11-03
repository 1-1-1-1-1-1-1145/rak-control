# Rak 社团小程序：CloudBase 多成员正式使用设计

> **2026-10-17续订：本文件保留作云化基础参考。** 当前设计以[多团队切换与隔离设计](2026-10-17-rak-multi-team-isolation-design.md)为准，实施入口为[多团队计划](../plans/2026-10-17-rak-multi-team-isolation-plan.md)。本文件的单社团、全局唯一owner、system_config单clubId、全局姓名/职务、v1无scope及仅env/user缓存等假设已被覆盖；其余文件可靠性与业务规则仍适用。当前主目录已存在Git；本文件旧“无.git”描述仅为历史快照，不适用于新执行。两轮文件均是方案，未据此开发/部署/验收。

日期：2026-10-16（Asia/Shanghai）
状态：设计交付；尚未实施、部署或进行真实云端验收。
配套实施计划：`../plans/2026-10-16-rak-cloudbase-multiuser-plan.md`。
适用项目：`C:/Users/24800/Desktop/小程序/rak-control`，不适用于旁边的 OA 项目、备份目录或其他 Rak 工程。

## 1. 目标、授权与完成定义

### 1.1 本次用户要求

把当前本地演示小程序改造成社团成员可以共同使用的正式在线小程序：业务数据放云数据库，文件放私有云存储；**小程序不得直接访问云数据库，必须通过云函数访问**。保留任务、公告、成员、邀请码/入会、ROI、绩效及现有视觉体系。

用户已确认：本地主要是演示/测试内容，**正式云端从空业务数据开始，不迁移演示 JSON 或本机附件**。本轮只交付设计和实施计划；不得因此修改业务代码、部署云函数、更改线上规则、创建/删除线上数据、停用远端触发器。

换手机或移除小程序后，使用**同一微信账号、同一 AppID、同一正式环境**，应恢复云端成员身份、任务、公告、ROI 及已提交文件。不同微信账号不自动继承身份。未上传草稿/暂存的本机文件、主题偏好、下载缓存仍可能丢失；已经下载到别人设备的文件不能远程收回。

### 1.2 可观察的最终验收结果

1. 两个不同微信账号在两台设备上，看到同一社团的云端任务和发布公告；下拉刷新或重新进入页面后读到已提交变更。首版不承诺实时推送。
2. 成员认领 → 上传可选附件 → 交付；管理者在另一设备读取该轮附件并通过/驳回；重交保留旧轮次。
3. 清理客户端缓存或移除后重新进入，正式业务数据与已提交附件仍在；不出现演示人物、样例收支或身份切换入口。
4. 未入会、待审核、停用、离队身份不能读取内部内容；普通成员不能调用管理动作或读取其他成员的交付说明/附件。
5. 模拟客户端绕过 UI、直调数据库、伪造身份/角色/社团/fileID，均不能获得未授权数据或业务写入。
6. 并发认领只成功一人；重试不重复交付、审批、生成财务记录或消耗邀请码；断网未知结果可查询。
7. 生产构建走 cloud 模式，不依赖不存在的 rak-auth HTTP 地址；云端失败不得回退到本地演示并提示成功。
8. 发布前同时具备静态检查、自动化测试、真实隔离云环境测试、双账号真机验收证据。任何一层不得冒充另一层。

## 2. 本次源码核查：事实与缺口

以下为 2026-10-16 对实际文件的只读核查；行号为当日快照，实现后应重新定位。没有查询云控制台，因此不能据此断言远端有哪些资源。

| 范围 | 实际证据 | 结论 |
|---|---|---|
| 本地数据库 | `src/demo/runtime.ts:11-22`；`src/demo/adapter.ts:972-973` | 通过 Taro Storage 保存整个演示状态，不能跨设备共享 |
| 运行路径 | `config/build-mode.ts:19-47` | 当前只有 demo/HTTP；非 demo 强制 API_BASE，没有 cloud 模式 |
| 认证 | `src/services/domain-entry.ts:82-151`；`src/utils/auth-contract.js:51-71` | HTTP 微信 code 登录；已绑定响应强制要求 accessToken |
| 领域服务 | `src/services/domain-entry.ts`、`task.ts`、`roi.ts`、`club.ts`、`member.ts` | 是客户端/演示实现，不能证明服务端权限或接口存在 |
| 云函数 | 当前根目录无 `cloudfunctions/`；`project.config.json` 无 cloudfunctionRoot；`src/app.ts:7-10` 无 cloud.init | 必须新建正式业务云函数，不是修改环境 ID 就完成 |
| 历史清理 | `docs/DEAD-CODE-CLEANUP.md:52-56` | 原订阅提醒三函数于 2026-10-16 从本地移除；远端部署/定时器未核查 |
| 附件 | `src/pages/task/detail.tsx:62,90-108,151-159`；`src/types/domain.ts:92-98` | 仅 demo 能保存 localPath；非 demo 携附件提交直接报错 |
| 附件限制 | `src/utils/task-attachment-policy.js:1-16` | 最多 3 个、每个 10 MiB，选择 type=all；不等于所有格式可预览 |
| 交付历史 | `src/demo/adapter.ts:568-582` | 覆盖最新交付，没有独立轮次记录 |
| 页面守卫 | `src/components/page-shell.tsx:38-51`；多管理页 useDidShow | 未登录不被该角色壳完整拦截；部分页面先发请求 |
| 成员状态 | `adapter.ts:627-659` 与 `admin/members.tsx:77` | demo 服务和 UI 的 manager 管理对象范围不完全一致，云端必须统一 |
| 名册开关 | `member.ts:9`、`adapter.ts:622-625` | 注释说受开关限制，demo 实际未落实 |
| 错误传播 | `src/store/index.ts` 多个 TeamStore/ROI 方法 | 部分 catch 吞错，可能让调用方无法区分失败/成功 |
| ROI | `adapter.ts:803-829,912-917` | 元 number、宽松校验、设备时间；统计包含 CANCELLED |
| 生产初始化 | `docs/OPEN-QUESTIONS.md:C10` | 超管播种只有旧提案，未有可验证实现 |
| 测试 | `package.json:scripts`；`tests/` 三文件 | 共 17 个本地/契约/分页/构建用例；不能证明云端与多用户安全 |

本次未发现主项目或其祖先目录的有效 `AGENTS.md`。`docs/archive/AGENTS.original.md` 仅作为历史资料，不赋予部署授权。主项目没有 `.git`，不能承诺自动 commit 或 push。

## 3. 方案比较与推荐

| 方案 | 收益 | 代价/问题 | 裁决 |
|---|---|---|---|
| A. 补齐 rak-auth + PostgreSQL + 文件服务 | 保留历史 HTTP 契约，适合已有后端团队 | 当前未找到可运行后端；需维护服务器/域名/身份/数据库；不符合本次指定的云函数数据库路径 | 不采用 |
| B. CloudBase 云函数 + 文档数据库 + 私有云存储 | 与微信身份、当前云环境结合；不需自建常驻业务服务 | 需要重做身份适配、权限、事务和文件闭环，不能把本地 JSON 原样上传 | **采用** |
| C. 云数据库与旧后端双写/失败时回退 demo | 表面切换快 | 两套角色真源、丢写和错误成功提示；无法可靠协作 | 禁止 |

本设计在实施时取代旧 `CONSTRUCTION.md` 中“rak-auth 唯一业务后端/PG auth schema/JWT 登录”的对应约束，以及旧 COS/Flyway 实施路线。用户本次明确要求优先于旧文档；无需重复询问是否允许采用 CloudBase。旧产品规则、角色层级、单社团及现有 UI 保留。不得把 OA 公司模型、审批主题或订阅提醒当成本次业务需求。

需落地 ADR-0006 并同步旧文档，避免后续 AI 同时执行两份矛盾计划。历史 SQL 后端计划保留归档但标记已被本设计替代；本轮不擅自改其历史状态。

## 4. 总体边界与目录设计

```text
页面 / MobX Store
  → auth/task/club/member/roi/attachment 领域服务
  → 显式 backend adapter（demo 或 cloud）
  → cloud.callFunction(rakApi / rakFiles)
  → 平台可信微信身份 → 有效成员 → 能力 + 资源范围校验
  → 领域处理器 / 数据仓库
  → 云数据库 + 私有云存储

rakMaintenance：仅平台定时/受控管理调用，客户端禁止调用
  → 回收无引用草稿、处理文件验证工作、对账、指标重建、过期记录清理
```

### 4.1 必须遵守的边界

- `src/` 不出现数据库 SDK 实例、collection、doc、aggregate、watch、任意数据库代理、客户端自带筛选表达式。连查询/计数/聚合也必须调用云函数。
- 文件字节可采用云函数授权后的受限直传；这不等于客户端访问数据库。所有文件业务元数据、授权、确认、绑定和删除决策均在云函数。若直传能力不达标，走 §11.4 分块云函数路径。
- 所有集合客户端读写都拒绝，禁止为方便联调开启全员读写。服务端 SDK 仍具有高权限，所以每个处理器都必须自行做业务鉴权。[O1][O2]
- 静态 TabBar、美术资源仍随包；业务文件用云存储。主题与可丢弃草稿可本地存；本地不能作为正式业务真源。
- 首版不做数据库实时监听。提交成功后刷新相关列表；切页 useDidShow/下拉刷新重取；权限敏感详情每次重新鉴权。

### 4.2 云函数和代码目录（以下为待创建）

| 部署函数 | 职责 | 客户端入口 |
|---|---|---|
| `rakApi` | 会话视图、入会、任务、公告、成员、ROI、绩效、邀请码、命令结果 | 固定 action 白名单 |
| `rakFiles` | 上传会话、上传授权/分块、确认、文件状态、授权下载 | 固定 action 白名单 |
| `rakMaintenance` | 有租约的后台文件验证、过期回收、对账、统计重建 | 禁止客户端 invoke |

不是每个 action 一个部署函数。各业务模块独立文件，入口只分发，不把业务写成大 switch。拟创建：

```text
server/
  functions/{rak-api,rak-files,rak-maintenance}.ts
  shared/{identity,authorization,validation,errors,command,transaction,clock,logging}.ts
  modules/{auth,club,members,invites,join,tasks,announcements,roi,performance,files}/
  repositories/{users,members,tasks,submissions,files,commands,...}.ts
  contracts/{envelope,auth,tasks,files,...}.ts
  jobs/{file-verification,storage-cleanup,reconcile}.ts
  package.json / tsconfig.json
cloudfunctions/{rakApi,rakFiles,rakMaintenance}/
  index.js / package.json / 部署需要的配置（由脚本生成）
infra/cloudbase/{collections,indexes,database.rules,storage.rules,function.rules,environment}.json
scripts/{build-cloudfunctions,verify-cloud-artifacts,verify-cloud-config,check-no-client-db}.mjs
```

`server/` 是源代码，`cloudfunctions/` 是可独立上传目录；云函数包必须自包含，不能依赖上传目录外的 `../shared`。打包公用代码或复制本地生产依赖，显式 external 云 SDK；锁定并记录全部版本。`dist/` 仍由 Taro 生成，不手改产物。

### 4.3 构建与环境

引入 `TARO_APP_BACKEND=demo|cloud|http`：demo 仅开发；cloud 需 `TARO_APP_CLOUD_ENV`；http 仅保留为明确 legacy/test 选项，不作为本轮发布入口。禁止 demo/cloud 与 TARO_APP_DEMO 冲突；旧变量过渡时冲突直接构建失败。

- `cloud`：云初始化完成后 bootstrap；**不要求 API_BASE、不造 JWT、不走 HTTP 登录**。
- `demo`：保留本地示例和现有测试；存储命名空间与 cloud 完全隔离。
- 生产必须显式 cloud + 环境，缺失时失败；不默认选某个真实环境。
- 新增 `__RAK_BACKEND__`、`__RAK_CLOUD_ENV__` 编译常量，保留明确派生的 DEMO_MODE 以减少页面改动。
- project.config.json 恢复 `cloudfunctionRoot: "cloudfunctions/"`；继续 `miniprogramRoot: "dist/"`、requiredComponents、JS 压缩及现有图标。打包部署脚本校验根配置和生成配置的相对路径。

用户提供环境 `cloud1-d4g36r8z6a8908540`、AppID `wxa8bf102dcfdcec4c`，**只是已知配置，未验证归属、地域、套餐、数据库模式、云端资源与权限**。实施 P0 首先核实；该环境若已有重要数据，不得充当破坏性测试环境。推荐隔离 dev 与 prod 环境；资源/配额不足时明确记录替代隔离方案和不能执行的测试。

服务端按实际部署环境初始化，优先 `cloud.init({env:cloud.DYNAMIC_CURRENT_ENV})`；服务端部署清单同时校验预期环境和 AppID，不能直接比较 SYMBOL 和字符串。跨环境访问默认禁止。首选文档型云数据库；若现环境仅 PG 模式，需单独调整仓库实现/权限，不允许把文档 SDK 或传统存储规则直接用于 PG。

官方 registry 在 2026-10-16 返回 wx-server-sdk 4.0.2（其依赖 @cloudbase/node-sdk 3.17.2），及独立 @cloudbase/node-sdk 3.18.3。它们**不是本项目已安装版本**；P0 验证后固定精确版本与锁文件。wx-server-sdk 用于可信微信上下文和常规数据库/存储；若启用扩展存储 API，显式依赖兼容的 @cloudbase/node-sdk，禁止假定 wx-server-sdk 导出同名方法。[O5][O6]

## 5. 身份、初始超管与权限

### 5.1 可信身份链

1. 客户端经微信云 SDK 调用 `auth.bootstrap`。服务端在本次 handler 内调用 `cloud.getWXContext()`，检查可信 APPID、OPENID、实际环境。
2. `(appid,openid)` 仅用于内部身份映射，不能信任 event.openid/userId/role/clubId/permissions。缺少可信调用身份的用户请求立即拒绝。
3. 每次bootstrap先以确定性identity文档ID事务get-or-create identity与随机userId对应user；初始化前后均执行，同openid并发首次进入也只能保留一个映射/用户。ID用SHA-256(appid与openid的规范编码)，不向成员目录暴露openid；尚未入会的displayName允许空，不假定微信自动提供昵称。
4. 初始化前无 `rak_system_config/main`：仅创建本人无权限identity/user，生成不可晋升的随机referenceCode，返回SETUP_REQUIRED；join/invite/业务动作均返回setup_required。参考号有效30分钟（项目默认），identity保存referenceCode/referenceCodeHash/referenceExpiresAt，有效期内重复bootstrap复用，过期再换发；只向本人/受控运维开放，初始化事务标记referenceUsedAt。初始化后单社团由服务端 `rak_system_config/main.clubId` 定位；客户端clubId仅可作一致性提示，值不符拒绝。
5. 每次业务调用重新读取有效 membership；不将客户端缓存角色或 JWT 作为授权真源。请求处理全局变量不得缓存当前调用用户。
6. users 是个人资料；ACTIVE/LEFT/DISABLED 以 membership 为真源。适配既有 UserInfo.status 时从当前 membership 推导，避免两套启停状态。

建议 cloud bootstrap 契约（新定义，非现有接口）：

```ts
type CloudSession =
  | { state:'SETUP_REQUIRED'; referenceCode:string; referenceExpiresAt:string }
  | { state:'ACTIVE'; user:UserView; club:ClubBrief; permissions:string[]; membershipRevision:number }
  | { state:'UNBOUND'|'JOIN_PENDING'|'JOIN_REJECTED'; clubName:string; joinStatus:JoinStatusView }
  | { state:'DISABLED'|'LEFT'; message:string }
```

不能返回假 accessToken 来适配旧 normalizeLoginOutcome。分别定义 HttpLoginOutcome 与 CloudSession，再映射到统一 authStore 状态。cloud 模式不走 code2session，不需要把 AppSecret 放入小程序；如果以后调用需要 AppSecret 的外部 API，密钥仅存在服务端秘密配置。

### 5.2 初始超级管理员

- 不允许“第一个登录的人自动成为超管”、设置页改角色、自填 openid 或公开 bootstrap 密码晋升。
- 本人先真实进入隔离环境，`auth.bootstrap` 仅创建无成员权限身份记录并返回有期限的身份关联参考号；参考号不具备晋升能力，不等于管理员密码。
- 具备环境管理权的运维流程在控制台/受控脚本中根据参考号hash定位可信identity，校验有效期/未使用，人工核对本人账号，并明确填写本人displayName（1..16字）；不能仅用聊天或客户端提交的openid初始化。
- 受控事务创建club、owner membership、`rak_system_config/main`、审计与bootstrap完成标记并消费参考号；全程只允许初始化一次，重复运行无副作用。公开rakApi不提供授予super_admin的action。
- 仅有用户本人一个 super_admin；manager 由其任免。首版不提供超级管理员自助转移/删除/降级，账号丢失用受控运维恢复并审计。
- 后续经理任免由正常 UI → 云函数；修改数据库权限所需的云控制台管理员与社团管理者是不同概念。

### 5.3 权限矩阵

| 能力 | 未入会/待审核 | ACTIVE member | ACTIVE manager | ACTIVE super_admin |
|---|---|---|---|---|
| 最小入会页、本人申请状态、隐私说明 | 允许 | 允许 | 允许 | 允许 |
| 内部首页/任务/发布公告/ROI 概览与明细 | 拒绝 | 读 | 读 | 读 |
| 任务认领 | 拒绝 | 允许 OPEN | 同 member | 同 member |
| 交付与上传 | 拒绝 | 仅本人负责且可提交状态 | 仅本人负责且可提交状态 | 仅本人负责且可提交状态 |
| 他人的交付说明、轮次、附件 | 拒绝 | 拒绝 | 同社团读 | 同社团读 |
| 公告草稿/归档、任务发布/编辑/验收、ROI 维护 | 拒绝 | 拒绝 | 允许 | 允许 |
| 成员目录 | 拒绝 | 开关开启时的最小公开字段 | 同社团完整业务名册 | 同社团完整业务名册 |
| 私人申请联系方式/openid | 仅本人表单 | 拒绝 | 审批需要的联系字段；不回传 openid | 同 manager；运维另控 |
| 自己绩效 | 拒绝 | 允许 | 允许 | 允许 |
| 全体绩效/榜单 | 拒绝 | 拒绝 | 允许 | 允许 |
| 生成/撤销邀请码、审核入会 | 拒绝 | 拒绝 | 允许 | 允许 |
| 成员状态修改 | 拒绝 | 拒绝 | 仅普通 member | manager/member |
| manager/member 任免 | 拒绝 | 拒绝 | 拒绝 | 允许；不能授予 super_admin |
| 超管状态/角色修改、owner 转移 | 拒绝 | 拒绝 | 拒绝 | 普通业务接口仍拒绝 |

DISABLED/LEFT：除本人限制状态与隐私/帮助页外拒绝内部读写；邀请码或重新申请不能绕过禁用/离队记录，恢复需对应权限管理员显式操作。任务列表可见不代表附件可见，服务端按字段投影裁剪。

现代码允许 manager 认领并验收任务，未定义禁止自验。本次不暗改此业务规则；实施验收记录此行为，若社团另需双人验收，再作为独立规则变更。成员不能验收任何任务。

### 5.4 权限撤销与并发

- 对要求ACTIVE成员的关键业务写事务，重新读取 actor membership 并校验角色/状态，在同事务递增其 `mutationSeq`。角色任免/禁用也写同一 membership，使竞争写产生事务冲突并重试后重新鉴权。只读 membership 的快照不足以保证与禁用线性排序。例外明确为identity-only动作：auth.bootstrap、join.submit/status、invite.redeem及其最小结果恢复；它们只使用可信identity，在既有membership为DISABLED/LEFT时仍不得恢复访问。
- file.putChunk每片仍重新读membership和session，但只产生不可下载/不可绑定的暂存对象，不要求每片递增actor全局mutationSeq；与停用竞态时最多留下待清理暂存片。file.init、确认发布、任务ATTACH和正式业务写必须参加授权栅栏。P0实测同一manager并发写的热点；不能为降低冲突跳过最终发布鉴权。
- 事务涉及被指派人/申请人时也校验目标状态；关键状态变更写入相关目标文档，按固定文档键顺序操作。全站 user 禁用若将来新增，必须纳入同一授权栅栏，不能另加未参与事务的状态源。
- 已返回的数据、已下载文件和尚有效的签名 URL 不能被撤销。已开始的只读响应也存在请求时效窗口，不能声称“瞬间清除所有已看内容”。
- 非成员只可查询当前可信identity本人join.submit/invite.redeem的最小状态与申请/入会结果，也可通过join.status/auth.bootstrap恢复；不能取其他业务命令或内部响应。权限变化后仅重新鉴权可得的字段可以返回，不能以幂等历史响应绕过权限。

## 6. 入会、邀请码与页面守卫

保留邀请码直接入会、无邀请码申请审核两条路径。邀请码默认 10 次/30 天，服务端可验证范围 1..100 次、1..30 天。为减少猜测，云模式新码建议采用 12 位非歧义大写字母数字；须同步原 `login.tsx` 的 7 位限制。旧本地示例码不迁移。

- 用户输入码 → `invite.redeem`：规范化大小写，查 digest，服务端检查所属社团、有效期、未撤销、额度；事务重读 invite/member 并原子消耗一次额度、创建 member、写审计/命令结果。
- 同一个用户重复兑换不能多消耗次数；LEFT/DISABLED 拒绝兑换；已在册用户返回自身状态，不创建第二个 membership。
- 邀请入会除互斥的code/sceneToken外还要求displayName（1..16字），与新建membership同事务写本人user；不从微信登录自动猜昵称。申请批准仅为新成员以申请name填user；已ACTIVE时保留其现有资料。
- 申请键固定为 hash(clubId,userId)，保证同一人至多一个当前申请；被拒后允许显式重提并递增 attemptNo，审计保留历次审核记录。禁止通过客户端提交 applicantOpenid。
- 申请/邀请并发收敛：join.submit发现已ACTIVE返回already_member最小状态，不创建新申请；invite.redeem成功同时将本人PENDING申请置APPROVED并记resolution=INVITE、审计。join.approve发现已ACTIVE时只把PENDING申请收敛为APPROVED/resolution=ALREADY_MEMBER，不覆盖其角色、状态、joinedAt或展示名，也不重复扣邀请码。所有路径读写同一member/当前申请文档，禁用/离队一律拒绝借此恢复。
- 审核事务读取 applicant identity、当前 membership、申请 revision、审核者 membership；批准时只能创建普通 member。多管理者同时批准/拒绝，只有一个预期 revision 成功；不出现又通过又驳回的覆盖。
- 申请人仅获取本人状态；管理列表分页返回审批字段，不给联系方式全员可读。
- 邀请码摘要用于查找；首版生成当次显示完整code，列表仅maskedCode。完整code不写通用命令结果缓存；create响应丢失后同mutationId只恢复inviteId/maskedCode和shareCodeAvailable:false，UI提供撤销后重新生成，不把maskedCode当可分享码。
- 小程序码为同一个invite的额外入口：服务端生成高熵sceneToken（目标32个URL安全字符，须P0验证平台限制），在私有invite记录存sceneToken及其hash，管理者通过inviteId可重新生成二维码。sceneToken也是邀请码性质的bearer，不能进普通DTO/日志；私有DB管理员有读取能力，不能声称明文数据库泄露后仍保密。redeem输入为互斥的 `{code}` 或 `{sceneToken}`，按codeHash/sceneTokenHash定位同一invite，再执行相同额度/过期/撤销/成员状态事务；不向未入会者返回完整手工码。小程序码生成的openapi权限、scene解析、页面/版本参数需真实测试；未具备条件时先提供可复制邀请内容，不伪造二维码成功。

前端统一 guard 顺序：`云初始化 → auth bootstrap resolved → ACTIVE → requireRole → 页面数据请求`。所有主包详情、管理分包、深链、下拉刷新和 useDidShow/useEffect 都遵守；bootstrap 从 LOADING 变 ACTIVE 后必须触发一次加载，不依赖只执行一次的页面显示回调。云函数仍是最终权限边界。

成员停用/登出时清理 auth/task/team/roi Store、私有详情缓存、查询 generation 和授权 URL 缓存；请求返回前检查当前身份 generation，防旧用户迟到响应重新填充 Store。cloud 退出只是结束本地业务视图，重新进入可用微信可信身份识别，不能假装注销微信账号。

## 7. 云数据库模型与字段约束

### 7.1 通用规则

时间字段使用服务端 Date/UTC 存储，响应转 ISO 字符串；业务日期用 `YYYY-MM-DD`，周期时区 Asia/Shanghai。所有可变业务文档含 `schemaVersion:1, revision:number, createdAt, updatedAt`；新增 revision=1，每次成功修改 +1。只接收白名单字段，拒绝原型污染、Mongo 操作符对象、集合名/查询表达式、客户端 createdBy/role/openid。

随机 ID 服务端生成。确定性 ID 仅用于身份、成员、唯一申请、幂等等已说明用途；组合值通过有分隔/长度的规范编码后 hash，不能裸拼接产生歧义。云数据库没有 SQL 外键，关联存在性/同社团归属/唯一性由处理器和事务负责；可用唯一索引时另设约束，但不得把它当作唯一防线。

### 7.2 集合清单

| 集合 | 主要字段与主键 | 约束 |
|---|---|---|
| `rak_system_config` | `_id=main, clubId, ownerUserId, appId, initializedAt, bootstrapVersion, maintenanceFlags` | 无公开任意更新；不存 SDK Secret |
| `rak_identities` | `_id=hash(appid,openid),appId,openid,userId,referenceCode?,referenceCodeHash?,referenceExpiresAt?,referenceUsedAt?` | 平台可信来源，客户端不读；同一身份唯一；参考号hash受控查找/唯一，参考号不参与授权 |
| `rak_users` | `_id=userId,displayName:null或1..16字,duty?,createdAt,updatedAt` | 入会/owner初始化使展示名非空；不接受role，不放membership第二真源 |
| `rak_clubs` | `_id, slug, name, description, settings:{memberDirectoryVisible}, status, revision` | 单社团；ACTIVE/MAINTENANCE；设置白名单 |
| `rak_members` | `_id=hash(clubId,userId), clubId,userId,role,status,joinedAt,revision,mutationSeq` | role 三值；status ACTIVE/LEFT/DISABLED；owner 不可从业务接口撤销 |
| `rak_invites` | `_id,clubId,codeHash,maskedCode,sceneToken,sceneTokenHash,createdBy,maxUses,usedCount,expiresAt,revokedAt,revision` | 两种摘要唯一；sceneToken仅二维码受控生成使用；不以usedCount客户端值更新 |
| `rak_join_requests` | `_id=hash(clubId,userId),clubId,userId,name,wechat,reason,status,attemptNo,resolution?,reviewedBy,reviewedAt,revision` | status=PENDING/APPROVED/REJECTED；resolution=MANUAL/INVITE/ALREADY_MEMBER；当前申请唯一，历史写审计 |
| `rak_tasks` | 现 Task 业务字段 + `revision,currentRound,lastSubmissionId` | 仅保留最新交付引用/摘要；不嵌入文件字节或无界历史数组 |
| `rak_task_submissions` | `_id,clubId,taskId,round,submittedBy,note,attachmentIds,taskRevisionAtSubmit,status,reviewGrade,reviewNote,reviewedBy,reviewedAt,createdAt` | status=SUBMITTED/APPROVED/REJECTED；每轮独立；note/附件绑定后不可改；审核结果只完成一次且与task同事务 |
| `rak_announcements` | 现字段 + `revision` | DRAFT/PUBLISHED/ARCHIVED；作者服务端写入 |
| `rak_roi_items` | 现字段，金额改 `costCents,revenueCents`，加 `accountingDate,deletedAt,revision` | 软删/审计；客户端不传计算结果 |
| `rak_upload_batches` | `_id=hash(taskId,targetRound),clubId,taskId,targetRound,taskRevision,ownerUserId,slots（长度3，索引0..2）,state,revision` | OPEN/CLOSED；每槽sessionId/attachmentId/state；所有预占/释放/提交读写同一doc，禁止事务where计数 |
| `rak_upload_sessions` | `_id,clubId,taskId,userId,taskRevision,targetRound,state,transport,declaredSize,actualSize,sha256,stagingPath,candidateFileID,uploadExpiresAt,confirmedUntil,latestSignatureExpiresAt,leaseUntil,fence,revision` | 状态机及当前任务版本约束；具体名额在batch |
| `rak_upload_credentials` | `_id=attemptId,sessionId,state,requestedAt,actualExpiresAt,cleanupNotBefore` | 仅签发尝试元数据，不存token/authorization；ISSUING/SIGNED/UNKNOWN；未知结果按最大证明期限保守回收 |
| `rak_storage_attempts` | `_id=attemptId,sessionId,kind,objectPath,fileID?,state,writeOutcome,leaseUntil,fence,createdAt,updatedAt` | kind=STAGING/CANDIDATE/CHUNK/FINAL；state=RESERVED/WRITTEN/PUBLISHED/GC_PENDING/DELETED；writeOutcome=NOT_STARTED/UNKNOWN/CONFIRMED；副作用先登记路径，恢复采用与GC抢占写同一doc |
| `rak_upload_chunks` | `_id=hash(sessionId,index),sessionId,index,size,sha256,fileID,state,attemptId` | 仅分块备选启用；已接收片不可变 |
| `rak_attachments` | `_id,clubId,taskId,sessionId,submissionId?,uploadedBy,originalName,sizeBytes,sha256,mime,fileID,storagePath,integrityState,scanState,lifecycleState,createdAt,attachedAt?,purgedAt?` | fileID存SDK规范值；完整性与恶意扫描分开；URL不落库 |
| `rak_commands` | `_id=hash(actorId,action,mutationId),clubId,actorId,action,inputHash,status,resultRef,resultSummary,createdAt,completedAt,resultUntil,retainUntil` | status=SUCCEEDED/DETERMINISTIC_REJECTED/ACCEPTED_JOB；原子幂等；成功/确定失败不可重做，job完成状态另查 |
| `rak_jobs` | `_id,type,resourceId,state,runAfter,attempts,leaseUntil,fence,lastErrorCode` | 仅可信后台处理；只存简要错误 |
| `rak_audit_events` | `_id,clubId,actorId,action,resourceType,resourceId,requestId,mutationId,reason?,beforeSummary,afterSummary,createdAt` | 追加；不记录原文件/临时URL/邀请码明文/完整联系方式 |
| `rak_rate_limits` | `_id=hash(subject,action,bucket),count,windowEnd` | 身份可信；可配置限流，不依赖IP作为唯一身份 |

仅后台需要时才创建分块/后台缓存集合；不能因为表列得全就部署未使用的数据表。统计初版从权威记录聚合，必要时再加 `rak_stats`，它只是可重建派生数据。

### 7.3 输入上限（新增云接口契约）

文本先按字符串类型及UTF-8请求体上限校验，再trim；计数采用明确Unicode码点规则并与前端一致。单行字段拒绝全部控制字符；任务描述/验收标准、交付说明/审核备注、公告正文、ROI备注等多行字段先把CRLF/CR规范化为LF，只允许LF换行，其余NUL/控制字符拒绝；前后端采用同一规范化规则。

| 输入 | 限制 |
|---|---|
| 展示名/申请名 | 1..16 字 |
| 申请微信号/原因 | 1..32 / 1..80 字，不推断已实名认证 |
| 社团名/简介 | 1..32 / 0..200 字 |
| 任务标题/描述/验收标准 | 1..40 / 1..2000 / 0..2000 字；category 为当前六个枚举 |
| 交付说明/驳回原因/验收备注 | 1..1000 / 1..500 / 0..500 字 |
| 公告标题/正文 | 1..60 / 1..10000 字，纯文本换行；不执行 HTML |
| ROI 标题/备注 | 1..64 / 0..2000 字 |
| 参与人数 | 整数 0..999999 |
| 单项成本/收益 | 十进制元字符串，0..999999999.99，最多2位小数；转分后安全整数 |
| 文件 | 1..10 MiB；每次提交 0..3 个；originalName 1..180 字，去目录分隔及控制符 |
| 列表 | pageSize 默认20、最大50；keyword最多80字，不接收原始正则 |

金额不能先 Number 后 round 掩盖超两位小数；表单保留字符串，服务端解析分，展示层再格式化。safe integer 校验应用到单项和累计；超额报 amount_out_of_range，不溢出后返回看似正常数字。

## 8. 接口协议、事务与幂等

### 8.1 云函数统一信封

```ts
type CloudRequest<T> = {
  apiVersion:1; action:string; requestId:string;
  mutationId?:string; expectedRevision?:number; data:T;
}
type CloudResponse<T> =
  | { ok:true; requestId:string; data:T; serverTime:string }
  | { ok:false; requestId:string; error:{ code:string; message:string; retryable:boolean; details?:SafeDetails }; serverTime:string }
```

action 仅能取注册表常量；未知版本/动作先拒绝，无默认泛 CRUD。requestId 仅诊断，mutationId 才做幂等，两者不能混用。所有接口 data 无 raw openid/fileID/集合条件；`targetUserId` 仅用于明确管理目标且云端校验。函数内部未预期错误映射 internal_error，不回堆栈、SQL/集合详情或SDK凭证。

错误至少包括：`identity_required, app_mismatch, environment_mismatch, setup_required, membership_required, membership_disabled, membership_left, permission_denied, resource_not_found, validation_failed, revision_conflict, invalid_transition, task_not_claimable, attachment_not_ready, attachment_forbidden, upload_expired, upload_cancelled, idempotency_conflict, command_expired, rate_limited, storage_unavailable, stats_unavailable, result_unknown, internal_error`。未完成动作开发期可显式not_implemented，但生产门禁禁止所需动作保留此占位。already_member是入会成功/已在册的最小结果，不当越权恢复错误。内部维护语义码与稳定用户文案，不把传输HTTP成功视为业务成功。

### 8.2 动作注册表

| 模块 | action | data 主要字段 |
|---|---|---|
| 身份 | `auth.bootstrap, auth.me` | 无身份自报字段 |
| 入会 | `join.submit, join.status` | name,wechat,reason；状态只查本人 |
| 邀请 | `invite.list, invite.create, invite.revoke, invite.redeem, invite.qr` | create限次/天数；revoke/qr传inviteId；redeem为code或sceneToken互斥输入，并传displayName |
| 摘要 | `club.dashboard, profile.summary` | 无身份自报；返回授权计数/最小摘要和asOf，不依赖全量名册 |
| 社团 | `club.get, club.update` | 白名单 name/description/settings |
| 成员 | `member.list, member.setStatus, member.setRole` | cursor/filter白名单；targetUserId/status或role |
| 审核入会 | `join.list, join.approve, join.reject` | requestId（业务申请ID，字段命名joinRequestId避免与诊断ID混淆）、expectedRevision、rejectReason |
| 任务 | `task.list, task.get, task.create, task.update, task.claim, task.submit, task.approve, task.reject, task.archive` | id/筛选；submit note,attachmentIds；review submissionId,grade或reason |
| 历史交付 | `submission.list, submission.get` | taskId/cursor；仅负责人/管理者 |
| 公告 | `announcement.list, announcement.get, announcement.create, announcement.update, announcement.publish, announcement.archive` | id、白名单内容、expectedRevision |
| ROI | `roi.list, roi.get, roi.create, roi.update, roi.delete, roi.overview` | 金额字符串、日期、period；delete为业务软删 |
| 绩效 | `performance.mine, performance.list` | mine不接收他人ID；list仅manager+ |
| 幂等结果 | `command.status` | action,mutationId；只查当前调用者且重新授权 |
| 文件 | `file.init, file.status, file.confirm, file.cancel, file.downloadUrls, file.previewDraft` | init传taskId/expectedTaskRevision/name/declaredSize；status/confirm/cancel仅sessionId；downloadUrls传attachmentIds；previewDraft仅attachmentId且只本人的有效CONFIRMED/DRAFT；绝不传任意fileID |
| 分块备选 | `file.putChunk` | sessionId,index,base64,chunkHashHint |

任何新增 action 必须同时声明 input schema、权限、资源过滤、事务/幂等及测试。成员列表/申请列表/邀请码不能继续无限数组全量返回。

### 8.3 事务原则

官方当前文档列出：服务端事务仅doc操作、不支持where；至多100操作/30秒。P0仍需以锁定SDK和环境验证。简单业务事务目标少于20操作；含3附件/未选会话收敛的最坏提交事务按实际读写逐项预算，目标不超过40且必须低于已验证平台上限，全程无网络/存储副作用。不能将SDK示例返回外壳未经适配当业务数据。[O3]

事务外按有授权范围的索引定位 ID → 事务内用 doc(id) 重读并验证全部条件。身份/成员/申请等唯一记录采用确定性 ID；不写“事务内 where 查唯一申请”这种不可执行步骤。禁止在可重试事务回调内发消息、上传、复制或删除文件。

任务认领、交付、审批、归档、邀请码兑换、入会审核、角色/状态修改、ROI写入都要与 commands/audit 原子完成。任务交付还在同事务绑定最多3个附件和创建独立 submission。统计如果可重建则可事务后刷新，但响应注明数据更新时间，不声称跨多个独立聚合调用具有同一快照。

### 8.4 重试窗口和结果未知

沿用此前用户接受的业务窗口：自动重试资格24小时、完整结果查询7天、幂等记录30天；这不是临时URL/上传凭证的有效期。

- mutationId使用客户端UUIDv7（含可校验时间），客户端先按bootstrap可信serverTime校准本机时间偏移；校准失败显示明确时钟/网络错误，不阻止用户纠正后重试。首次请求检查年龄≤24小时、未来偏差≤5分钟。历史同键先查记录；同键不同规范payloadHash返回idempotency_conflict。服务端不能只信可随意改写的独立clientCreatedAt，也不能用诊断requestId代替。
- inputHash覆盖规范化apiVersion/action/data/expectedRevision，排除requestId、传输重试次数等诊断字段；schema归一化与hash算法版本固定。客户端可以伪造新时间生成新命令，不能因此承诺业务语义完全去重；状态机/revision/轮次唯一性仍须独立校验。
- 成功写与命令结果在同一个事务提交。失败前无写；数据库冲突可重新读取后有限重试。
- command.status分别返回SUCCEEDED、DETERMINISTIC_REJECTED、ACCEPTED_JOB（只表示job已接收，完成另查file.status）、ABSENT_IN_WINDOW或EXPIRED。查不到记录但仍在24h内是ABSENT_IN_WINDOW，原请求可能尚在提交，不是确定失败；只能原mutationId+原payload有限重试/继续查，不能换键。确定失败只缓存已鉴权且业务条件拒绝的最小结果；鉴权/传输失败不必写命令，仍不能把不存在当成功/失败证明。
- 网络超时：UI显示“结果确认中”，先 `command.status`，不立即显示失败后换新键重做。仅403/校验/业务冲突是确定拒绝，不自动重试。429/可恢复5xx采用最多3次短重试、指数退避+jitter；24小时是资格上限，不持续刷请求24小时。
- 24小时后不重放未知写入，提示查结果/刷新；7天后仅保留最小状态/业务记录引用，敏感完整响应清除；30天后清幂等记录。带旧UUID时间的未知命令仍被年龄门禁拒绝，防记录清理后旧请求再执行。
- 离线保留命令元数据必须按 environment/userId 隔离；恢复时确认身份、有效期、任务revision，并复用原 mutationId。失去本机字节不能凭会话自动恢复未上传文件。首版不承诺离线队列和后台长期执行，只实现交互重试/未知结果恢复。
- 返回已有幂等结果前也必须重新鉴权并重新投影，不向被禁用/降权者泄露历史管理响应。identity-only入会动作按§5.4的最小结果例外处理。临时上传/下载凭证不缓存为通用command结果；file.init先幂等创建稳定会话，签发授权是事务外可恢复第二阶段，见§11.3。

## 9. 任务、交付历史及公告

### 9.1 任务状态机

```text
OPEN --认领--> CLAIMED --交付--> SUBMITTED --验收通过--> APPROVED --归档--> DONE
                                       └--驳回--> REJECTED --重交--> SUBMITTED
```

- 创建：manager+，服务端写 createdBy；更新仅 OPEN，比较 expectedRevision。
- 认领：所有有效成员可认领；事务必须同时验证 OPEN、assigneeId为空、revision，两个成员同时认领只有一个成功。
- 交付：当前负责人、CLAIMED/REJECTED、说明必填、附件0..3。taskRevision/targetRound与上传会话相符；所有附件integrityState=VERIFIED、scanState在NOT_CONFIGURED/PASSED/UNSCANNABLE允许白名单、session=CONFIRMED、同上传者/任务/环境、DRAFT且confirmedUntil未过期；缺失/未知安全状态拒绝。
- targetRound 在初始化上传时由服务端从 currentRound+1 得到；提交时再比较。无附件也创建轮次。不能让客户端选择历史round。
- 同事务：新submission、task=SUBMITTED/currentRound+1/lastSubmissionId、所选附件/会话转ATTACHED+submissionId、命令结果、审计。遍历本轮batch最多3槽，未选会话置CANCELLED并fence++、未选DRAFT附件置GC_PENDING，然后batch置CLOSED；不能先封闭batch留下可上传/预览的旧草稿。无附件且不存在batch时不创建无意义batch。每个交付不可变note/attachmentIds，不能重交覆盖旧轮次；事务操作数P0按最坏3槽预算验证，不机械承诺所有复杂事务少于20操作。
- 验收：manager+，传 submissionId+expectedRevision；只能当前待验收轮次；A/B/C/D有效，驳回原因必填。重复/迟到审核不能覆盖已经处理的轮次。
- 驳回后重交：创建下一轮；旧轮 note/附件/驳回原因/审核人可查。旧附件不自动复制为新轮，首版需重新选择上传；历史仍保留。
- 归档：APPROVED→DONE；保留交付与附件，不能调用“删除本机旧附件”逻辑误删云端历史。
- 首版不新增撤单/重分配状态。需要改派或撤销时另行设计状态迁移，不能通过任意 update assigneeId 实现。成员被停用时遗留任务在管理列表标识“负责人不可用”，由管理者明确处理后续版本功能。

一般成员读取 task.get/list 的公开业务字段，不返回他人的 submitNote、submissionAttachments、质量备注/驳回私密内容；可返回任务状态、负责人展示名及非敏感统计。负责人和管理者经 submission 接口读完整内容。绩效取数与此投影独立，不因为前端需要数量而放开附件。

### 9.2 公告

保留 DRAFT→PUBLISHED→ARCHIVED（允许管理者编辑未归档公告；无强制额外审批）。全体有效成员只读 PUBLISHED；manager/super 的管理列表可读草稿和归档，普通首页不出现草稿。列表与详情都在查询前做范围限制，隐藏UI不能代替服务端过滤。

发布作者/时间由服务端写；update/publish/archive都比 revision、写审计、幂等。已归档不能编辑/重新发布。删除语义是归档，不物理删除审计。公告正文纯文本，不解释上传文件为HTML。保留此前标题与作者分行的排版。

## 10. ROI、绩效、分页与首页

### 10.1 ROI 精度和统计口径

- 持久化金额为人民币分的安全整数；API输入元十进制字符串，输出显示可用分+显式格式化或由适配器转换旧DTO（禁止累计浮点元）。
- 净额=收益分−成本分；ROI=(收益分−成本分)/成本分；成本0返回null并显示“—”，不是0或Infinity。
- 保留当前口径：**统计包含 PLANNING/ACTIVE/DONE/CANCELLED 的未删除记录**，不在云化时悄悄改为仅 DONE。界面写清“全部未删除项目，含已取消”；取消状态不等于删除。若以后改口径须版本化和测试。
- accountingDate=periodStart（有则使用）否则创建日（Asia/Shanghai）。创建/编辑时计算并落库；periodStart为空时编辑沿用原创建日，不因编辑改月份。periodEnd须不早于periodStart。
- accountingDate是上海业务日字符串，month/quarter/year按上海日历生成同类型的左闭右开字符串边界（如2026-10-01至2026-11-01），直接范围查询；不能拿UTC Date与日期字符串比较。createdAt/updatedAt仍是UTC时间。all不加日期限制。趋势以所选统计集合按月汇总，显示最近6个自然月、缺月补0；all视图也只展示最近6月趋势但总额覆盖全部，并标注该差别。
- ROI overview一次云端聚合给出成本/收益/净额/数量同一组结果，服务器计算ratio；列表条数、概览与筛选采用一致的deleted/status/club过滤。列表翻页期间有编辑时可能变化，下拉重取；不承诺跨请求冻结快照。
- 删除改软删，保留操作者/时间/审计；无在线对账/支付，首版仍是项目总成本/收益管理，不能宣称新增了银行流水或完整财务账本。

### 10.2 绩效保持现有定义

来源 `adapter.ts:887-908`：claimedCount=claimedAt非空任务数；approvedCount=当前APPROVED/DONE；rejectedCount=曾有驳回任务数（同一任务多轮仍计1）；inProgressCount=CLAIMED/SUBMITTED/REJECTED；A/B/C/D=90/75/60/40；完成率=approved/claimed（无认领为0）；质量均分仅已通过任务；综合分=Math.round(完成率×质量均分，缺均分按0)。

云端从有范围的任务/交付记录计算，不信客户端传分；曾驳回从历史submission中存在REJECTED判断，每task最多计1，不能因重交清空task最新驳回字段而漏计。member只读自己；manager+读全部。performance.list按(compositeScore desc,userId asc)稳定排序、pageSize默认20最大50，cursor携score/userId/queryFingerprint/asOf；数据并发变化时刷新，首版不承诺跨请求冻结排名。dashboard榜单只manager+取top5，成员不借摘要获取全员分数；任免页面只依赖member.list，移除为任免而拉全员绩效的耦合。

统计须服务端有范围聚合或内部逐页穷尽，不能把SDK默认首批当全员。P0/集成记录实际人数/任务/交付规模与耗时，仓库设置经验证的最大扫描数/执行预算；达到预算却未穷尽时返回stats_unavailable、明确暂不可用，不返回部分榜单伪成功。容量不足时使用可重建服务端派生统计并另留验证记录，不让客户端全量取数。以后改为按轮计驳回必须显式变更定义。

### 10.3 列表和搜索

云接口统一 `{items,nextCursor,hasMore,asOf}`；页面由 cloud adapter 迁移，不能把 cursor 填入旧page数字字段。若旧Store暂需page，适配器维护queryKey→page→cursor映射；变更筛选/身份/环境清空；失败不推进游标。推荐直接将列表Store改为cursor并保留现任务请求generation gate。

- tasks/ROI/members/joins/invites：稳定 `(createdAt desc,_id desc)`；任务列表支持status数组枚举、category、keyword、assignee=me或经授权userId。
- 公告：`(pinned desc,createdAt desc,_id desc)`；cursor同时携带这三个排序值，不能用只有createdAt的通用cursor。
- 同时间数据用 `createdAt<cursorTime OR (createdAt==cursorTime AND _id<cursorId)`；公告再加 pinned 分层条件。cursor绑定action/queryFingerprint/clubId并签名或严格校验，权限仍每次重新算。
- keyword先长度限制、正则转义；首版小规模社团可用有范围的字面量正则查询，但不得误称“普通索引加速了任意子串搜索”。如数据量/超时超阈，必须有明确容量门禁或单独搜索索引设计；不在小程序全量下载再筛选。
- total不作为是否有下一页的唯一依据；limit=pageSize+1（须P0核查SDK上限）。需要数量时用相同授权filter单独count，标记统计时点。目录关闭时仍可给已授权在册总数，但不能泄露名册。

现首页/个人页用fetchTasks(size:1).total取计数，团队用完整members算人数；迁移必须替换为明确摘要契约，不能伪造total。`club.dashboard`返回activeMemberCount、openTaskCount、本人inProgressCount/submittedCount、公开公告摘要、asOf；只有manager+返回pendingReviewCount及top5绩效等管理摘要。`profile.summary`只返回本人任务/绩效摘要与asOf。名册关闭仍可读取在册总数，无成员明细。摘要各查询同一权限范围、服务端计算；多查询有并发变更时不是单一事务快照，response标记asOf而不承诺瞬时全站一致。

### 10.4 最低索引清单

所有含clubId的索引均将clubId作为前缀；实现查询清单与索引清单一对一维护。`_id`是否可在复合索引中显式添加、方向/多个in条件限制必须P0实测，不写不被数据库接受的索引定义。若不支持，增加不可变唯一sortKey并保持同一游标语义。

| 集合 | 主要复合索引（逻辑定义） |
|---|---|
| members | clubId,status,createdAt,_id；clubId,role,status,createdAt,_id |
| identities | referenceCodeHash唯一（仅有值记录，需验证稀疏/部分索引支持）；referenceExpiresAt用于清理参考号字段，不删除identity |
| tasks | clubId,createdAt,_id；clubId,status,createdAt,_id；clubId,assigneeId,createdAt,_id；clubId,assigneeId,status,createdAt,_id；category组合按实际筛选补齐 |
| submissions | clubId,taskId,round(desc)；同task+round逻辑唯一 |
| announcements | clubId,status,pinned(desc),createdAt(desc),_id(desc)；manager不筛status的对应索引 |
| ROI | clubId,deletedAt,accountingDate；clubId,deletedAt,status,createdAt,_id；category组合 |
| invites | codeHash唯一；sceneTokenHash唯一；clubId,createdAt,_id |
| join requests | clubId,status,createdAt,_id |
| uploads/chunks | session.userId+state+uploadExpiresAt；session.state+confirmedUntil；credentials.sessionId+cleanupNotBefore；storage_attempts.sessionId+state / state+updatedAt；chunks.sessionId+index唯一 |
| attachments | clubId,taskId,submissionId；lifecycleState,createdAt |
| commands/jobs/audit | retainUntil；jobs.state,runAfter；audit.clubId,createdAt,_id |

TTL是否支持和实际删除时效须验证；任何授权/过期判断不能等待TTL物理删除才生效。

## 11. 私有附件全流程

### 11.1 不变条件与安全规则

- 保留最多3件、单件10 MiB、可选择任意格式；支持选择不代表支持预览。拒绝空文件，扩展名仅作展示提示，不当安全结论。
- 官方传统存储规则支持 `read:false,write:false` 拒绝客户端，服务端仍可访问。基线采用该规则；不能改公开读写来让同社团成员共享。[O2]
- 正式fileID存数据库，仅来自SDK成功结果；路径服务端生成，不包含姓名/openid/原文件名；不手工拼cloud://字符串。
- 所有业务下载走 `attachmentId→有效成员/任务关系→数据库记录→fileID→服务端临时URL`。不能接收任意fileID代签。
- 云存储和云数据库不是跨服务事务；先私有对象、后验证、再发布引用，失败必须可对账回收。
- storage adapter须提供经过P0实测的recoverByPath(objectPath)→SDK规范fileID/不存在/未知，用于写入或复制已成功但响应丢失的恢复；wx-server-sdk下载/删除仅收fileID，不能手拼cloud://或虚构listFiles。候选实现是服务端内部getUploadMetadata({cloudPath})返回data.fileId后验证对象，所获新授权只留服务端、不上传覆盖、不日志；必须实测同path映射稳定/现存及不存在/错环境。未通过U5则相应transport/副作用恢复保持阻塞，不称已有可靠GC。

### 11.2 上传状态机

```text
INIT → UPLOADING → VERIFYING → CONFIRMED → ATTACHED
                 ├→ REJECTED
INIT/UPLOADING/VERIFYING/RETRYABLE_FAILURE/CONFIRMED → CANCELLED 或 EXPIRED → GC_PENDING → DELETED
VERIFYING失败 → RETRYABLE_FAILURE（仅可恢复故障）或 REJECTED
RETRYABLE_FAILURE → VERIFYING（仍有权且uploadExpiresAt未到，再显式确认）
```

上传会话、附件安全验证状态、业务关联状态分别存储，不用一个status混淆：

- session.state按上图，transport在init后固定；不得一次失败静默换协议。
- 一个session只有一个STAGING storageAttempt，对应固定staging路径，可关联多个credentialAttempt，GC取它们共同最晚授权期限；不是每次重签一个可独立删除同路径的对象记录。candidate/chunk/final每attempt仍有唯一路径；UNKNOWN写入结果通过recoverByPath收敛，不因响应丢失就假定不存在。
- attachment.integrityState=`PENDING|VERIFIED|REJECTED`，只表示字节完整性/大小/hash校验。
- attachment.scanState=`NOT_CONFIGURED|PASSED|UNSCANNABLE|BLOCKED`，与完整性独立；仅前三项在本项目明确白名单内。NOT_CONFIGURED/UNSCANNABLE允许原始文件交付/下载并显式提示，BLOCKED一律拒绝；字段缺失、未知、未来SCANNING等一律未就绪/拒绝，不能用不等于BLOCKED放行。
- attachment.lifecycleState=`DRAFT|ATTACHED|GC_PENDING|DELETED`。
- 仅integrityState=VERIFIED、scanState在上述允许白名单、session=CONFIRMED、lifecycleState=DRAFT可被一次业务交付绑定；一旦ATTACHED不能进入草稿TTL。

项目默认明确为：uploadExpiresAt=init+30分钟；confirmedUntil=确认成功+24小时。INIT/UPLOADING/VERIFYING/RETRYABLE_FAILURE检查前者，CONFIRMED提交检查后者。签名实际到期latestSignatureExpiresAt独立，业务取消不能假装撤销已发凭证。后台每10分钟只是扫描频率，不删除仍有效候选；无引用临时/失败对象到期后24小时内回收为SLO，staging以所有授权最晚到期+安全余量后24小时计。执行频率/成本须P0确认，超SLO告警。

doc-only名额实现：`rak_upload_batches`每任务下一轮固定最多3槽（索引0..2）。init/cancel/expire/submit都事务读写同一个batch文档与对应session；过期释放必须比较槽内sessionId及终态，防旧worker释放已换人的名额。上传名额变动只改batch.revision，**不递增task业务revision**，避免第二文件使首个会话失效。submit按§9.1先终结未选会话再封闭batch，之后禁止新预占；旧batch可保留审计/清理标记写，不能复活业务会话。

取消/过期在事务中把session置终态、fence递增并释放batch槽；VERIFYING同样允许取消。worker发布时检查state=VERIFYING、lease、fence、成员/任务和uploadExpiresAt，失效则仅隔离candidate，不能复活。RETRYABLE_FAILURE仅在未到期有权时明确重试；不可恢复校验错误为REJECTED，释放名额后GC。CONFIRMED不能重新签发上传授权，只可ATTACH/cancel/expire。

### 11.3 首选：云函数签发限定路径上传凭证，再冻结校验

选择理由：日常手机上传效率较好，文件不塞进普通函数事件；所有业务授权仍在函数中。但必须通过 §15 P0 门槛，否则采用 §11.4，不放宽规则。

**当前已查到的API事实**：@cloudbase/node-sdk 3.18.3 实际有 `getUploadMetadata({cloudPath})`，内部使用PUT；响应含url/token/authorization/fileId/cosFileId/download_url，没有显式expiresAt，也无 maxBytes/expiry 输入。不能写成 `Taro.uploadFile` multipart POST，也不能承诺可自定义10分钟或上传前10MiB强制限制。SDK支持copyFile；其overwrite默认true且当前实现要求源/目标basename相同，必须显式false。[O4][O5]

协议步骤：

1. `file.init({taskId,expectedTaskRevision,name,declaredSize})`：鉴权当前负责人、CLAIMED/REJECTED；事务创建固定session/attachmentId、读写batch预占3槽、记录命令最小结果，限制会话/总声明容量。返回sessionId、attachmentId、uploadExpiresAt、transport。staging路径是`staging/{sessionId}/blob`，仅服务端指定。
2. **事务外签发第二阶段**：只对INIT/UPLOADING且未过期/有权会话签发；预登记credentialAttempt与原session revision/fence，再用平台临时身份取得仅该staging key的凭证。调用后记录实际最晚到期，并在返回客户端前再事务校验原fence/revision、状态、成员、任务与有效期；已取消/停用/变更则不返回凭证，但保留签发到期元数据用于GC。签发失败/响应丢失重试同mutationId恢复同session而不另占槽；已CONFIRMED/ATTACHED/CANCELLED/EXPIRED不得再签。通用commands仅缓存稳定sessionID，不缓存token/authorization/URL。UNKNOWN签发尝试以P0证明的最大可能有效期保守延迟GC。前端用P0已验证raw PUT传ArrayBuffer、准确method/headers，签名不写日志/analytics/长期Storage，不允许写final。
3. `file.confirm({sessionId})`：不接受客户端fileID或“上传成功”证明；取得带fence的验证租约，返回处理中或结果。
4. **先冻结，再验证**：先在rak_storage_attempts登记唯一candidate路径，再服务端copy到 `final/{sessionId}/{attemptId}/blob`，`overwrite:false,removeOriginal:false`。每attempt唯一candidate，未校验不得可读/可绑定。不能“先HEAD/校验staging再copy”，否则可被重放上传替换内容。
5. 对冻结candidate的真实字节做有界流式读取：核验HTTP成功/可信SDK源URL、无不受控redirect、累计≤10MiB、非0、实际SHA-256、探测MIME。HEAD/content-length只预检，缺失或0不能直接视为安全。超过上限立即abort，删除/隔离候选并记录拒绝原因；禁止无界downloadFile Buffer。
6. 当前版本/成员/负责人/状态/fence均仍有效时，事务同时把对应storageAttempt从WRITTEN转PUBLISHED、CAS发布CONFIRMED并存**已验证candidate**规范fileID；重复确认返回原附件。已被GC抢占、被取消、任务版本改变、租约丢失的worker不得发布。
7. 任务交付只传attachmentIds，原子转ATTACHED；后续即使staging凭证被重放，也不能修改已冻结正式对象。staging凭证有能力写到什么时候必须实际核实，无法证明确切过期边界则首选协议门禁失败。

重要代价：该方案的10MiB是正式确认的硬上限；传输前客户端检查可以被绕过，持证恶意成员可能上传超大staging并产生费用。通过每日次数、并发会话、声明容量、短会话、异常大小告警与回收限制损失，但不能声称彻底阻止。若项目要求传输前强制上限，或临时授权scope/有效期不能证明，直接选择分块路径。

### 11.4 明确备选：所有文件字节经受控分块云函数

当首选P0安全/兼容门槛失败时，选 `transport:'function-chunks-v1'`；不引入另一套业务后端/长期密钥、不改公开存储权限。

1. 单片目标256KiB**解码后**字节，10MiB最多40片；base64请求约350KiB，须先实测调用事件上限，必要时降低片大小并统一协议版本。init返回chunkBytes/chunkCount。
2. `file.putChunk({sessionId,index,base64,chunkHashHint})` 每次重新鉴权；严格base64合法性、整数index、预期片长、总片数/总量；服务端重算SHA-256。同index同hash幂等成功，不同hash拒绝。
3. 片记录键固定，存储对象每attempt唯一且先登记rak_storage_attempts。已接受的片不可覆盖；上传响应丢失/写DB失败靠预登记attempt和对账恢复，不能直接覆盖同key重传；恢复采用与GC写同一attempt记录互斥。
4. confirm获取lease/fence，冻结片manifest；顺序或最多2片并发download，逐片检长度/hash、增量整文件hash；边读边写受控/tmp文件，再流上传final，避免40Buffer+concat的双份内存。
5. final路径每attempt唯一；与§11.3同样条件发布/绑定/清理。10MiB、三附件、低网速条件下实测内存、/tmp、执行超时和费用；不能把默认资源足够当事实。长任务用job+status，不让小程序一直等一个即将超时的调用。
6. 客户端最多2片并发；同片失败有限重试，保留session+已确认index；文件已丢失需重新选择并核验hash，不能声称换机自动恢复未上传字节。

代价明确：一个10MiB文件至少40次片调用，另加init/confirm/status/提交与重试。它是少量部署函数的action，不是创建40个函数。若性能或成本验收不达标，应另做受限HTTP上传能力设计，不能退回公开写桶。

### 11.5 文件格式、校验与预览

- 文件名/扩展名不限制选择范围；云端大小/内容hash/实际格式探测必须完成。客户端声明MIME不可信。
- 云端不执行脚本、不渲染HTML/SVG为活动网页、不解压用户归档；原始二进制保存在私有对象。加密包、未知格式可标scanState=UNSCANNABLE，完整性通过后允许交付，仅原始下载并警示无法预览/检查，不伪称扫描通过。明确检测恶意则scanState=BLOCKED并拒绝交付/下载。
- MIME/大小/hash校验不是恶意软件扫描。若环境已有可用安全扫描服务则记录scannerVersion/result；未接入时verification只声明完整性/结构校验，UI与验收不得写“已病毒检测”。不得因为没配置额外扫描就偷偷放宽访问。
- 图片：使用授权URL显示；视频：按真机已支持格式播放；文档：下载至临时路径再openDocument；其他格式：提供下载/保存/另存或明确微信当前不可打开。不能承诺PSD/ZIP/EXE都能在小程序预览。
- 首版文件范围为**任务交付附件**。社团logo若启用上传，需独立purpose=club-logo、manager+、图片白名单/压缩上限/重新编码协议，不能用任务附件接口或任意logoUrl写入绕过权限。现设置页不上传logo，因此首版不新增logo上传UI。

### 11.6 授权下载与失效

`file.downloadUrls({attachmentIds})`最多3个（本项目限额，不冒称平台最大值），逐个反查记录、任务/交付、同社团、ACTIVE、负责人或manager+、ATTACHED、integrityState=VERIFIED且scanState在NOT_CONFIGURED/PASSED/UNSCANNABLE允许白名单；按输入顺序返回逐件结果，禁止失败项用原fileID装成功。草稿只允许上传者通过明确`file.previewDraft({attachmentId})`动作获取，要求CONFIRMED/DRAFT/confirmedUntil未过期、当前有效成员/负责人/任务版本、同样完整性/扫描白名单，不能用只查状态的file.status悄悄签URL。

使用SDK服务端getTempFileURL。本方案固定下载凭证最长300秒为上线门槛（项目策略，非SDK已保证）；P0核实锁版SDK/存储实际支持。平台固定更长则换可控期限的下载签名适配，无法满足时附件上线保持阻塞，不允许AI自行拉长或伪造expiresAt。返回实际签名到期，以服务器时间计算并为客户端提前30秒刷新留余量。

返回 `{attachmentId,url,expiresAt,name,sizeBytes,previewKind}`；原fileID只在server数据库。临时URL不入正式记录、不发analytics、不在报错中打印。缓存按env/user/attachment隔离，过期前/403时重新授权一次，失败显示“附件暂不可用”；先检查业务权限，不无限重试刷新。

同一签名URL有效期内可被转发；成员停用立即阻止新签发，但无法保证撤销已发URL。要求强制逐请求撤销时需带鉴权的文件代理且单独设计流式传输，此首版不宣称已实现。

### 11.7 回收、删除与存储一致性

- 删除未提交附件使session标CANCELLED并释放batch名额、递增fence，DRAFT附件不可再被采用；实际对象进入有宽限GC。所有credentialAttempt有实际/保守最晚有效期，cleanupNotBefore至少等于最晚期限+5分钟安全余量（项目默认）；凭证未过期staging可重现，期满后再扫/对账。不能用会话30分钟业务期限代替实际凭证期限。
- GC事务抢占时只接受未绑定DRAFT、未有活跃lease、到期且无submission引用。任务submit事务与GC写同一附件状态，只有一边能成功；GC_PENDING不能再被提交。
- ATTACHED/历史轮次永不按草稿TTL删除。归档任务不删除文件；保留期限暂设持续保留，未来依法/按社团政策另行审批删除。
- candidate/片对象上传成功但DB失败：以rak_storage_attempts预登记的唯一路径逐件对账，不依赖虚构的SDK.listFiles；设宽限期后确认无引用再删，不能只按前缀整目录删除。
- 物理删除前必须先事务将具体attempt/附件不可逆置GC_PENDING，恢复采用/发布与GC抢占同一attempt文档，只有一边成功。之后只能删除该attempt唯一路径；fence只能阻止DB发布，不能撤销已经发出的对象delete请求，故禁止“先查无引用、异步删除、期间还允许重新采用”。
- deleteFile逐项检查结果，失败保留GC_PENDING+重试次数，不先删DB记录造成永远找不到对象。记录DELETED墓碑，UI显示“文件已删除/不可用”。
- 定时worker只处理自己lease+fence，租约失效不能发布/删除另一worker成果；业务事务与对象操作分开，可恢复重跑。

## 12. 前端适配与行为要求

保持现有页面结构、色调、图标、标题/作者排版、文字可读性；本轮不做无关重设计。

需要改造的实际边界：

1. `config/build-mode.ts`、`config/index.ts`、`types/global.d.ts`、`src/constants/index.ts`：显式mode与环境，生产防演示。
2. `src/app.ts`：初始化云SDK与等待状态；失败可重试且不进入样例身份。
3. `src/services/domain-entry.ts` 及 auth/task/roi/club/member 门面：将demo/cloud/http adapter按同一领域能力选择。member/invite/club设置/二维码不能漏迁。
4. `src/utils/auth-contract.{js,d.ts}`、`src/types/domain.ts`、`src/store/index.ts`：cloud身份/附件DTO与错误类型；不混localPath和fileID，不伪造HTTP token。
5. 新增 `src/services/cloud/{client,auth,task,club,member,roi,attachment}.ts`、`src/services/attachment.ts`、`src/utils/backend-error.ts`、统一guard。
6. `src/components/page-shell.tsx`、26个页面生命周期：统一先守卫再加载、权限撤销清空、bootstrap完成可重新加载；管理员与超管都能发布公告。
7. `src/pages/task/detail.tsx`、任务管理/验收：选择→上传进度→确认→提交、失败/取消/重试、可选0件、历史轮次、管理者下载。保留本地demo附件分支，cloud提交成功不能再delete本机路径代替云对象管理。
8. `src/store/index.ts`：TeamStore写操作失败抛出统一错误/Result；不能吞掉使UI跳转成功。列表失败保留正确游标；所有相关页面状态可区分loading/empty/error/forbidden/resultUnknown。
9. `src/pages/me/settings.tsx`：cloud不渲染身份切换/恢复样例；用真实角色显示权限。可增加“在线模式/同步状态”帮助项但不显示内部环境/凭证。
10. 主题、草稿等缓存按环境/userId隔离；不持久化内部完整名册/敏感文件URL；app重启先云端校验，不离线放行缓存管理身份。

## 13. 环境、部署、运维与费用

### 13.1 实施前人工/外部配置清单

| 配置 | 已知/待做 | 用户需要协助的实际操作 |
|---|---|---|
| AppID | 已提供 wxa8bf102dcfdcec4c | 用有权微信登录开发者工具；确认开发/体验成员权限 |
| Cloud环境 | 已提供 cloud1-d4g36r8z6a8908540 | 确认归属、地域、模式、可用套餐、授权部署权限；不要在聊天发密钥 |
| dev/prod隔离 | 未核实 | 如需新环境/开通额度，用户在控制台确认并承担平台费用 |
| 本人初始超管 | 未初始化 | 本人真实进入测试版；运维核对可信身份关联参考号，完成一次性初始化 |
| 第二微信账号 | 未提供 | 找一个社团成员加入体验/测试名单，配合另一台真机互验 |
| 存储/函数配额告警 | 未配置 | 控制台设置预算、余量与费用告警；阈值依据实测估计 |
| 小程序码/权限 | 未核实 | 公众号平台能力可用时授权；否则先邀请码文本 |
| 上线材料 | 未核实 | 核对类目、备案/隐私声明、体验版与审核所需资料，以当时平台要求为准 |
| 备份与恢复权限 | 未核实 | 确认套餐支持的导出/回档、保留期与恢复成本 |

无需提供“随便一个API端点”、API key 或小程序AppSecret来完成本设计的微信云调用链。CLI凭证通过本机正常登录/云环境管理身份处理，不写仓库/聊天。

### 13.2 部署顺序

1. 只读盘点现远端函数、触发器、集合、规则、bucket和账单；确认旧createSubTask/cancelSubTask/SubtaskScheduler是否残留。不得因本地删除就默认远端也没了；清理另行在明确范围内执行。
2. 隔离环境能力验证与SDK锁版；产出环境能力报告。
3. 创建集合、索引并等待就绪，逐个应用数据库客户端拒绝规则；验证无公开数据暴露窗口。
4. 私有存储与function.invoke规则；worker默认拒绝客户端；仅rakApi/rakFiles开放非匿名微信调用再做函数内鉴权。[O7]
5. 上传自包含云函数包，记录版本/hash/环境；部署不等于业务验收。不要部署不存在的原订阅模块或与本业务无关的health主题页面。
6. 受控初始化空社团和本人owner；不导入演示人/任务/收支。
7. 部署经云模式构建的小程序到开发工具/体验版；双账号验证主要流程与拒绝用例。
8. 开启经验证的maintenance定时器，确认SOURCE/触发身份来自平台而非event.type；默认无OPENID不能自动当系统管理员。
9. 验收通过后按实际平台流程上传、审核、发布；用户本轮仅方案，没有授权执行这些线上操作。

### 13.3 观测、备份、恢复

日志只记录requestId、action、脱敏actor标识、resourceId、耗时、稳定错误码、版本；不记录event全量、文件内容、签名URL、邀请码、openid或联系方式。SDK error.message/堆栈可能包含完整URL或headers，也必须先净化再记录，不能console.error原对象。拒绝请求留适度安全审计并限流。

至少监控：错误率/延迟/超时、事务冲突、认领冲突、重复命令、鉴权拒绝、暂存容量、孤立对象、文件校验失败、GC积压、函数次数、下载流量、费用。初始告警值由10MiB及双用户试运行数据确定，不写虚构月费用。

建议每日数据库备份/导出、至少保留7天、每月隔离恢复演练；业务RPO目标24小时、RTO目标4小时，是项目验收目标，平台能力/套餐不足必须记录差距。文件需单独版本/备份或受控镜像策略，数据库导出不等于备份文件字节；恢复校验所有ATTACHED引用可取，不能只验证JSON可导入。

恢复先隔离环境，检查集合/索引/规则/owner/附件引用/幂等，再切流；不同环境的fileID不能字符串替换后当作可用，需受控复制并更新映射。

回滚以函数版本、数据库兼容schemaVersion、前端adapter协议为单元；回滚不能删已产生的云端业务数据或切回demo。先维护模式阻止写，备份，对账，再恢复兼容版本。

## 14. 验收矩阵（都必须有证据）

| ID | 场景 | 明确预期 | 证据层 |
|---|---|---|---|
| A01 | 同微信换设备/清缓存 | 成员身份、业务数据、已提交附件恢复；草稿可能不恢复 | 双设备真实微信 |
| A02 | 本人初始化owner、任命manager | 只有受控初始化可授super；manager不能任免 | 云+真机 |
| A03 | 非成员/待审核直调API和深链 | 不泄露内部任务/公告/ROI/名册/附件；无写 | 云真实身份 |
| A04 | event伪造openid/role/clubId/userId | 忽略或schema拒绝；无越权写入 | 函数入口+数据库快照 |
| A05 | 客户端数据库get/query/count/write/watch | 全拒绝，即使同一社团有效成员 | 真实客户端SDK |
| A06 | 直接storage读写、改key写final | 被规则/凭证范围拒绝 | 真实私有bucket |
| T01 | 两成员同时claim同OPEN | 恰一成功；另一task_not_claimable/revision_conflict | 云并发 |
| T02 | 交付0件、1件、3件 | 成功；说明必填，第四件/0B/>10MiB拒绝 | 单测+云+真机 |
| T03 | 驳回重交/旧审核迟到 | 轮次历史完整；旧审核不能作用新轮 | 云+真机 |
| T04 | 提交中超时后原键重试 | 仅一submission/审计/附件关联，状态可查询 | 云故障注入 |
| F01 | 另一设备管理者下载成员附件 | 有权成功；非负责人member拒绝 | 双账号真机 |
| F02 | 任意fileID/他人attachmentId/别环境ID | 不签URL；逐件失败，不泄露对象信息 | 云真实身份 |
| F03 | 签名重放替换staging | 已确认/已交付final实际字节hash不变 | 云存储 |
| F04 | confirm/cancel/submit/GC竞争 | ATTACHED不被删除；无重复绑定；失去lease不能发布 | 云并发/故障注入 |
| F05 | 上传/复制后DB失败、worker崩溃 | 可恢复；孤立对象可回收且不误删正式文件 | 云故障注入 |
| F06 | 过期URL/删除文件/部分转换失败 | 重鉴权刷新或明确不可用；无无限重试/假成功 | 云+真机 |
| F07 | 最大文件/未知格式/加密包/恶意内容 | 大小强校验；可选格式不等于全可预览；恶意隔离 | 云+真机 |
| P01 | 停用/降权同时写/读结果 | 后续请求拒绝；写与撤销按事务排序；历史结果重新投影 | 云并发 |
| P02 | member名册开关关闭 | 无名册数据，入口隐藏；manager仍可管理 | 云+真机 |
| N01 | 草稿公告通过首页/详情ID访问 | 普通成员均拒绝；发布后刷新可见 | 云+真机 |
| R01 | 0成本、0.10+0.20、上限、非法小数/日期 | null比例、精确分累计、超限拒绝 | 单测+云 |
| R02 | 上海跨月/季/年、取消和软删 | 周期与本设计口径一致；列表统计不漏授权 | 单测+云 |
| L01 | 同时间戳>两页、多筛选、翻页失败 | 不漏不重（无并发变更时）；失败重试同cursor；迟到响应不污染 | 单测+云 |
| I01 | 邀请末次并发兑换/重复兑换/撤销 | 不超用、不多扣；撤销后不能入会；禁用不能绕过 | 云并发 |
| I02 | 两manager同时审核/重提申请 | 一个当前申请；revision互斥；不产生两个member | 云并发 |
| B01 | 生产cloud构建 | 无API_BASE也能cloud构建；缺env/demo混入则失败；保留按需注入/压缩 | 构建+产物检查 |
| O01 | worker伪造event/SOURCE为空 | 客户端不能invoke；缺可信系统身份拒绝 | 云真实调用 |
| D01 | 备份恢复 | 恢复数据、owner、权限、ATTACHED字节与引用均有效 | 隔离恢复演练 |

验收记录必须包含日期、AppID、环境、SDK锁版、函数构建hash、客户端commit/包hash、账号角色（脱敏）、设备、输入/预期/实测/证据路径。静态/模拟/真实云/真机分别标记；不能只写“测试通过”。

## 15. P0 能力门禁与尚未验证事项

不把这些环境事实编造为已知，也不让它们在实施时靠AI自由发挥。P0结果进入版本化能力报告。

| 门禁 | 检查与通过标准 | 不通过后的明确处理 |
|---|---|---|
| E1 环境 | AppID绑定、环境归属、模式/地域、数据库/事务可用、套餐/权限 | 先在正确环境完成；不向未知环境写 |
| E2 SDK/runtime | 目标Node运行时可用；wx身份来源、Node存储SDK临时凭证初始化、锁版兼容 | 固定可验证组合；不嵌长期密钥 |
| E3 事务/索引 | doc事务、冲突重试、限制、复合排序/唯一索引与游标查询实际通过 | 调整仓库/索引；保持同一业务不变量 |
| U1 受限上传 | 返回全部token/authorization只能staging exact-key PUT；改key/method/final、读取/删除/列举/自行签其他对象均失败；私有规则下可用；有效期能证明 | 分块云函数路径 |
| U2 手机传输 | 微信raw PUT相应headers和10MiB真机成功，超时取消能恢复；非multipart误用 | 分块路径；不偷偷改成公开wx.cloud.uploadFile |
| U3 冻结 | copyFile支持overwrite:false；客户端不能改final；可有界读取candidate | 分块并服务端新建final；仍须验证不可变对象路径 |
| U4 分块备选 | 事件上限、256KiB片、10MiB组装、资源/费用达标 | 降片/异步job/资源调整；仍不达标则另做受限HTTP上传设计并说明阻塞 |
| U5 对象恢复 | 预登记path副作用响应丢失后，可恢复SDK规范fileID、验证/删除；同path映射稳定、错环境拒绝，不依赖手拼ID | 验证其他SDK受控恢复适配；无法证明则相应transport不可标可恢复、阻塞附件上线 |
| D1 下载 | 服务端私有文件URL可用；TTL实际≤300s且可验证 | 换可控签名期限下载适配；不能满足则阻塞附件上线，不伪造expiresAt |
| W1 worker | 平台可信定时来源、客户端禁invoke、lease/fence有效 | 不启动定时任务；先修身份校验再启用 |
| C1 小程序码 | openapi权限、scene长度/解析、page/env_version可用 | 文本邀请码先上线，UI明确暂不可生成码 |
| O1 备份费用 | 数据/字节备份恢复、告警、配额与预算可接受 | 上线前补齐并记录实际费用依据 |

已确定且不再询问：CloudBase作为新业务真源、客户端禁直连DB、空数据起步、学校社团主题、已有角色及任务/公告/ROI功能范围。技术门禁由实施者通过文档/隔离环境试验解决，不把SDK API选择丢给用户。

## 16. 官方来源与证据边界

本设计于2026-10-16通过HTTPS读取以下腾讯/微信官方文档及官方发布包。部分旧API深链接返回站点404壳，已改用当前导航页；不可把HTTP200本身当作读到了正确文档。没有真实云部署/账号验证。

- [O1] CloudBase 文档数据库安全规则：https://docs.cloudbase.net/database/security-rules
- [O2] CloudBase 传统云存储安全规则：https://docs.cloudbase.net/storage/security-rules
- [O3] CloudBase 文档数据库事务：https://docs.cloudbase.net/database/transaction
- [O4] CloudBase Node SDK 云存储（upload/download/tempURL/copyFile）：https://docs.cloudbase.net/api-reference/server/node-sdk/storage
- [O5] 官方包 @cloudbase/node-sdk 版本元数据：https://registry.npmjs.org/%40cloudbase%2Fnode-sdk/latest ；本次包3.18.3：https://registry.npmjs.org/@cloudbase/node-sdk/-/node-sdk-3.18.3.tgz
- [O6] 微信官方wx-server-sdk版本元数据：https://registry.npmjs.org/wx-server-sdk/latest ；本次4.0.2：https://registry.npmjs.org/wx-server-sdk/-/wx-server-sdk-4.0.2.tgz ；官方类型源码：https://github.com/wechat-miniprogram/wx-server-sdk/blob/master/index.d.ts
- [O7] CloudBase 云函数调用安全规则：https://docs.cloudbase.net/cloud-function/security-rules

**防幻觉约束**：当前Node SDK与wx-server-sdk API集合/返回结构不同；按实际锁版适配，不复制另一个SDK的示例。未验证的自定义上传过期/大小策略、签名TTL、Node运行时、存储模式、SOURCE常量、云环境归属、云函数部署情况都必须留证后才能标完成。

## 17. 交付前自查

- 覆盖所有现有领域服务，包括容易遗漏的成员/邀请码/设置/二维码/绩效，不只迁移任务列表。
- 用户已选空数据起步，无须迁移演示内容；初始化只创建空社团与真实owner，其他业务表为空。
- 客户端数据库查询、计数、聚合、监听全部拒绝；文件授权始终经函数及业务ID。
- 协议没有假JWT、任意fileID签名、全公开桶、静默demo回退、前端角色自报。
- 明确状态机、revision、事务文档操作、授权撤销排序、幂等清理后旧请求拒绝。
- 附件冻结在校验之前、候选发布在校验之后；云存储和DB失败可恢复；历史不会被草稿GC删除。
- 硬平台事实与项目默认值、提案与已实现、静态与真实验证均有区分。
- 本文只是方案；按配套计划逐门验收后才能宣称“可以与成员正式共用”。
