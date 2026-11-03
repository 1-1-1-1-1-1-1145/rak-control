# Rak 多团队云端上线：人工操作清单

日期：2026-10-17（Asia/Shanghai）
适用范围：`C:/Users/24800/Desktop/小程序/rak-control`
依据：[多团队实施计划](./superpowers/plans/2026-10-17-rak-multi-team-isolation-plan.md) §7/§M8/§M9、[M0 能力报告](./verification/cloudbase-capabilities-2026-10-17.md)、[ADR-0006](./adr/adr-0006-cloudbase-multiteam-backend.md)
已知配置（**非**远端验证结果）：AppID `wxa8bf102dcfdcec4c`；环境 `cloud1-d4g36r8z6a8908540`。

> **本文只列"必须人工执行"的动作。** 由 AI 继续自动完成、**无需人工**的部分：M4–M7 业务代码与单测、`scripts/{bootstrap-cloud-platform,provision-cloud-team}.mjs`、`scripts/cloud-integration/*`、`pnpm build:cloud`、`pnpm verify:*`、`pnpm test:server`。请勿手动代做这些。

---

## 0. 当前状态与阅读方式

**已完成（自动 + 已云侧部署）**：M1 契约/骨架、M2 cloud 模式与双层上下文、M3 身份/开通/团队/成员/入会/邀请、M4 任务状态机与命令幂等、M5 `function-chunks-v1` 服务端 + fail-closed 骨架、M6 公告/ROI/绩效/社团隔离、M7 页面守卫与切队、**M8 运行时绑定（H-7 SDK 锁版 + 真实 SDK 装配）**；本机门禁：前端 **90**、服务端 **171**、类型检查 0、`verify:release` 全绿。
**云端已就绪（2026-10-18，经你授权）**：函数环境变量已配（`rakApi`/`rakFiles` 各 4 项）；三函数已重新部署（云端装 `wx-server-sdk@4.0.2`）；**冒烟通过** —— `rakApi`/`rakFiles` 对合法信封返回 `identity_required`（证明运行时已真实绑定 + 身份守门生效）。
**尚未完成**：① **H-18 第二微信/第二台设备**（跨队拒绝 MT11、成员/审批双人流程、双设备 H-21 均依赖它）；② 附件真实字节（下载受控能力未上线）；③ 来源校准 W1。
**已完成（本轮新增）**：**H-11 函数调用权限**（AI 经官方接口写入云函数安全规则并读回复核，见 §L H-11）；**H-14 平台初始化**（经受控脚本执行并独立只读核验）；**H-16 第 1 队**（`club73e85e9d0e73e14f4b3f`）；**H-17 第 2 队**（`clubab170d91d08623ee695e`，同人跨队）；**H-20 单账号核心流程 + 多队切换/隔离 PASS**（真机 + 只读核验，见执行日志 §18/§21）；**日志服务已开通并验证**。
**已完成（2026-10-18 功能）**：**小程序内「开通新团队」** —— 账户页入口替换参考号；本队成员申请 → 本队管理员/超管审批 → 建队（申请人成为 owner）；服务端 `team.newApplication.*` 五个动作、前端两个页面、33 路由门禁通过。**一次性云资源见 H-27**。
**阻塞根因**：无真实微信测试身份/第二台设备 → **客户端调用行为**、受控开通、M9 及部分 M8 真实项保持 **NOT_RUN**。

每个步骤给出五项：**操作内容 / 执行顺序 / 操作位置·对象 / 验收标准 / 注意事项**。

---

## A. 环境访问与权属核实（立即执行；解锁 M0→M5/M8/M9）

### H-1 登录 CloudBase 并核实环境权属
- **操作内容**：用**有权微信**登录腾讯云 CloudBase 控制台或微信开发者工具「云开发」，确认环境 `cloud1-d4g36r8z6a8908540` 的归属账号、地域、数据库模式（文档数据库 / PG）、套餐与部署权限。
- **执行顺序**：第 1 步（其余云步骤之前）。
- **操作位置/对象**：腾讯云 CloudBase 控制台（或开发者工具「云开发」面板）→ 环境 `cloud1-d4g36r8z6a8908540`；微信账号需对该环境有管理权。
- **验收标准**：能打开该环境的「数据库 / 存储 / 云函数」页签；记录：归属主体、地域、数据库模式、套餐名、可创建的集合/函数数量上限。
- **注意事项**：**不要**在聊天中发送 AppSecret / API key / 密钥。**不要**删除或停用任何现有远端资源（旧订阅函数若有残留，只记录不清理）。

### H-2 绑定与 AppID 核对
- **操作内容**：确认环境与该小程序 AppID `wxa8bf102dcfdcec4c` 的绑定关系；确认 AppID 下当前登录微信是开发者/体验成员。
- **执行顺序**：第 2 步（可与 H-1 同批）。
- **操作位置/对象**：微信公众平台 → 开发管理 → 开发设置（AppID）；开发者工具 → 成员管理。
- **验收标准**：AppID 可正常用于云开发；登录微信具备开发/体验权限。
- **注意事项**：环境与 AppID 若不匹配，后续 `cloud.init` 会报环境不匹配，需先在控制台纠正。

### H-3（可选）建立隔离测试环境
- **操作内容**：如套餐允许，另建独立 dev/隔离环境专用于测试（避免污染正式环境数据）。
- **执行顺序**：第 3 步；若不可用可跳过并记录替代方案。
- **操作位置/对象**：CloudBase 控制台 → 新建环境。
- **验收标准**：存在一个独立的测试环境 ID（用于后续 `TARO_APP_CLOUD_ENV`）。
- **注意事项**：如无预算/配额，明确记录"无隔离环境"，后续真实测试风险自负，AI 会将 M8 标记为受限。

### H-4 提供 CLI 登录方式（供 AI 跑只读盘点与能力试验）
- **操作内容**：让本机具备可用的 CloudBase CLI 登录态，并告知 AI 使用方式。
- **执行顺序**：第 4 步（H-1 之后）。
- **操作位置/对象**：本机终端。可选任一：① 安装后 `cloudbase login` 扫码；② 使用 `npx @cloudbase/cli login`；③ 由 AI 用 `corepack pnpm dlx @cloudbase/cli login`（需扫码）。
- **验收标准**：AI 能执行只读命令列出环境/集合/函数（例如 `cloudbase env:list` 类只读操作）并回报。
- **注意事项**：本机 `C:\Users\24800\AppData\Roaming\npm` 缺失，全局安装可能失败；优先用 `npx`/`pnpm dlx`。仅提供登录方式，**不要**给出密钥明文。

### H-5 确认计费/配额/告警能力
- **操作内容**：确认数据库读写量、云函数调用、存储容量与流量、定时器配额；设置预算与用量告警阈值。
- **执行顺序**：第 5 步（可与 H-3 并行）。
- **操作位置/对象**：CloudBase 控制台 → 资源/费用 → 告警设置。
- **验收标准**：记录套餐上限与已设置的告警阈值（AI 将据此写 M8 预算告警）。
- **注意事项**：阈值依据实测（10MiB 附件、双用户）而非估算；未配置需记录差距。

---

## B. 代码上线前置（AI 完成代码后，人工只做少量操作）

### H-6 更新本机依赖（仅当根依赖变化时）
- **操作内容**：若 AI 新增根依赖并更新了 `pnpm-lock.yaml`，执行安装。
- **执行顺序**：收到 AI"依赖已更新"提示后。
- **操作位置/对象**：项目根目录。
- **验收标准**：`corepack pnpm install --frozen-lockfile` 成功；`corepack pnpm test`、`pnpm test:server` 通过。
- **注意事项**：**不要**自行执行 `pnpm install` 之外的锁文件改动；不要删除 `pnpm-workspace.yaml` 的 `allowBuilds`。

### H-7 锁定云 SDK 版本（AI 验证后由人工确认写入）

> **✅ 已完成（2026-10-18）**：版本锁定为 **`wx-server-sdk 4.0.2`**（M0 实测；配套 `@cloudbase/node-sdk 3.17.2`、运行时 Nodejs20.19），
> 并已由 `pnpm build:cloud` **写入三产物** `cloudfunctions/{rakApi,rakFiles,rakMaintenance}/package.json` 的 `dependencies`：
> `{"wx-server-sdk":"4.0.2"}`（`manifest.json` 记 `sdkCandidate.locked=true`；`verify:cloud:artifacts` 通过）。
> 无需你手工改产物——重新构建即得到同一版本。

- **操作内容**：在隔离环境验证 `wx-server-sdk` / `@cloudbase/node-sdk` 精确版本后，确认 AI 写入各云函数 `package.json` 的版本号。
- **执行顺序**：H-1/H-4 之后（M0 能力试验阶段）。
- **操作位置/对象**：`cloudfunctions/*/package.json`（由 `pnpm build:cloud` 生成）。
- **验收标准**：三个函数目录 `package.json` 依赖版本已固定并与验证结论一致。
- **注意事项**：未经验证的版本不得写入；不要降级运行时以迁就。

---

## C. 云资源部署（M8，需 H-1/H-4 就绪）

### H-8 创建集合并等待就绪
- **操作内容**：按 `infra/cloudbase/collections.json` 在目标环境创建集合（名称、主键、必要字段）。
- **执行顺序**：部署第 1 步（先于函数上传）。
- **操作位置/对象**：CloudBase 控制台 → 数据库；集合清单见 [collections.json](file:///c:/Users/24800/Desktop/%E5%B0%8F%E7%A8%8B%E5%BA%8F/rak-control/infra/cloudbase/collections.json)。
- **验收标准**：所有**实际使用**集合存在且可读写；分块/后台缓存/`rak_stats` 集合**仅在选定对应方案后**再建。
- **注意事项**：不要"表列得全就全建"；业务初始化不要与建表混在同一公开函数。

### H-9 创建索引
- **操作内容**：按 `infra/cloudbase/indexes.json` 创建复合/唯一索引并等待构建完成。
- **执行顺序**：建集合之后、上传函数之前。
- **操作位置/对象**：CloudBase 控制台 → 数据库 → 索引管理；清单见 [indexes.json](file:///c:/Users/24800/Desktop/%E5%B0%8F%E7%A8%8B%E5%BA%8F/rak-control/infra/cloudbase/indexes.json)。
- **验收标准**：索引状态"已生效"；唯一索引（如 `rak_members` clubId+userId、`rak_invites` codeHash）创建成功。
- **注意事项**：稀疏/部分唯一、`_id` 是否可入复合索引、方向支持以实测为准；不可用则按设计加不可变 `sortKey`，不得放宽查询语义。

### H-10 应用数据库与存储安全规则（拒绝客户端直访）
- **操作内容**：按 `infra/cloudbase/{database-rules,storage-rules}.json` 将**客户端读写设为 false**（私有存储拒绝客户端 SDK）。
- **执行顺序**：紧接 H-9，**先拒绝后上传函数**，不留公开窗口。
- **操作位置/对象**：CloudBase 控制台 → 数据库安全规则 / 存储安全规则。
- **验收标准**：在小程序端 `wx.cloud.database` 任读/写均被拒；`wx.cloud.uploadFile/downloadFile` 直访被拒。
- **注意事项**：**禁止**为联调临时开启全员读写。

### H-11 配置函数调用规则
- **操作内容**：按 `infra/cloudbase/function-rules.json`：`rakApi`/`rakFiles` 允许非匿名微信调用；`rakMaintenance` **禁止客户端 invoke**。
- **执行顺序**：函数上传前。
- **操作位置/对象**：CloudBase 控制台 → 云函数 → 调用权限/安全规则。
- **验收标准**：非匿名可调 `rakApi`/`rakFiles`；客户端调 `rakMaintenance` 被拒。
- **注意事项**：worker 仅平台可信来源；`event.source/type/clubId` 不能当系统权限。

### H-12 构建并上传三个云函数
- **操作内容**：先由 AI 运行 `pnpm build:cloud` 生成 `cloudfunctions/{rakApi,rakFiles,rakMaintenance}/`，再由人工上传部署。
- **执行顺序**：H-8~H-11 之后；`build:cloud` → 上传。
- **操作位置/对象**：微信开发者工具导入**项目根目录**（非只拷 `dist`）→ 云开发 → 右键 `cloudfunctions/rakApi`（及 rakFiles/rakMaintenance）→「上传并部署：云端安装依赖」。
- **验收标准**：三个函数线上存在；记录每个函数的版本/Hash 与本地产物一致。
- **注意事项**：`project.config.json` 的 `cloudfunctionRoot` 必须指向 `cloudfunctions/`；先 `pnpm build:weapp` 让 `miniprogramRoot=dist` 有产物；函数包**自包含**，不得依赖上传目录外源码；三个函数**不是**旧订阅三函数。

### H-13 部署产物与源一致性核对
- **操作内容**：记录函数版本/Hash、SDK/运行时、DB/存储/调用规则实际快照（脱敏）。
- **执行顺序**：上传后。
- **操作位置/对象**：控制台函数详情；本地 `cloudfunctions/manifest.json`。
- **验收标准**：源与部署产物同一版本；快照归档供验收。
- **注意事项**：不要提交凭证或本机配置到仓库。

### H-27（2026-10-18 新增）小程序内「开通新团队」的一次性云资源

> **✅ 已完成（2026-10-18，经用户授权由 AI 执行）**：集合 `rak_club_applications` 已创建、ACL=ADMINONLY；
> 4 条索引已建并 `listIndexes` 读回（`clubs_slug_unique`/`clubs_display_code_unique` 的 `unique:true` 生效）；
> `rakApi` 已重新部署；冒烟 `team.newApplication.submit` 返回 `identity_required`（非 `not_implemented`）。
> 证据见执行日志 §25.5。以下步骤保留供重建/迁移参考。

> **性质**：这是一次性**部署**动作，不是日常使用流程。日常开队完全在小程序内闭环，无需任何控制台操作。

1. **创建集合** `rak_club_applications`（ACL = 仅管理员，与其余 `rak_*` 一致）。
2. **创建索引**（`infra/cloudbase/indexes.json` 已声明）：
   - `club_applications_by_club_status`（本队待审列表）
   - `club_applications_by_applicant`（我的申请）
   - `clubs_slug_unique`（唯一；并发审批最终防线）
   - `clubs_display_code_unique`（唯一）
3. **重新部署 `rakApi`**（新增 `team.newApplication.*` 五个动作；`build:cloud` → `fn deploy rakApi --force --install-dependency true`）。
4. **验证**：小程序内提交一条申请 → 管理员在「管理台 → 开队审批」通过 → 「切换团队」出现新队，且申请人角色为 `super_admin`。

- **不做会怎样**：读不存在的集合会报 `-502005`，开队申请页面会显示"加载失败"；未部署 `rakApi` 则调用返回 `not_implemented`。
- **注意**：`clubs_slug_unique` / `clubs_display_code_unique` 若历史数据已有重复会创建失败；先只读核对现有 `rak_clubs` 的 slug/displayCode 唯一性。

### H-28（2026-10-18 新增）管理员/超管三项管理能力的一次性云资源

> **✅ 已完成（2026-10-18，经用户授权由 AI 执行）**：两集合已创建、ACL=ADMINONLY；
> 4 条索引已建并 `listIndexes` 读回；`rakApi` 已重新部署；冒烟 `member.dismissal.list` 返回 `identity_required`。
> 证据见执行日志 §28.6。以下步骤保留供重建/迁移参考。

1. **创建集合**：`rak_member_dismissals`、`rak_club_dissolutions`（ACL = 仅管理员）。
2. **创建索引**（`infra/cloudbase/indexes.json` 已声明）：
   - `dismissals_by_club_status`、`dismissals_by_target`
   - `dissolutions_by_status`、`dissolutions_by_club`（unique）
3. **重新部署 `rakApi`**（新增 9 个动作）。
4. **验证**：
   - 裁员：**首位超管**发起 → 本人确认即生效；**其他人**发起 → 本人第一阶段 + 另一位超管终审 → 目标变"离队"；
   - 解散：管理员在「团队设置 → 危险操作」直接解散，或提交协助申请 → 超管在「团队解散」批准；
   - 超管任免：首位超管在「角色任免」任命/罢免其他超管。
- **注意**：解散为 `club.status=DISSOLVED`，成员关系与业务数据**保留**（不可进入、列表隐藏、可审计）。

---

## D. 受控初始化与团队开通

> 受控运维脚本**已创建**（2026-10-17）：`scripts/bootstrap-cloud-platform.mjs` 与 `scripts/provision-cloud-team.mjs`。
> 二者均为 **fail-closed**：缺云环境/AppID/调用通道模板时**非零退出**并列出缺失项，绝不伪造初始化/开通结果。
> 调用形态由有环境管理权的人按其**已核实**的 CLI 形态通过
> `RAK_PLATFORM_INVOKE_TEMPLATE`（占位符 `{fn}`/`{env}`/`{params}`）提供；脚本内不写未经验证的 CLI 参数。

### H-14 平台初始化（仅一次）

> **✅ 已完成（2026-10-18，经用户授权由 AI 执行）** —— 你**无需**再手工写入该文档。
> - **为执行本步补齐的最小受控 worker 入口**（原缺口：受控脚本要求 `rakMaintenance` 返回 `{initialized:true}`，
>   但该函数只有 `not_implemented`，仓库内无任何 `platformInitialize` 处理入口）：
>   新增 `readPlatformConfig()`（仅 AppID/环境，**不持有业务密钥**）+ `loadMaintenanceRuntime()`；
>   `rakMaintenance` 按 `event.kind` 分发（`platformInitialize` → 幂等 `initializePlatform()`）。
> - **执行**：`node scripts/bootstrap-cloud-platform.mjs`（构造已核实 CLI 形态的 `RAK_PLATFORM_INVOKE_TEMPLATE`）
>   连跑两次 → `already=false` / `already=true`（幂等）。
> - **独立只读核验**（`db nosql dump rak_system_config --file-type json`）：
>   `{"_id":"main","appId":"wxa8bf102dcfdcec4c","schemaVersion":1,"platformInitializedAt":1792305910614,"maintenanceFlags":{}}` ✔（无 `clubId`/`ownerUserId`）

- **操作内容**：创建 `rak_system_config/main`（AppID、schemaVersion、platformInitializedAt、维护标记）。
- **执行顺序**：函数部署后（H-12）第一件事。
- **操作位置/对象**：`node scripts/bootstrap-cloud-platform.mjs`（需 `RAK_CLOUD_ENV`、`RAK_APP_ID`、`RAK_PLATFORM_INVOKE_TEMPLATE`）或在控制台手动写入该单文档。
- **验收标准**：`main` 存在且 `clubId/ownerUserId` **不再**作为单队语义；重复执行**无副作用**。
- **注意事项**：平台初始化与"每队开通"**分开**；不要在此步导入演示数据。

### H-15 本人取得身份参考号

> **⚠️ 已被小程序内流程替代（2026-10-18）**：日常开通新团队**不再需要参考号**。
> 账户页原「获取团队开通参考号」入口已整体替换为「**开通新团队**」：本队成员提交申请 →
> 本队管理员/超管在「管理台 → 开队审批」通过 → 服务端建队、**申请人成为新队 owner**。
> 本节与 H-16 仅保留为**平台运维兜底**（异常/批量场景），普通用户无需任何控制台操作。

> **✅ 已接线（2026-10-18）**：App 内「我的 → 账户 → **获取团队开通参考号**」可直接取号（自动复制到剪贴板并显示有效期）。
> 服务端已**放开"平台初始化后不许签发"的限制**（否则每开一队都要删初始化文档、且第 2 位 owner 无法取号）；
> 参考号仍**不授予任何权限**，只能由运维经受控开通消费一次；已消费时默认不返回可用号，可显式换发。
> 开发者工具 Console 方式仍可作为备用。
> 1. 微信开发者工具打开**项目根目录**（`dist/` 已是 cloud 生产构建），等模拟器加载完小程序（此时 `wx.cloud.init` 已执行）。
> 2. 打开「调试器 → Console」，粘贴执行：
>    ```js
>    wx.cloud.callFunction({
>      name: 'rakApi',
>      data: { apiVersion: 2, action: 'account.provisioningReference', scope: { kind: 'GLOBAL' }, requestId: 'ref-1', data: {} }
>    }).then(r => console.log(JSON.stringify(r.result)))
>    ```
> 3. 把 `result` 里的**参考号明文**交给运维（我）去做受控开通（H-16/H-17）。
> - **前提**：开发者工具登录的微信须与手机体验版**同一账号**（否则参考号会签发给另一个身份，owner 会被绑错）。
>   开通后我会**只读核对** `rak_members.userId` 是否等于 `rak_identities` 里那条记录的 `userId` 来验证。

- **操作内容**：拟任 owner 用**本人真实微信**进入（体验版或开发版）触发 `auth.bootstrap`，再调用 `account.provisioningReference` 取 30 分钟有效的参考号。
- **执行顺序**：平台初始化之后、开通团队之前。
- **操作位置/对象**：小程序内（拟任 owner 的微信）；GLOBAL 动作。
- **验收标准**：返回参考号明文（当次）与到期时间；未初始化时返回 `setupRequired`。
- **注意事项**：参考号**不是**管理员密码、不授予权限；已消费默认不再返回可用号，开第二队须显式 `replaceConsumed` 换发。

### H-16 受控开通第 1 队（owner=A）

> **⚠️ 日常已由小程序内审批替代（2026-10-18）**：见 H-15 说明。本节仅作平台运维兜底。

> **✅ 已完成（2026-10-18，经用户选择路径 A 并授权）**
> - 时序修正：先**临时删除** `rak_system_config/main`（可逆）→ 用户本人经开发者工具 Console 取参考号（`state=ISSUED`）→
>   我方重建初始化（`already=false`）→ 用该参考号受控开通。
> - 结果：`clubId=club73e85e9d0e73e14f4b3f`（`replayed=false`；同键复跑 `replayed=true`，未建第二队）。
> - **独立只读核验**：club `ACTIVE` 且 `ownerMemberId` 存在；成员 **1 人 / `super_admin` / `ACTIVE` / 即 owner**；
>   `ownerBoundToIdentityUser=true`（owner 就是你手机身份 `oJVk****H_l4`）；参考号 `ownerReferenceUsedAt` 已置位（已消费）；
>   `system_config/main` 已重建（`appId` 正确）；`rak_provisioning_operations` 1 条且含 `inputHash`。
> - **参数（测试值，可后续在 App 内改）**：队名 `测试队A`、`slug=team-a`、`displayCode=A7K2`、`provisioningKey=k1`；
>   owner 展示名为空（按设计"无姓名即可显式资料未完成"，可进 App「编辑本队资料」填写）。

- **操作内容**：运行受控开通脚本，或按 `provisioning_operations` 流程建：`club` + 该队 owner `member` + 审计 + 消费参考号 + 操作记录（同事务）。
- **执行顺序**：H-15 之后。
- **操作位置/对象**：`node scripts/provision-cloud-team.mjs --key <provisioningKey> --club-name <名> --slug <slug>
  --display-code <码> --owner-reference <参考号> [--owner-name <展示名>]`（**由有环境管理权的人**运行，
  另需 `RAK_CLOUD_ENV`/`RAK_APP_ID`/`RAK_PLATFORM_INVOKE_TEMPLATE`）或控制台；输入：队名/slug/displayCode、owner 展示名、参考号。
- **验收标准**：该队唯一 owner、`super_admin`、`ACTIVE`；参考号被消费；重复同键恢复同 `clubId`；同键异输入拒绝。
- **注意事项**：`provisioningId` 幂等；同参考号被两个开通争用只成功一次；**不能**仅凭聊天/客户端提交的 openid 初始化。

### H-17 开通第 2 队（验证多队/同人跨队）

> **✅ 已完成（2026-10-18）**：`clubId=clubab170d91d08623ee695e`（队名 `测试队B` / `slug=team-b` / `displayCode=B8M3`），
> 与第 1 队 owner 为**同一微信**（两队各一份 member 文档，`userId` 相同）；参考号已消费。
> 取号路径已改为 App 内「我的 → 账户 → 获取团队开通参考号」（服务端已放开"初始化后不许签发"的限制）。

- **操作内容**：同一 owner 账号或另一 owner 再开一队，验证"A 超管 / B 成员"与数据隔离。
- **执行顺序**：H-16 之后。
- **操作位置/对象**：同 H-16；第二队需**新的参考号**（`replaceConsumed` 换发）。
- **验收标准**：A/B 两队的任务/公告/ROI/绩效互不可见；A 的角色不传播到 B。
- **注意事项**：不得设置全局 isSuper；A owner 不能创建/查看 B。

---

## E. 真机与双设备验收（M9，需 H-12/H-16/H-17）

> **真实云集成入口已创建**（2026-10-17）：`corepack pnpm test:cloud:integration`
> （实现在 `scripts/cloud-integration/`）。它需要 5 个环境变量：
> `RAK_CLOUD_ENV`、`RAK_APP_ID`、`RAK_FN_INVOKE_TEMPLATE`（**真实微信身份**调用通道模板）、
> `RAK_ADMIN_READ_TEMPLATE`（**独立只读**断言通道模板）、`RAK_FIXTURE_FILE`（两队/三身份的 fixture JSON）。
> 缺任一项即**非零退出**且不产生任何云结论；设备/worker 类用例（MT10/14/16/17/19/22 等）默认记
> NOT_RUN，只有 `RAK_ENABLE_DEVICE_CASES=1` 且人工在真机执行时才计入。

### H-18 招募真实测试账号与设备

> **📋 双账号验证清单已生成**：`docs/verification/h18-dual-account-checklist-2026-10-18.md`
> （含：0 队落点、邀请码/申请审批、角色权限、**跨队拒绝 MT11** 的逐条直调与期望错误码、停用栅栏、双设备、附件边界、幂等隔离，以及结果记录表）。
> Y 若要执行直调项，用开发者工具「**真机调试**」以 Y 的身份打开 Console（管理侧 CLI invoke 无微信身份，不可用）。

- **操作内容**：至少第二个微信账号 + **第二台真机**加入体验成员名单。
- **执行顺序**：与 H-12 并行准备。
- **操作位置/对象**：微信公众平台 → 成员管理 → 体验成员；两台手机。
- **验收标准**：两个真实微信均可进入小程序并完成入队。
- **注意事项**：**不可**用模拟器角色切换冒充真实权限；双设备并发/换机不能用单设备模拟。

### H-19 上传体验版并验证基础可用

> **✅ 基础可用已通过（2026-10-18，真机 · 真实微信 · 体验版）**：冷启动后**越过登录页直接进入首页**。
> 这证明：真实身份 `auth.bootstrap` 写库 → `team.listMine` → "完整列表恰 1 队 → 自动 enter" → 会话安装 → 首页 全链路在**真实云端**成立；
> 也反证了此前的判断：登录页卡死根因是"**0 队** + cloud 登录页无入口"，而非网络/权限。
> **仍待复验**：0 队死锁修复版（需重新上传）在多队/0 队场景下的落点。

> **⚠️ 已知缺陷与修复（2026-10-18）**：首版体验版进入后会**卡在登录页「正在安全登录…」**——
> 根因是"账户已识别但**当前 0 队**"时，登录页在 cloud 模式下只有 loading、无任何可点入口（0 队死锁）。
> 已修复（新增 `decideLoginLanding` 判定 + 登录页离开逻辑；**逻辑改动，未动配色/字号/图标/布局**），
> 门禁全绿并已重建 `dist/`。**请按下面步骤覆盖上传新版本**。
> 另：`cloudProvisioningReference`（H-15 取参考号）目前**没有 UI 入口**；在补齐前，H-15 可先按 §D H-15 的
> 「开发者工具控制台」方式取得（身份须与手机同一微信）。

> **✅ AI 侧已完成（2026-10-18）**：cloud 生产产物已构建并核验 ——
> `corepack pnpm verify:client:cloud`（`--mode production` + `TARO_APP_BACKEND=cloud` + 已核实环境）**通过**：
> `dist/`（149 个文件）已内联云环境 `cloud1-d4g36r8z6a8908540`，无演示数据/测试注入/服务端 SDK 泄漏；
> 客户端 `ensureCloudReady()` → `Taro.cloud.init({ env: CLOUD_ENV, traceUser: true })` 按 cloud 模式执行。
> **⚠️ 需重新上传**：体验版三个启动异常（首次扫码不显示团队 / 退出后卡 loading / 常规入口卡选队页）已修复，
> `dist/` 已按修复后代码**重新构建**（`test` 83、`verify:release` 全绿）。请在开发者工具**重新上传并设为体验版**，
> 否则旧体验版仍会有上述问题。根因与逐场景验收步骤见
> [执行日志 §24](file:///c:/Users/24800/Desktop/小程序/rak-control/docs/verification/m8-execution-log-2026-10-18.md)。
> **上传这一步必须由你在开发者工具完成**（需你的微信登录）。本机 devtools CLI 存在于
> `C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`，但**服务端口 9420 未监听**（未开启服务端口）；
> AI **不会**用需要"上传密钥"的 miniprogram-ci（密钥不出现在对话里）。

**上传步骤（开发者工具 GUI）**

1. 打开 微信开发者工具 → 导入/打开**项目根目录** `C:\Users\24800\Desktop\小程序\rak-control`
   （`project.config.json` 已设 `miniprogramRoot=dist/`、`cloudfunctionRoot=cloudfunctions/`；**勿只拷贝 dist**）。
2. 确认 AppID 为 `wxa8bf102dcfdcec4c`、云开发已开通（云函数列表可见 `rakApi`/`rakFiles`/`rakMaintenance`）。
3. 点「上传」→ 版本号（建议 `1.0.0`）+ 备注 → 确定。
4. 微信公众平台 → 版本管理 → 将刚上传的版本**设为体验版**；并在「成员管理 → 体验成员」加入**第二个测试微信**（H-18）。
5. 生成体验版二维码 → 两个账号扫码进入。
- **可选 CLI 路径**（若你想自动化）：先在工具「设置 → 安全设置」打开**服务端口**，再用
  `& 'C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat' upload --project <根目录> -v 1.0.0 -d "说明"`
  （具体参数用 `cli.bat upload -h` 核对；当前 9420 未监听，此路暂不可用）。

- **操作内容**：用 `build:weapp` 产物在开发者工具生成体验版，双账号进入。
- **执行顺序**：H-12 后。
- **操作位置/对象**：开发者工具 → 上传 → 体验版二维码。
- **验收标准**：两个微信均能冷启动、完成 bootstrap 与选队。
- **注意事项**：生产/云端构建需显式 `TARO_APP_BACKEND=cloud` + 已核实环境；缺 env 或混入 demo 会构建失败（这是预期）。

### H-20 走通核心流程（双账号）
- **操作内容**：受控开通两队 → 邀请/申请入队 → 切队 → 发布/认领任务 → 附件交付 → 另一设备验收/驳回重交 → 公告 → ROI → 本队角色/资料修改。
- **执行顺序**：按上述顺序逐项。
- **操作位置/对象**：两台真机、两个微信。
- **验收标准**：每步符合 [DESIGN §15 MT01–MT22](./superpowers/specs/2026-10-17-rak-multi-team-isolation-design.md) 与 BASE A/T/F/N/R/L 矩阵的预期。
- **注意事项**：附件（M5）经 M0 上传裁决通过才可用；未通过则 UI 明确不可用，不得伪造成功。

### H-21 换机/清缓存恢复演练
- **操作内容**：清缓存/移除/换机后，同微信同 AppID/环境重新进入，验证云端已提交数据与文件恢复。
- **执行顺序**：H-20 之后。
- **操作位置/对象**：真机。
- **验收标准**：成员身份、任务、公告、ROI、已提交附件恢复；本机未上传草稿**不**承诺恢复。
- **注意事项**：不同微信不继承权限；待审核/停用直调与页面均受限。

---

## F. 平台合规与审核

### H-22 隐私声明与类目
- **操作内容**：确认收集用途（openid、联系方式、文件）与保留策略；填写隐私说明与服务类目。
- **执行顺序**：正式发布前。
- **操作位置/对象**：微信公众平台 → 设置 → 隐私/类目。
- **验收标准**：隐私声明与小程序实际采集一致；类目通过。
- **注意事项**：默认建议类目：教育>教育信息服务 或 工具>效率（以平台当期要求为准）。

### H-23 合法域名/权限
- **操作内容**：云调用（`callFunction`）无需 request 域名；如小程序内直接加载云存储临时链接，确认相应 `downloadFile` 合法域名或改用可下载方案。
- **执行顺序**：与 H-19 并行。
- **操作位置/对象**：微信公众平台 → 开发设置 → 服务器域名。
- **验收标准**：下载/预览附件在真机可用。
- **注意事项**：私有存储不得通过公开桶规避。

### H-24 小程序码/openapi 权限
- **操作内容**：确认是否具备生成小程序码的 openapi 权限。
- **执行顺序**：H-12 之后。
- **操作位置/对象**：微信公众平台 → 接口权限。
- **验收标准**：可生成受控二维码；不可用时 UI 明确降级为可复制文本邀请码。
- **注意事项**：**不阻塞**核心入队；能力不足据实记录，不得伪造二维码成功。

---

## G. 备份、告警与运维

### H-25 备份/恢复能力确认
- **操作内容**：确认套餐支持的数据库导出/回档、保留期与恢复成本；确认存储需单独备份策略。
- **执行顺序**：上线前（与 H-5 同批）。
- **操作位置/对象**：CloudBase 控制台 → 数据库 → 备份/回档。
- **验收标准**：至少每日导出、保留 ≥7 天；能执行一次隔离恢复演练。
- **注意事项**：**文件字节不随数据库 JSON 自动备份**；跨环境 fileID 不能字符串替换。

### H-26 运维/告警阈值
- **操作内容**：设置错误率/延迟、事务冲突、暂存容量、函数次数、下载流量、费用告警。
- **执行顺序**：上线前；阈值依 10MiB 双用户实测调整。
- **操作位置/对象**：控制台监控/告警。
- **验收标准**：告警可触发且有接收人。
- **注意事项**：不要写虚构月费用。

---

## H. 人工操作回报模板（完成后回给 AI）

每次人工操作后，按下表回报，便于 AI 更新能力报告/执行日志：

| 字段 | 说明 |
|---|---|
| 步骤号 | 如 H-1 |
| 完成时间 | 日期时间 |
| 环境/AppID | 实际使用的环境 ID（脱敏可选） |
| 结果 | 成功/失败 + 关键返回值（**不含密钥/AppSecret/邀请码明文**） |
| 证据 | 控制台截图路径、命令输出摘要（脱敏） |
| 阻塞 | 是否仍阻塞后续步骤 |

---

## I. 依赖顺序总览

```text
H-1 环境登录/权属核实
  → H-2 AppID 绑定核对
  → H-3（可选）隔离环境 ┐
  → H-4 CLI 登录方式    ├→ 解锁 M0 云能力门禁（上传/下载协议裁决等）
  → H-5 配额/告警       ┘
        →（AI 完成 M4/M5/M6/M7 代码 + 依赖锁版 H-6/H-7）
        → H-8 建集合 → H-9 建索引 → H-10 拒绝规则 → H-11 函数规则 → H-12 上传函数 → H-13 一致性核对
        → H-14 平台初始化 → H-15 本人参考号 → H-16 第 1 队 → H-17 第 2 队
        → H-18 测试账号/设备 → H-19 体验版 → H-20 核心流程 → H-21 恢复演练
        → H-22 隐私/类目 → H-23 合法域名 → H-24 小程序码权限
        → H-25 备份 → H-26 告警
```

## J. 当前阻塞与"最小可解锁集"

- **当前唯一硬阻塞**：H-1 / H-4（环境访问）。
- **立即需要的人工最小集（解锁 M0 与后续所有云端步骤）**：**H-1、H-2、H-3（可选）、H-4、H-5**。
- **可由 AI 并行推进、不需人工**：M4–M7 代码与测试、`bootstrap/provision` 脚本、`cloud-integration` 工具。
- **必须在真机/双账号阶段由人工完成**：H-18~H-24。
- **正式发布授权**：本轮未获授权；上线/审核（H-19 上传体验版之后的正式提审）需用户明确授权后再执行。

## K. 证据边界

本文所列验收标准均为**待人工达成**的目标；在对应人工步骤完成前，AI 不会把 M0/M5/M8/M9 标为 PASS，也不得凭"能构建"判定云端可用。

---

## L. 控制台逐步操作（H-2 / H-5 / H-8 / H-9 / H-10 / H-11）

**统一入口**：腾讯云 CloudBase 控制台 → 用有权账号登录 → 选择环境 `cloud1-d4g36r8z6a8908540`
（习惯用微信开发者工具的，在「云开发」面板打开**同一环境**等价）。
**前置事实（已实测，2026-10-17）**：CLI 只能**读**，不能建集合/建索引/改规则 —— 本组各步必须在控制台完成。

### H-2 AppID 绑定核对
1. 控制台 → 环境 → 「概览 / 基本信息」：看环境归属账号、地域、套餐（当前实测为**个人版 / ap-shanghai**）。
2. 微信公众平台 → 开发管理 → 开发设置：核对 AppID `wxa8bf102dcfdcec4c`。
3. 微信开发者工具 → 成员管理：确认你当前登录的微信是**开发者或体验成员**。
- **完成标准**：环境归属 = 你的账号；AppID 与体验成员均正确（后续 `cloud.init({ env })` 不报环境不匹配）。
- **注意**：CLI 的 `env detail` 里 App ID 一列**显示为空**（实测），所以绑定关系只能在这里确认。

### H-5 配额与告警
1. 控制台 → 环境 → 「资源用量 / 用量详情」：记录数据库读写量、云函数调用次数、存储容量与下行流量、定时器配额、以及**可创建集合/函数数量上限**。
2. 控制台 → 「费用 / 预算与告警」：设置用量与费用阈值（含接收人）。
- **完成标准**：记录套餐上限 + 已设告警阈值（AI 据此写 M8 预算告警）。
- **注意**：个人版**不是资源点计费**，CLI 的 `env usage` / `env info` 会返回"无法查看用量明细"（实测），必须看控制台。

### H-8 创建集合（先建集合，**再**传函数）

> **✅ 已完成（2026-10-18，经用户授权由 AI 一键创建）**：一次性云函数用 SDK `createCollection` 建 **20/20 成功**（`created:20, exists:0, failedCount:0`）；
> 复核 `listCollections` 共 **25** 个集合 = 20 个 `rak_*` + 原有 5 个 `oa_validation_*`；该临时函数**已删除**。
> 下列手工步骤仅在需要重建环境时参考。

1. 控制台 → 数据库 → **文档型数据库** → 集合管理 → 新建集合（名称照抄，主键 `_id`）。
2. 逐个创建以下 **20 个**（均为服务端代码实际读写的集合）：

```text
rak_system_config            rak_identities            rak_users
rak_clubs                    rak_members               rak_join_requests
rak_invites                  rak_join_entries          rak_join_entry_states
rak_provisioning_operations  rak_tasks                 rak_task_submissions
rak_announcements            rak_roi_items             rak_upload_batches
rak_upload_sessions          rak_upload_chunks         rak_attachments
rak_commands                 rak_audit_events
```

3. **当前不要创建这 5 个**（服务端代码无引用，建了只是空占配额）：

| 不建 | 原因 |
|---|---|
| `rak_upload_credentials` | 属于已被**否决**的 exact-key 受限 PUT 方案（M0 裁决改走 `function-chunks-v1`） |
| `rak_storage_attempts` | 同上（该方案不再使用 attempt 预登记） |
| `rak_jobs` | worker（file-verification / storage-cleanup / reconcile）仍是骨架 |
| `rak_rate_limits` | 限流尚未实现 |
| `rak_stats` | 统计未落地（"仅统计瓶颈出现时"） |

- **完成标准**：上表 20 个集合全部存在；
- **注意**：集合**不会自动创建** —— 实测读不存在的集合会报 `-502005 DATABASE_COLLECTION_NOT_EXIST`，所以本步不可跳过。

### H-9 创建索引（26 条；建索引期间别跑压测）

> **✅ 已完成（2026-10-18，经用户授权由 AI 通过"文档型数据库命令通道"创建）**：分批执行 `createIndexes`，**26/26 全部建成、无报错**。
> 复核 `listIndexes`：26 条自定义索引全部存在，其中 `unique:true` **6** 条、`sparse:true` **2** 条 —— 标志**确实生效**（不是"创建成功但被忽略"）。
> **原先两个未实测的疑问已解决**：CloudBase 文档型数据库**接受 `_id` 作为复合索引字段**、**接受 sparse 唯一索引** → 无需 `sortKey` 兜底。
> 下列手工步骤仅在需要重建环境时参考（SDK/CLI 无索引接口，AI 走的是文档型数据库命令通道）。

1. 控制台 → 数据库 → **索引管理** → 新建索引：选集合 → 依次添加字段与方向 → 需要时勾选「唯一」。
2. 按下表逐条建（**含 `clubId` 的索引一律以 `clubId` 打头**）：

| 集合 | 索引名 | 字段（方向） | 唯一 |
|---|---|---|---|
| rak_members | members_by_user | userId↑, createdAt↓, _id↓ | 否 |
| rak_members | members_by_club_status | clubId↑, status↑, createdAt↑, _id↑ | 否 |
| rak_members | members_by_club_role_status | clubId↑, role↑, status↑, createdAt↑, _id↑ | 否 |
| rak_members | **members_unique_team** | clubId↑, userId↑ | **是** |
| rak_identities | **identities_owner_reference** | ownerReferenceHash↑ | **是**（稀疏） |
| rak_tasks | tasks_by_club_created | clubId↑, createdAt↓, _id↓ | 否 |
| rak_tasks | tasks_by_club_status | clubId↑, status↑, createdAt↓, _id↓ | 否 |
| rak_tasks | tasks_by_club_assignee | clubId↑, assigneeMemberId↑, createdAt↓, _id↓ | 否 |
| rak_task_submissions | submissions_by_club_task_round | clubId↑, taskId↑, round↓ | 否 |
| rak_announcements | announcements_by_club_status_pinned | clubId↑, status↑, pinned↓, createdAt↓, _id↓ | 否 |
| rak_announcements | announcements_by_club_pinned | clubId↑, pinned↓, createdAt↓, _id↓ | 否 |
| rak_roi_items | roi_by_club_deleted_date | clubId↑, deletedAt↑, accountingDate↑ | 否 |
| rak_roi_items | roi_by_club_deleted_status | clubId↑, deletedAt↑, status↑, createdAt↓, _id↓ | 否 |
| rak_invites | **invites_code_hash** | codeHash↑ | **是** |
| rak_invites | **invites_scene_token_hash** | sceneTokenHash↑ | **是**（稀疏） |
| rak_invites | invites_by_club_created | clubId↑, createdAt↓, _id↓ | 否 |
| rak_join_entries | **join_entries_key_hash** | keyHash↑ | **是** |
| rak_join_requests | join_requests_by_club_status | clubId↑, status↑, createdAt↓, _id↓ | 否 |
| rak_join_requests | join_requests_by_user | userId↑, createdAt↓, _id↓ | 否 |
| rak_upload_sessions | sessions_by_member_state_expiry | uploaderMemberId↑, state↑, uploadExpiresAt↑ | 否 |
| rak_upload_sessions | sessions_by_state_confirmed_until | state↑, confirmedUntil↑ | 否 |
| rak_upload_chunks | **chunks_unique** | clubId↑, sessionId↑, index↑ | **是** |
| rak_attachments | attachments_by_club_task_submission | clubId↑, taskId↑, submissionId↑ | 否 |
| rak_attachments | attachments_by_lifecycle_created | lifecycleState↑, createdAt↑ | 否 |
| rak_commands | commands_by_retain_until | retainUntil↑ | 否 |
| rak_audit_events | audit_by_club_created | clubId↑, createdAt↓, _id↓ | 否 |

- **完成标准**：上表索引状态均为"已生效"；4 个唯一索引必须成功。
- **注意（已解决）**：原先存疑的两点 ——「`_id` 能否作为复合索引字段」「是否支持稀疏索引」—— 本轮实测**两者均被接受**（见上方完成说明），**无需** `sortKey` 兜底。
- **本步不做**的索引（其集合尚未创建）：`credentials_by_session_cleanup`、`attempts_by_session_state`、`attempts_by_state_updated`、`jobs_by_state_run_after`。

### H-10 数据库与存储安全规则（客户端一律拒绝）

> **✅ 配置已完成（2026-10-18，经用户授权由 AI 执行）**
> - **数据库**：经 `TCB.ModifyDatabaseACL`（按集合）把 20 个 `rak_*` 集合全部设为 **`ADMINONLY`（仅管理员可读写）**；逐集合 `DescribeDatabaseACL` **读回复核 20/20 = ADMINONLY**（原先为 `PRIVATE`）。
> - **云存储**：经 `storage set-acl` 设为 **仅管理员可读写**；`storage rules get` 复核 = **仅管理员可读写**（原为"仅创建者及管理员可读写"）。
> - **仍未验证**：客户端侧"是否真的被拒"必须有真实小程序端才能实测（属 H-19/H-20 真机验收项，当前 **NOT_RUN**）。
> - 命令通道备注：`storage set-acl --acl ADMINONLY` 的 `--acl` 参数会被忽略并进入交互菜单，实测改用交互序号输入（第 4 项＝仅管理员可读写）才生效。
>
> 下列手工步骤仅在你需要自查/重建时参考。

1. 控制台 → 数据库 → 权限 / 安全规则：把**每个集合**的客户端 `read` 与 `write` 都设为 **false**（等价于"仅管理端可读写"，即 `ADMINONLY`）。
2. 控制台 → 云存储 → 权限设置：设为**仅管理员可读写**。
- **完成标准**：小程序端 `wx.cloud.database` 任读/任写被拒；`wx.cloud.uploadFile` / `downloadFile` 直访被拒。
- **注意**：**禁止**为方便联调临时开"全员可读写"；不允许用公开桶规避私有存储。

### H-11 「函数调用权限」= 云函数安全规则（保姆级操作）

> **已完成（2026-10-18，经用户授权由 AI 经 API 配置，已读回复核）**
> **重要更正**：此前记录"只能在控制台设置"**不完整**。真实机制是**环境级「云函数安全规则」**（微信官方
> 《云函数安全规则》：`{"*":{"invoke":"auth != null"}}`），它**既能**在控制台改，**也能**用官方接口
> `TCB.ModifyResourcePermission` 改（经 `tcb api` 调用；`DescribeResourcePermission` 已实测可读回）。
>
> | 项 | 内容 |
> |---|---|
> | 实测**改前**状态 | `{"*":{"invoke":true}}` —— **所有来源（含未登录）都能调用任意函数**，含 `rakMaintenance` |
> | 现已写入的**目标**状态 | `{"*":{"invoke":"auth != null"},"rakMaintenance":{"invoke":false}}` |
> | **读回复核** | `DescribeResourcePermission` → `SecurityRule` 与目标一致 ✔ |
> | 反向对照 | 管理侧 `tcb fn invoke rakMaintenance` 仍正常返回（**规则只约束"客户端调用"**，服务端始终有权限）✔ |
>
> **规则含义**：`*` 是通配（对所有函数生效），具名键（`rakMaintenance`）**优先级更高**；
> `true`=允许所有来源（含未登录）、`false`=全部拒绝、`"auth != null"`=**仅已登录微信用户**可调用。

#### 如果你要自己做（两条路，任选）

**路径 A：让 AI 代做（最快，已做成过）**
对 AI 说一句"配 H-11"即可。AI 会执行：
`tcb api tcb ModifyResourcePermission`，body 为
`{EnvId:"cloud1-d4g36r8z6a8908540", ResourceType:"function", Permission:"CUSTOM", SecurityRule:"<上面的 JSON>"}`，
随后 `DescribeResourcePermission` 读回复核。**只改这一条规则，不动函数代码与其它配置。**

**路径 B：你在控制台点（5 步）**

1. 打开**云开发控制台**（微信开发者工具 →「云开发」，或 CloudBase 网页控制台），把左上角环境选成
   **`cloud1-d4g36r8z6a8908540`**。
   - ⚠️ **最容易错的一步**：环境选错就会把规则写到别的地方。先确认环境 ID 再往下点。
2. 进入 **云函数** 页面（**列表页**，不要先点进某个具体函数）。
   - ⚠️ 这条规则是**整个环境共用**的一条；在单个函数页里改的是别的东西，不会生效。
3. 在页面顶部/右侧找「**权限控制**」按钮（有的版本叫「**安全规则**」或「安全管控」）。
   - ⚠️ 实在找不到：就在云函数页里找带"权限/安全"字样的入口；若仍然没有，直接回到路径 A。
4. 选择「**自定义安全规则**」，把下面这段**整段粘贴**进去（注意：JSON 的键和字符串都要双引号、末尾不能多逗号）：

   ```json
   {
     "*": { "invoke": "auth != null" },
     "rakMaintenance": { "invoke": false }
   }
   ```

5. 保存。**判断标准**：页面没有报错、保存后**刷新一次**，规则框里显示的正是你粘的这段内容。
   - ⚠️ 若提示 JSON 解析错误：多半是粘成了 `{"*":{"invoke":"auth != null"},}`（多逗号）或少了大括号。

#### 怎么知道"真的生效了"

- **配置层**（现在就能判断）：上面第 5 步刷新后内容一致；或让 AI 读回复核（`DescribeResourcePermission`）。
- **行为层**（需要真机/真实小程序，**当前 NOT_RUN**）：用小程序端调用 —— 调 `rakApi` 应正常返回业务码；
  调 `rakMaintenance` 应被拒绝。**没有真实小程序时这一步做不了，不要写成"已验证"**。
- **不要混淆**：`tcb fn invoke`（管理侧）与"控制台测试"**永远能调通**，这不代表客户端也能调。

- **注意**：worker 只信平台可信来源；**`event.source` / `type` / `clubId` 不能当作系统权限**（实测：管理侧 invoke 的 `getWXContext()` 为空，既无 OPENID 也无 SOURCE）。`auth != null` 若与"未登录模式"冲突，会在该模式下拒掉调用——本项目不使用未登录模式。

### 本组范围外的三项（顺带说明，避免你误操作）
- **H-3**：已裁决**不另建**隔离环境（沿用 `cloud1-d4g36r8z6a8908540`）——如想改主意，请先说明。
- **H-4**：**已完成**（CLI 登录已实测通过，只读盘点已执行）。
- **H-6**：仅当根依赖变化才需要；目前新增依赖为 **0**，暂**不需要**执行安装。
- **H-7**：**已完成** —— SDK 锁定 `wx-server-sdk 4.0.2` 并**已写入** `build:cloud` 产物 `dependencies`（见 §B 的 H-7 完成说明）；`as of 2026-10-18` 服务端已 import SDK（`server/entrypoints/runtime.ts`）。

### 云函数**环境变量**（H-7 之后必配）

> **✅ 已完成（2026-10-18，经用户授权由 AI 经 CLI 配置）** —— 你**无需**再在控制台手工填。
> - **机制**：本机 `cloudbaserc.json`（已加入 `.gitignore`，**含函数密钥，不提交**）写入 `functions[].envVariables`；
>   用 `tcb config update fn rakApi` / `fn rakFiles` **推送配置**（**不动函数代码**）。
>   该命令检测到环境变量时会**交互询问**「覆盖更新 / 合并更新」→ 选**覆盖更新**（推送时云端尚无环境变量，两者等价）。
> - **核实结果**：只读 `config pull` 回读 → `rakApi`、`rakFiles` 均含 **4 个**键；`rakMaintenance` 无（按设计不需要）。
> - **密钥**：`RAK_JOIN_SECRET` 由本机 `crypto.randomBytes(48)` 生成（64 字符 base64url），**全程未回显、未进日志**；仅存在于本机被忽略的配置与云端函数环境变量中。

| 变量名 | 值（本环境） | 用途 |
|---|---|---|
| `RAK_APP_ID` | `wxa8bf102dcfdcec4c` | 预期 AppID（服务端校验，不自报） |
| `RAK_CLOUD_ENV` | `cloud1-d4g36r8z6a8908540` | 预期环境 ID |
| `RAK_JOIN_SECRET` | 本机生成的 64 字符高熵串（仅本机/云端可见） | 申请入口 token HMAC 密钥 |
| `RAK_STORAGE_FILEID_ROOT` | `cloud://cloud1-d4g36r8z6a8908540.636c-cloud1-d4g36r8z6a8908540-1502866673` | 存储 fileID 前缀（U5 实测桶名） |

- **状态（2026-10-18）**：环境变量已配置、三函数已**重新部署**并**冒烟通过** ——
  `rakApi`/`rakFiles` 对合法信封返回 **`identity_required`**（证明运行时已真实绑定、守门生效）；
  管理侧 `fn invoke` 的 `getWXContext()` 为空（无 OPENID），故**不是** `setup_required`（那需要真实微信身份）。
- **再次推送/部署时**：`cloudbaserc.json` 是**本机**文件（已 gitignore），务必以它为部署来源；
  勿在控制台手工「重置环境变量」，否则 `RAK_JOIN_SECRET` 会丢失（重新生成会作废在途申请入口令牌）。

### 做完后请回报（便于我推进 M8）

| 字段 | 例 |
|---|---|
| 步骤号 | H-8 / H-9 / H-10 / H-11 |
| 完成时间 | 2026-10-18 10:30 |
| 结果 | 成功 / 部分成功（哪些索引被拒、报什么错） |
| 证据 | 控制台截图路径（**不要**含密钥/AppSecret） |
| 阻塞 | 是否仍卡住后续步骤 |
