# Rak 多团队切换与云端数据隔离设计

日期：2026-10-17（Asia/Shanghai）。状态：**方案交付，未开发、未部署、未进行真实云端或真机验证**。
适用项目：`C:/Users/24800/Desktop/小程序/rak-control`。
配套计划：[AI实施计划](../plans/2026-10-17-rak-multi-team-isolation-plan.md)。基础能力：[2026-10-16云化设计](2026-10-16-rak-cloudbase-multiuser-design.md)。

## 1. 需求、已确认决策与完成定义

### 1.1 本次目标

同一个微信账号可以同时属于多个团队。在“我的”界面选择“切换团队”，进入目标队后，姓名、职务、角色、权限、任务、交付附件、公告、成员、ROI、绩效、申请和邀请码均使用目标队的数据。切换只改变当前设备正在使用的团队，不复制、合并或移动任何数据。

用户已明确确认：首版由**有平台管理权限的人受控创建团队**，各队有自己的超级管理员，成员通过邀请码或入队申请加入。任何小程序用户不得仅凭先登录或客户端按钮取得平台/团队管理员权限。

用户再次强调：正式数据必须存云数据库；**小程序端禁止直连云数据库，所有读、写、查询、计数、聚合、监听的业务替代能力均经云函数**。文件存私有云存储，云函数核验业务关系后授权；不把桶公开作为共享方案。

保持先前决定：本地主要是演示/测试，云端从空业务数据开始。本轮仅提供方案与实施计划，不改业务代码、不开通环境、不上传函数、不修改线上规则、不迁移演示数据。

### 1.2 必须观察到的结果

1. 同一微信在A队是超管、在B队是普通成员；切到B后不能发布公告、验收或任免，切回A恢复A权限。
2. 同一微信在A/B有独立memberId、姓名/职务、任务及绩效；A修改资料或被禁用不改变B。
3. “我的→切换团队”能列出本人关联团队；0队、1队、多队、待审、停用、离队、维护及网络失败有确定落点。
4. 任务、公告、ROI、榜单、详情、分页、搜索、附件、命令结果、后台回收都按团队隔离，不能只测首页列表。
5. A请求迟到、A→B→A、返回旧页面、上传选择器回调、写入超时后切队均不能污染新上下文。
6. 两台手机同微信分别使用A/B，互不改变另一台手机在途请求的团队；清缓存/换机可从云端重新读取已提交数据。
7. 改clubId、混合不同队资源ID、伪造角色、复用异队游标/命令/附件，以及直接客户端数据库操作均有拒绝证据。

## 2. 代码事实与证据边界

2026-10-17只读核查，行号为快照，实施时重新定位。未查询远端控制台，不据本地文件断言远端资源状态。

| 事实 | 源码位置 | 对方案的影响 |
|---|---|---|
| 只有可变单例clubId | `src/services/context.ts:1-12` | 要换成不可变请求上下文，不只setClubId |
| AuthStore只有一份user/club/role/permissions；刷新无队伍栅栏 | `src/store/index.ts:54-60,115-138` | 拆账户身份与当前本队会话 |
| clear只清认证，业务Store是全局单例 | `src/store/index.ts:165-173,602-606` | 切队/登出必须清业务及页面局部状态 |
| 任务筛选有generation，未绑定team epoch | `src/store/index.ts:226-303` | 保留现筛选防竞态，另加团队epoch |
| ROI、公告、名册、绩效、申请等异步回填无团队校验 | `src/store/index.ts:380-419,482-525,568-595` | 不允许A结果回填B |
| “我的”读全局姓名/职务、单club，无切队入口 | `src/pages/me/profile.tsx:14-35,37-114` | 展示本队成员资料并新增入口 |
| 登录成功会直接回首页 | `src/pages/auth/login.tsx:30-34` | 已在A的人加入B需独立页面，不能被旧重定向拦住 |
| 创建公告后再发布、选文件、编辑回填都是多步异步 | `src/subpackage-admin/pages/admin/announcements.tsx:41-48`、`src/pages/task/detail.tsx:82-118`、`src/subpackage-admin/pages/admin/roi-edit.tsx:38-55` | 每个步骤绑定发起时的ctx，切队后不继续旧链 |
| ClubMember已有clubId/userId/displayName/duty | `src/types/domain.ts:61-70` | 可演进成各队独立成员资料 |
| 全局token、QR内存缓存、单份demo状态 | `src/constants/index.ts:3-8`、`src/services/club.ts:68-78`、`src/demo/runtime.ts:11-22` | 不能作为多团队安全边界 |
| 当前仍是demo/HTTP，无正式cloud模式/本地cloudfunctions | `config/build-mode.ts`、`project.config.json`、根目录核查 | 基础云化与本方案需一起落地，不是假定已部署 |

当前Git工作树已存在，两个2026-10-16方案文件有既存暂存修改；本轮不改暂存区、不reset、不提交。旧方案关于“无.git”的事实已过时。未发现主项目/祖先与相关源码目录适用的AGENTS.md；备份与OA工程不作为本任务指令。

## 3. 方案比较与裁决

| 方案 | 代价与收益 | 裁决 |
|---|---|---|
| 每队独立小程序/独立环境 | 物理边界直观，但多AppID身份/发布运维重复，不符合一个小程序切队 | 不选 |
| 同一AppID、同一后端，所有业务按clubId逻辑隔离 | 同微信跨队使用方便；需系统性鉴权、成员资料及缓存隔离 | **推荐采用** |
| 仅换前端当前团队或按用户分本地JSON | 后端/缓存/文件仍可能混用，无法验证多用户隔离 | 禁止作为正式方案 |

这里“隔离”指普通成员、各队管理员、业务接口及正常后台流程之间的逻辑隔离。环境管理员仍具底层运维权限；同环境共享配额可能有资源竞争。本方案不声称可防有云环境管理权限者读取数据，也不声称物理资源完全独占。

## 4. 文档优先级与术语

本文件覆盖旧云化设计中的：单社团、全局唯一owner、system_config/main.clubId、全局displayName/duty、仅env/user缓存、未带团队的命令键与默认选队。配套新计划是当前执行主入口；旧计划保留为基础能力参考，不能先完整实现单社团再返工。

仍保留旧设计的：可信微信身份、默认拒绝、云函数唯一DB入口、真实云验证、3件/10MiB附件、交付轮次、文件先冻结后验证、doc-only事务约束、幂等24h/7d/30d、金额分、上海日期、分页与失败传播。

**唯一字段名称用clubId**（对应现有源码），产品文案叫“团队”；不得同时引入teamId/companyId/tenantId三份可变归属。现ClubInfo.tenantId旧HTTP字段仅legacy适配保留，cloud-v2不接收/输出它。

- account/user：同AppID下同一微信的全局内部身份，无团队角色/业务资料；不依赖跨AppID UNIONID。
- member：某账户在某队的成员记录；memberId是该记录ID，role/status/姓名/职务属于此记录。
- club：一个团队/社团，clubId随机且不可变；队名可以相同，不能作为主键。
- owner：某队唯一受保护的super_admin成员；**不是平台管理员**。
- scope：本次请求目标范围，GLOBAL或TEAM；clubId只是选择器，授权必须重新查成员。
- epoch：当前设备本次团队上下文代次；每次切换/恢复/登出递增，A→B→A也是不同代次。

## 5. 全局账户与每队成员模型

### 5.1 数据归属

| 数据 | 归属与对外规则 |
|---|---|
| appId/openid→内部userId、平台安全状态 | 全局服务端，仅本人账户最小标识；openid不对外 |
| displayName、duty、role、status、joinedAt、permissions | 本队membership；A/B独立，可不同姓名/职务/角色 |
| 申请name/wechat/reason及审核 | 本队申请；只本人/该队有权审批者；不放全局用户资料 |
| 认领/交付/质量分/绩效/本队个人摘要 | clubId+memberId；不按全局userId合并统计 |
| 任务/公告/ROI/成员目录/邀请码/队设置 | 本队；同名项目也不合并 |
| 主题、设备上次选队建议 | 可本设备保存；上次选队不是授权，不同步成服务端currentClub |

云端业务DTO用memberId/assigneeMemberId/createdByMemberId/authorMemberId等明确字段；旧UserInfo.duty/global assigneeId不能未经适配继续当新契约。UI“我的”显示activeSession.member.displayName/duty，不用全局user姓名回退。没有姓名应显式资料未完成，而不是取另一队姓名。

全局userId只用于内部身份查找，允许在本人AccountView中作为opaque accountKey；本队名册、任务作者、管理目标DTO不含对方全局userId/openid/其他团队数量或列表。memberId仍有本队正常关联用途，不宣称可阻止人凭相同姓名识别同一个人。

### 5.2 集合与键（待创建/改造）

下表均为新cloud-v2契约，不代表现已存在。所有团队业务文档必须显式clubId，不能仅靠外键间接推导；createdAt/updatedAt服务端UTC，业务日YYYY-MM-DD按上海时区。

| 集合 | 主键/关键字段 | 必须约束 |
|---|---|---|
| rak_system_config | main:appId,schemaVersion,platformInitializedAt,maintenanceFlags | 删除唯一clubId/ownerUserId语义，不保存当前队 |
| rak_identities | hash(appId,openid):userId,ownerReferenceHash?,ownerReferenceExpiresAt?及受控参考号资料 | 同微信唯一；本人/运维受控，参考号不授权限 |
| rak_users | userId:createdAt,updatedAt,securityState,securityMutationSeq | securityState=NORMAL/BLOCKED；无团队role/status/displayName/duty；仅受控平台运维可改安全状态并审计，团队管理员不可改 |
| rak_clubs | clubId:name,slug,displayCode,ownerMemberId,status,settings,revision,mutationSeq,createdAt | status=ACTIVE/MAINTENANCE；每队一个owner；displayCode仅辨识非入会凭证 |
| rak_members | memberId=hash(clubId,userId):clubId,userId,displayName,duty,role,status,createdAt,joinedAt,revision,mutationSeq | role=member/manager/super_admin；status=ACTIVE/LEFT/DISABLED；同人每队至多一个；createdAt不可变用于选队分页，joinedAt为入会业务时间 |
| rak_join_requests | hash(clubId,userId):clubId,userId,name,wechat,reason,status,attemptNo,resolution,revision | 单队申请唯一；不同队独立 |
| rak_invites | inviteId:clubId,codeHash,maskedCode,sceneTokenHash/受控sceneToken,maxUses,usedCount,expiresAt,revokedAt,createdByMemberId | 码/scene全环境唯一；目标由此记录确定 |
| rak_join_entries | entryId:clubId,keyHash,version,revokedAt,createdByMemberId | 申请链接仅公开最小队名，不自动入会；每队当前入口可轮换 |
| rak_join_entry_states | clubId:clubId,currentEntryId,entryVersion,revision,mutationSeq | 每队确定性当前入口；rotate与首次join.submit事务共同写此文档，序列化撤销与提交 |
| rak_provisioning_operations | hash(appId,env,provisioningId):inputHash,clubId,ownerMemberId,status,createdAt | 仅受控运维；成功记录与建队、建成员、审计、消费参考号同事务，幂等恢复不重建团队 |
| rak_tasks | taskId:clubId,assigneeMemberId,createdByMemberId,revision,currentRound,lastSubmissionId及原任务字段 | 所有成员引用与任务同队；六状态不变 |
| rak_task_submissions | submissionId:clubId,taskId,round,submittedByMemberId,attachmentIds,note,status,reviewedByMemberId | 同队/轮次唯一，历史不可覆盖 |
| rak_announcements | announcementId:clubId,authorMemberId,status,pinned,title,body,revision | 普通成员只读本队PUBLISHED；管理草稿同队 |
| rak_roi_items | roiId:clubId,createdByMemberId,costCents,revenueCents,accountingDate,deletedAt,revision及原字段 | 本队分/日期统计；无跨队总额 |
| rak_upload_batches | hash(clubId,taskId,targetRound):clubId,taskId,ownerMemberId,slots[固定3格],state,revision | init/cancel/expire/submit共用doc；不递增task业务revision |
| rak_upload_sessions | sessionId:clubId,taskId,uploaderMemberId,taskRevision,targetRound,state,transport,期限/lease/fence | 归属不可改；切队不重绑 |
| rak_upload_credentials | attemptId:clubId,sessionId,issuedToMemberId,state,actualExpiresAt,cleanupNotBefore | 不存token/URL；每次签发归本队 |
| rak_storage_attempts | attemptId:clubId,sessionId,kind,objectPath,fileID?,state,writeOutcome,lease/fence | 单session一个staging、多凭证；其他attempt唯一路径 |
| rak_upload_chunks | hash(clubId,sessionId,index):clubId,sessionId,index,sha256,size,fileID,state,attemptId | 仅分块备选创建；已接受片不可变 |
| rak_attachments | attachmentId:clubId,taskId,sessionId,submissionId?,uploadedByMemberId,fileID,integrityState,scanState,lifecycleState及原元数据 | 同队引用闭环，原始fileID仅服务端；URL不落DB |
| rak_commands | hash(scope,actorIdentityId,action,mutationId):scope,actorIdentityId,inputHash,status,resultRef,期限 | scope包含TEAM.clubId或GLOBAL；业务结果重新授权 |
| rak_jobs | jobId:clubId,type,resourceId,state,runAfter,lease/fence,attempts | 业务job必须有clubId，不从用户当前队推断 |
| rak_audit_events | id:scope,actorMemberId?,action,resourceId,requestId,mutationId,摘要 | 本队管理只可见本队；平台安全审计不公开 |
| rak_rate_limits | hash(scope,subject,action,timeBucket) | 全球账户反滥用与单队业务配额分别计数 |
| rak_stats（若启用） | hash(clubId,metric,memberId?,period):clubId,asOf及派生值 | 可重建，不能混队累计 |

外键全链检查：task→submission→attachment→session→batch→storageAttempt/chunk→job的clubId必须一致；目标member属于同队。缺clubId的旧/损坏记录隔离并告警，不默认分配给当前队。相同hash/文件名不得跨队共享attachment、URL或物理去重删除关系。

### 5.3 每队owner与受控开通

1. 平台初始配置只做一次；以后开通第2/第3队不重置全平台。
2. 拟任owner用本人微信进入，GLOBAL `account.provisioningReference`生成30分钟有效参考号；按基线受控hash查询/未消费且有效期内复用/过期换发，不能自行晋升，也不列其其他团队。已消费号返回consumed提示；同账号开第二队需显式换发新号，不能把已消费号再次作为可用号返回。
3. 有环境管理权的人运行受控脚本，确认目标账户、队名/slug、该队owner展示名。先按provisioningId读取操作记录：已成功且inputHash一致则恢复原clubId/ownerMemberId；同ID不同输入拒绝。新操作的随机clubId在事务外只生成一次并在事务重试中复用，事务doc重读未消费参考号并原子创建club、该队owner membership、审计、操作记录及消费参考号。进程重启也先查记录，不能重新生成第二队；不同provisioningId争用同参考号只能一个成功。inputHash含appId/env/队名/slug/owner目标与姓名，不含本机时间/随机clubId。
4. 一个人可以拥有A队、在B队是member；不同队也可不同owner。不得设置全局isSuper或让A owner创建/查看B。
5. 业务任免只允许本队owner任命manager/member；manager只能管理本队member。ownerMemberId与super_admin角色必须同事务保持唯一一致，不允许普通接口删除、停用、降级owner或另授第二super。丢号恢复/owner转移首版仅受控运维并审计，不提供自助转移UI。

## 6. 云函数调用与强制团队范围

### 6.1 统一契约

采用新的apiVersion=2，基线v1也只是提案，未实施时直接实现v2，不要求同时维护一套错误的单队v1。若P0发现真实部署v1用户，先做兼容/切流方案，不能静默变更。

```ts
type RequestScope = { kind:'GLOBAL' } | { kind:'TEAM'; clubId:string };
type CloudRequest<T> = {
  apiVersion:2; action:string; scope:RequestScope; requestId:string;
  mutationId?:string; expectedRevision?:number; data:T;
};
type TeamSession = {
  club:{id:string;name:string;displayCode:string;status:'ACTIVE'};
  member:{id:string;displayName:string;duty:string|null;role:ClubRole;status:'ACTIVE';revision:number};
  permissions:string[]; asOf:string;
};
```

响应仍是基线ok:true/false+serverTime；额外回scope，客户端验证等于捕获的请求scope。GLOBAL邀请兑换可在data.resolvedClubId返回服务端解析目标，但响应scope仍GLOBAL，**不自动切当前队**。expectedRevision属于明确业务资源，membershipRevision不冒充它。

每动作在注册表声明允许scope种类。TEAM缺clubId、scope/action不匹配、data再塞clubId/teamId/userId/openid/actorRole/permissions等归属或自报授权字段、来源或环境错误均拒绝。目标成员字段只能targetMemberId；成员任免仅对应schema允许targetRole/targetStatus，不接受含混role/status；资源ID不可作为自动选队依据。

### 6.2 动作范围清单

| 动作 | scope/输入 | 授权与输出 |
|---|---|---|
| auth.bootstrap / auth.me | GLOBAL，data空 | 真实微信身份事务get-or-create账户；返回本人accountKey、平台状态/时间；不返回全局角色 |
| account.provisioningReference | GLOBAL，{replaceConsumed?:true} | 仅本人参考号/有效期，不产生membership；已消费参考号只在明确replaceConsumed时换发 |
| team.listMine | GLOBAL，cursor/pageSize | 仅本人成员关联，返回队名/displayCode/本人role/status/可进入状态，无各队业务摘要 |
| team.enter | TEAM，data空 | 实时验证该队ACTIVE+有效成员，返回TeamSession；无服务端当前队写入 |
| team.resolveJoinTarget | GLOBAL，joinKey | 有意共享的申请入口→最小队名/clubId+本人短效joinTargetToken，非全队检索 |
| join.mine / join.status | GLOBAL，cursor或joinRequestId | 只本人申请及最小目标队名/状态；不返回其他申请者 |
| join.submit | GLOBAL，joinTargetToken,name,wechat,reason | 服务端解析/校验目标队；本队待审，不阻止其他队ACTIVE |
| invite.redeem | GLOBAL，{code或sceneToken,displayName}互斥 | 目标从invite查得，原子扣额/入会；不接受当前队覆盖目标 |
| command.status | GLOBAL或TEAM，与原命令完全相同 | action/mutationId，仅本人；GLOBAL仅注册的本人入会动作，TEAM仍需该队当前权限 |
| member.updateMyProfile | TEAM，displayName,expectedRevision,duty? | 本队本人可改展示名与职务（**2026-10-18 起职务不再限制 owner**，职务不参与授权）；不能改role/status/其他队；member/manager职务由上级白名单管理 |
| member.updateProfile | TEAM，targetMemberId,duty?,displayName?,expectedRevision | manager仅member、owner可manager/member；不能改owner。敏感资料不自动复制 |
| team.joinLink.rotate | TEAM，expectedRevision | manager+，轮换本队申请入口，明文当次显示、通用命令只恢复ID/masked |
| club.get/update/dashboard，profile.summary | TEAM，原白名单 | 该队有效成员及角色范围；摘要不混队 |
| member.list/setRole/setStatus，join.list/approve/reject，invite.list/create/revoke/qr | TEAM，targetMemberId/对应资源ID | 原角色矩阵按本队实施 |
| task.*，submission.*，announcement.*，roi.*，performance.* | TEAM，原业务字段改member引用 | 沿用基线能力与状态机，但所有列表/详情/写入/统计都锁本队 |
| file.init/status/confirm/cancel/downloadUrls/previewDraft/putChunk | TEAM，sessionId/attachmentIds等白名单 | 全链同队+负责人/管理关系；status不签URL |

member.setRole的精确输入为{targetMemberId,targetRole:'member'|'manager',expectedRevision}；member.setStatus为{targetMemberId,targetStatus:'ACTIVE'|'DISABLED',expectedRevision}，允许转换再按基线核验。两者均不能修改owner，manager无setRole权限；LEFT的恢复不借setStatus隐式加入，首版仅受控运维。targetRole/targetStatus是目标变更请求，不是调用者权限凭据。

团队列表与申请列表分开，避免多源拼页漏项：team.listMine按本人membership.createdAt/id分页（20默认、50最大），只投影相关club最小摘要；join.mine按本人申请createdAt/id独立分页，不把待审误作可进入队。禁止只取SDK默认首批作为全部团队。

### 6.3 服务端授权路径

```text
可信本次APPID/OPENID/环境 → identity/user → 平台安全状态NORMAL
→ 注册表确认TEAM scope → doc(hash(clubId,userId))读取本队membership
→ club.status / membership.status / action能力
→ 资源clubId及全部关联member/文件链相等
→ 本队仓库查询/短事务 → DTO投影 → scope响应
```

仓库所有业务方法必须接不可缺的TenantContext（clubId、actorMemberId、可信身份引用/权限），禁止默认clubId、可选tenant参数及公开rawCollection。getById也必须做同队比较，count/aggregate/search与list同filter；聚合lookup子管道同队。不存在和异队资源统一resource_not_found，不返回其真实队名或存在性。

所有GLOBAL/TEAM入口均查本人rak_users.securityState；BLOCKED只允许auth.bootstrap/auth.me返回本人最小封禁状态与静态帮助，不能签参考号、入会、选队或读内部业务。关键写与本人user.securityMutationSeq、本队member.mutationSeq在事务中共同修改；受控平台封禁写同user，禁用/任免写同member，冲突后重新鉴权。GLOBAL写也触碰本人user；受控开通检查拟任owner为NORMAL并写其安全栅栏。team维护与业务写同时触碰本队club.mutationSeq；其热点需容量测试，不用全平台锁。只读按请求时鉴权，不保证撤回已返回内容。

GLOBAL入会动作需要可信且NORMAL的账户，事务内校验目标队+该队现有member；LEFT/DISABLED不能靠码或申请复活。批准/兑换/申请与基线一样收敛：ACTIVE不重新申请、不扣重复额度、不覆盖已经晋升的角色/姓名。所有写入姓名只到目标membership，不改全局user或另一队。

会增加或恢复目标账户权限的操作（如批准申请、受控恢复owner）也检查目标user为NORMAL并触碰其securityMutationSeq，actor与target相同时去重；与平台封禁按同doc写冲突排序。不得只查操作者NORMAL就给已BLOCKED目标新增有效权限。系统worker没有“本人”；代办发布的授权主体由job→session.uploaderMemberId→内部userId获得，不能从event传入的userId取得。清理/对账可作为受限系统例外继续。

## 7. 进入、加入第二队与权限边界

### 7.1 冷启动和选择

auth.bootstrap成功后取team.listMine首批并显示选择页。若本设备有lastSelectedClubId，先team.enter验证再恢复，验证前不展示其缓存业务或角色。没有建议且完整列表仅一个可进入队，可自动enter；有hasMore或多个候选则选择，不能假定第一页唯一。只有待审/停用/离队则显示状态和加入其他队入口。全局平台维护阻断全部；本队维护仅使本队不可进入，仍可选其他队。

team.enter每次返回最新成员资料、role、permissions；后续请求继续实时验证，返回的权限只帮助UI渲染。team.listMine失败显示重试，不能当“无团队”，也不能回退demo。

### 7.2 加入第二队

“切换团队”页提供“加入其他团队”：

- 有邀请码：输入12位码或从scene进入，GLOBAL兑换，显示目标队确认/结果；成功刷新列表，用户选择“进入该队”才调用切换协调器。原A会话不被兑换响应覆盖。
- 无邀请码：获得管理员分享的**申请链接/申请码**，team.resolveJoinTarget只显示该队有意公开的名称/displayCode，不公开团队目录/成员/ROI。返回10分钟有效joinTargetToken，绑定account/AppID/env/clubId/entryId/entryVersion/issuedAt/expiresAt/tokenVersion；签名密钥只在服务端受控配置。join.submit验签并事务doc重读且写rak_join_entry_states.mutationSeq/club栅栏；rotate同事务更新该队入口状态与审计。轮换事务先提交后旧token不能新建申请；相反排序则保留已合法提交的申请，不回滚历史。链接不是直接入会邀请码。
- 待审/被拒：join.mine/status按本人和目标队分别显示；A待审不影响B使用。APPROVED后仍需team.enter实时校验。

joinKey是高熵随机入口（至少128bit、服务端生成、仅hash查找，模板不暴露密钥）；轮换原始值只当次显示，丢响应恢复entryId/masked并可撤销重建，不声称能恢复已丢明文。邀请码scene继续沿用基线真实平台能力门禁，不能伪造二维码。

已有登录页一AUTHED就回首页，实施时必须将“账户已识别”和“本队可访问”解耦，新建独立team-join页面。深链进入申请/邀请码不能先被自动导航覆盖；pendingIntent绑定account与目标、一次消费、禁止通用任意URL跳转。

### 7.3 业务深链与旧链接

新版业务链接使用白名单结构{apiVersion:2,clubId,resourceKind,resourceId}，resourceKind只允许已登记的task/announcement/roi等；不携role、fileID、临时URL或任意跳转URL。相同当前队则用当前ctx查询；不同队先验证本人目标membership，只展示已授权的最小队名/编号并提示切换，走同一switchCoordinator处理脏编辑与在途写，再用新ctx读取资源。无资格统一不可访问，不全库搜索ID反推队伍。仅id无clubId的旧链接只能在当前READY队范围内尝试；无当前队则先选队，不探测其他队。不匹配的clubId/resourceId按resource_not_found处理。pendingIntent绑定accountEpoch、目标scope、白名单路由与switchAttemptId，仅在目标进入成功后一次消费；取消、换账号、环境变化或后续新意图使旧intent失效。

### 7.4 权限示例

| 情况 | A队 | B队 |
|---|---|---|
| 同微信A owner、B member | A管理能力 | B成员能力，不能借A角色发布/验收/任免 |
| A禁用、B ACTIVE | A拒绝新内部读写/文件签发 | B照常，不全局登出 |
| A pending、B ACTIVE | A只本人申请状态 | B照常 |
| A owner查看本队某成员 | 本队资料/本队履历及权限允许内容 | 不知道该成员是否在B或其B角色/绩效 |

同一个人有权属于两队，可**主动使用合法B scope读取其有权B数据**；本方案禁止的是错误scope混用/越权/跨队合并，不会把此人正常切B也当攻击。另一队普通管理员没有平台身份枚举能力。

## 8. “我的”页与团队选择交互

保留当前浅米色/紫蓝与深色主题、图标和字号体系，不整页重做。

```text
我的
  当前团队：摄影社 · A7K2      [切换团队 ›]
  本队身份：王同学 / 宣传部 / 管理者
  本队进行中、待验收、任务、绩效和管理入口

切换团队（独立页）
  当前：摄影社 · A7K2  管理者  ✓
  机器人社 · B9M4      成员    [进入]
  另一队 · C3R5        已停用  [状态说明]
  [加入其他团队]  [我的入队申请]
```

当前团队卡与“切换团队”入口始终可见（只有1队也可找加入入口）。账号已识别但无可进入队时，“我的”/选择壳只显示账户与团队入口，不渲染内部宫格。每行使用name+displayCode区分同名队，带role/status；列表不展示各队任务数/ROI/绩效横向汇总。不提供“全部团队”混合视图。

选当前队无脏数据/无切换任务时为无操作，不重复enter/清草稿。选择非当前队后busy，防连点；连续意图采用串行只处理一个，不能让较早返回的团队覆盖较晚选择。长队名/无职务/多页/状态更新要换行与留白，禁用行有明确原因及其它队入口。

## 9. 不可变上下文与切换状态机

### 9.1 请求上下文

账户与团队是两层生命周期。增加不可变AccountContext={backend,env,appId,accountKey,accountEpoch}，供team.listMine、join.mine/status/submit、resolve、redeem、参考号等GLOBAL请求使用；在未知accountKey的首次bootstrap期间使用{backend,env,appId,accountEpoch,bootstrapAttemptId}，成功且尝试仍有效后才安装AccountContext。换微信/登出/全局身份失效/换环境同时递增accountEpoch与团队epoch，清账户及团队数据。普通切队只递增团队epoch，不失效同账户在途GLOBAL入会结果；GLOBAL结果只可更新本人账户级列表/申请状态，不得自动切当前团队或刷新其业务。所有GLOBAL请求的toast/finally/导航同样核对AccountContext与各自queryGeneration；不得用“没有当前队”跳过栅栏。

```ts
type TeamContext = Readonly<{
  backend:'cloud'; env:string; appId:string; accountKey:string;
  clubId:string; memberId:string; epoch:number; membershipRevision:number;
}>;
// 伪代码：不是可直接粘贴执行的CloudBase API
const ctx = teamStore.captureReadyContext();
const response = await tasks.list(ctx, query);
if (!teamStore.isCurrent(ctx)) return;
commit(response);
```

任何请求第一次发起时捕获一次ctx。读/写重试、后续API、分页、错误、toast、finally、导航、文件选择/保存回调都用它；不能await后重新读currentClubId发第二步。仅比较clubId不够：A→B→A必须通过epoch区分两次A。role变化导致权限上下文失效、账号变化、环境变化同样递增epoch。

### 9.2 切换步骤

1. READY(A)点击B：检查本队未保存表单、本地已选文件、上传/待确认写；没有则继续。UI确认仅针对丢弃本地编辑，不重复询问服务器权限。
2. 普通未提交表单：提供“留在当前队/放弃本次编辑并切换”。首版不承诺跨切队保存草稿，放弃只清本机未提交内容，不能删除已提交云记录。
3. 已发写请求：短时等待可确认结果；网络未知时明确“操作仍属于A，可切换后回A核对”，只记录A命令最小指针，不把超时当失败，不换键在B重做。
4. 上传中的本地调度停止发新片/新确认，对A session发送尽力取消并跟踪未知取消；已发PUT/片可能完成，仍只在A，不能因此声称字节立刻停止。用户可留A或放弃上传并切换；服务器超时/GC兜底。
5. 原子进入SWITCHING：epoch++、关闭受保护展示/写按钮、清所有业务Store/页面缓存/分页/QR/URL/表单和目标信息；取消旧读取只作省资源，结果栅栏仍必须存在。
6. 使用独立switchAttemptId请求team.enter(B)，返回时核对account/env/尝试编号与scope、schema、B会员状态。此时不能借A角色渲染B。
7. 成功才在一次MobX action内安装完整B TeamSession与ctx；保存本设备lastSelectedClubId。reLaunch到“我的”，清旧页面栈，再触发B数据加载。页面入口以新epoch挂载，旧Tab局部状态不复用。
8. 失败进入TEAM_SELECTION且activeTeam=null，显示错误并可重新进入A/其他队；**不恢复A旧缓存**，返回A也必须重新enter并产生新epoch。已发A业务写不会因切换失败被撤销。

状态：ACCOUNT_LOADING → TEAM_SELECTION → ENTERING → READY；READY → SWITCHING → READY或TEAM_SELECTION；team_required/停用/维护使当前ctx失效并回选择页，不注销其他队。全局身份失效/平台BLOCKED才清账户及所有队。scope不属于当前ctx的迟到错误不能清空当前队或弹错误toast。

### 9.3 页面及业务回调清理清单

- 全局：task/ROI/team/member/invite/join/performance/summary Store，列表过滤、cursor、total、loading/error/submitting；身份刷新本身也受account/epoch栅栏保护。
- 局部：首页计数、我的任务/绩效、任务详情说明/文件、公告详情、管理发布表单、ROI编辑、二维码弹窗、正在下载/预览索引、确认框回调。
- 多步：A公告create完成后若ctx已失效，不再自动publish、不在B toast；A已创建草稿留A，回A可管理。若publish已发可在A完成，仍不污染B。
- 所有finally仅能复位自己ctx的busy，不能把B按钮放开；旧403/401不全局登出B。全局账户失效须单独可信错误码，不从任意旧HTTP错误猜测。

## 10. 缓存、命令、游标与双设备

### 10.1 本地命名空间

首版不持久化业务列表/名册/权限；云端为真源。任何允许保存的敏感本地索引必须用：`backend + env + appId + accountKey + clubId + memberId + resourceKind + resourceId`，并加schemaVersion；URL缓存含实际expiresAt。团队列表/上次选择仅account级最小元数据，主题可设备全局。

切换清内存及私有URL/QR/详情缓存，不删历史云附件。退出或换微信清该账号本机敏感索引/能明确归属的临时文件；不能整目录删除、不能承诺撤销用户已另存的文件。lastSelectedClubId只作本设备建议，云函数不保存全局currentClub；设备1选A不改变设备2的B。

### 10.2 幂等与未知结果

命令键：`hash(canonical(scope),actorIdentityId,action,mutationId)`；inputHash覆盖apiVersion/action/scope/data/expectedRevision，排除requestId。TEAM A/B同mutationId是不同合法命令命名空间；B查A键只得到B自己的结果/不存在，不泄露A。有意跨队请求若payload夹入异队资源仍拒绝。

GLOBAL join.submit/invite.redeem命令在入口解析目标后记录resolvedClubId，只恢复本人最小结果；不能拿GLOBAL查任意TEAM命令。command.status必须scope与原命令一致、当前重新鉴权。

join.submit同键恢复时，在校验可信NORMAL本人、原scope/action及inputHash后先查既有command；已成功仅恢复本人最小申请ID/状态，即使原token已过期或入口已轮换也不重做、不误报失败。只有尚无已完成命令的首次执行才要求当前token和入口有效；command.status不需要原token明文。原payload丢失仅查询，不重构token或换键重提。

保持24小时重试资格/7天完整结果/30天幂等保留、UUIDv7年龄门禁和基线ABSENT_IN_WINDOW语义。切队只保留A的最小指针(action/scope/mutationId/inputHash/expectedRevision)，不缓存临时凭证；原payload仅在该ctx会话内可有限同键重试。进程丢失payload后只查结果/业务记录，不凭空重构并换键。A命令完成仅更新独立最小命令跟踪器；回A且重新鉴权才呈现A业务结果，不能在B自动发送A后续写或刷新B。

### 10.3 游标/搜索/统计

所有cursor绑定版本/action/clubId/查询指纹/排序值；账户级team.listMine/join.mine绑定account而非某队。成员/申请筛选不能传他队memberId。性能榜cursor还带score/memberId；公告按pinned/createdAt/id，其他基线复合排序保持。A cursor给B拒绝cursor_scope_mismatch，不能重置后偷偷返回B第一页。

首页、个人、ROI、绩效、榜单与搜索全部同队过滤，lookup两端同队。performance.mine从ctx.memberId计算，不接收全局userId；任务曾驳回仍按本队task去重，ROI按本队分与上海日期。榜单仍manager+ top5/全榜有界分页，不能把默认查询首批当全队。过滤失败/缺索引/超预算显示错误，不返回0伪成功。

## 11. 私有文件跨人共享与跨队隔离

### 11.1 固定边界

客户端DB和存储SDK直接读写仍拒绝。文件字节可按基线P0验证选择“函数签发exact-key受限PUT”或“受控分块函数”；所有业务授权/元数据/确认/绑定/删除决策在函数内。受限字节直传不等于直连数据库，不允许任意wx.cloud.uploadFile绕过协议。

本队负责人上传，本队manager/owner可按业务验收下载；该人在B有管理权不赋予其A文件权限。file.status/confirm/cancel/previewDraft/downloadUrls的TEAM scope必须等于记录clubId；同一账户同时属于A/B也不能用B scope操作A session。

路径由服务器生成，如`clubs/{clubId}/staging/{sessionId}/blob`、`clubs/{clubId}/final/{sessionId}/{attemptId}/blob`；前缀仅组织，不代替授权。SDK规范fileID来自返回/已实测recoverByPath，不手拼cloud://。不允许客户端上传归属路径/任意fileID要求签名。

### 11.2 保留基线可靠性并添加团队校验

- 最多3附件、单件1..10MiB；taskRevision/targetRound/clubId/uploaderMemberId全部一致。上传batch/credential/attempt/chunk/job显式同队。
- init短事务预占固定3槽，不改task业务revision；签发在事务外，返回凭证前再次校验原上传者user.NORMAL、成员/club状态/session fence。
- 首选先copy唯一candidate overwrite:false，再验证有界真实字节/hash，再事务发布；分块则固定不可变片与manifest。所有side effect先登记attempt；失去lease/已取消/队维护/成员停用不能发布。
- integrityState仅VERIFIED且scanState在NOT_CONFIGURED/PASSED/UNSCANNABLE明确白名单可交付，BLOCKED/未知拒绝；未配置扫描不得宣称已病毒检测。
- uploadExpiresAt=init+30分钟、confirmedUntil=confirm+24小时、平台真实签名到期独立；实际授权最晚到期+5分钟后才能清staging。10分钟扫描与24小时回收SLO不等于平台保证。
- 提交按本队batch选择0..3件，选中转ATTACHED，未选session取消/fence++、未选DRAFT进入GC_PENDING，再封闭batch；不让旧轮在切队后复活。
- 下载按attachmentId逐件反查同队任务/交付/权限；草稿预览仅本人当前有效CONFIRMED+DRAFT；临时URL最长300秒为待验证上线门槛，刷新前重新鉴权，不能伪造expiresAt。
- 临时URL/凭证不落正式DB/日志；缓存包含完整ctx。A URL即使未过期也不用于B UI。已签URL可在有效期内转发，停用/切队不能撤回已经下载内容，不能声称绝对防复制。

### 11.3 切换与后台

切队不改变任何云记录clubId，不把A的草稿/已上传附件绑定B；需要同文件用于B时重新选文件并按B授权上传，首版不提供跨队转存。选择器或saveFile迟到时校验epoch，只清本次明确新建且未引用的临时文件，不删共享历史。

worker只信平台系统调用身份，从持久化job读取clubId，再核对session/attempt全链；入口event.clubId/source/type不足以赋系统权限。维护/停用后允许必要清理/对账，仍不发布业务附件，ATTACHED历史不因维护/切队/草稿TTL删除。

worker最终发布CONFIRMED及采用对象的CAS事务，须检查上传者user.NORMAL、本队member.ACTIVE/任务授权/club.ACTIVE，并共同写上传者user.securityMutationSeq/member.mutationSeq/club.mutationSeq及资源fence；封禁/停用/维护先提交则迟到worker不能发布，反之属已授权完成。增加这些栅栏后重新计算最坏事务预算。已返回签名无法被数据库栅栏撤回；下载新授权同样重查NORMAL，已有效签名/已下载内容保留已披露期限边界。

GC先事务不可逆抢占本队attachment/attempt=GC_PENDING再精确删该对象；恢复采用与GC写同attempt互斥，fence不能撤销已发storage delete。不按“当前队”前缀批量清桶，不因相同hash删除另一队文件。对账/恢复必须能从预登记path恢复SDK规范fileID；此能力与凭证TTL/权限/10MiB真机传输仍继承基线P0门禁。

## 12. 部署、安全规则、索引与运维

继续三个待创建部署入口：rakApi、rakFiles、rakMaintenance；切队是rakApi固定action，不另造全权数据库代理函数。前端src不出现db实例/collection/doc/aggregate/watch调用。DB集合客户端read/write=false，私有存储拒绝客户端SDK访问，worker客户端invoke=false；按实际环境/SDK验证规则含义。

增补索引逻辑清单（实际可用字段/方向/唯一/查询组合P0验证）：

| 集合/用途 | 逻辑索引/访问策略 |
|---|---|
| membership按本人选队 | userId,createdAt desc,_id desc；获取club最小摘要，不能全库枚举团队 |
| membership按队管理 | clubId,status,createdAt,_id；clubId,role,status,createdAt,_id |
| join.mine | userId,createdAt,_id；审批clubId,status,createdAt,_id |
| tasks/公告/ROI/绩效输入 | 继承基线每条查询，以clubId前缀；assignee改assigneeMemberId |
| invite/join entry解析 | codeHash/sceneTokenHash/keyHash唯一；解析只返回被有意分享的最小目标 |
| uploads/chunks/attempt/jobs | clubId+sessionId/state/expiry，chunk索引含clubId/sessionId/index；后台全局due-job索引仅系统使用 |
| commands | 确定性scope主键；按retainUntil清理，不公开全库结果 |
| audit/stats | clubId+createdAt/id；统计键clubId/period/memberId |

数据库官方当前文档说明服务端事务仅doc、不支持where，列100操作/30秒；实际锁版和环境仍要验证。事务外有范围索引定位，再事务doc重读授权/归属/revision；无存储/网络副作用，最坏3槽提交预算目标≤40操作，若新增club栅栏后超预算必须调整并测，不能偷偷拆掉原子性。

本队费用/容量计数按clubId；全局身份反滥用另算，不能把A满额误报B满额。平台共享套餐不足可能影响所有队，此事实告警需说明。每队管理员不获得环境密钥/云控制台管理权，不看其他队日志/备份/账单详情。

备份/恢复：DB与文件字节分别备份，按本队范围恢复时所有关联集合/owner/member/command/job/附件映射完整；禁止恢复A覆盖B同账号member。跨环境fileID不能字符串替换，受控复制且验证hash。日志只scope+脱敏actor+资源ID+错误码，不记录URL、邀请码、openid、全量联系方式/其他队关系。平台运维另有审计权限，团队owner与运维分开。

## 13. 与现代码结合及实施策略

先实现cloud-v2多团队契约及TenantContext，再落各业务，不先做全套单团队后端。src/services/context.ts改capture/validate接口；store可拆account/team-session/业务Store以使reset可枚举，不能只散加setClubId。保留领域服务门面、Taro/MobX与现UI，不引入无必要框架。

新建team-select/team-join/team-join-status/account入口，新增本队资料设置。app.config现26页，加入页面后从配置重新生成路由验收矩阵，**不再把26当最终固定页数**。现每个管理页useDidShow和详情useEffect先guard再load；bootstrap/enter完成后响应式再加载。

cloud业务引用从userId转memberId：任务筛选/认领、作者、审批、任免、绩效、个人摘要都明确更新类型；不将memberId塞旧userId字段“兼容”。demo与HTTP保持单独adapter，不能假装旧HTTP支持多队。生产只cloud、缺环境失败、无demo角色切换/样例；本地demo若要多队演示使用明确fixtures，不能充当真实授权证据。

空云开通：只创建平台配置、真实账户、受控团队与owner，其他业务空。若P0发现已经有真实单队云数据，则停止空库假设：先备份，制定clubId补齐/成员引用映射/文件路径与command保留的迁移，不覆盖、不自动把无归属数据放当前队；本轮不授权实际迁移。

## 14. 需要用户参与及现实边界

已有AppID `wxa8bf102dcfdcec4c`、环境 `cloud1-d4g36r8z6a8908540`只作为已知配置，未核实远端绑定/模式/套餐/权限；不要求在聊天提供AppSecret/API key。

后续实施人工事项：有权微信扫码/开通配额与确认费用；确认两队名称和各队真实owner；本人取得身份参考号供受控初始化；至少两台设备/多个微信测试账号加入体验名单；确认隐私声明、类目与审核资料；确认备份/告警套餐能力。角色组合可在隔离环境受控调整用于测试，不用真实成员数据做破坏性试验。

首版不做：开放自助建队、全网搜索团队、跨队任务/公告/文件转发和聚合、跨队绩效排行榜、跨队离线队列、实时DB监听、owner自助转移、跨AppID账号合并、订阅提醒/OA业务。退出团队/删除团队新业务若以后需要，另定状态及历史保留，不借切队顺手删除数据。

## 15. 验收矩阵（实施后必须逐项留证）

| ID | 场景 | 明确预期/证据 |
|---|---|---|
| MT01 | 同人A超管/B成员，姓名/职务不同 | “我的”完整切换；B管理直调拒绝；回A恢复A资料 |
| MT02 | A个人资料/角色/绩效改变 | B对应member和统计字节/字段不变，A目录不泄露B关系 |
| MT03 | A被禁用/B有效，A待审/B有效 | 仅A受限，不全局退出B；所有新A签名/写拒绝 |
| MT04 | 0队、1队、多队、同名队、仅待审/停用、列表多页 | 有确定入口及displayCode；无假空/隐式默认错队 |
| MT05 | team.enter失败/双击/快速连续选队/本队维护 | 无旧数据闪现，失败留选择页，旧尝试不能覆盖 |
| MT06 | A慢列表/详情/权限刷新/错误/finally在B返回 | 无回填、toast、跳转、登出B或解除B busy |
| MT07 | A→B→A，再返回最早A响应 | epoch拒绝，不能只比clubId |
| MT08 | A create公告后切B；ROI编辑延迟回填 | 不在B发布/回填/成功提示；A草稿只留A |
| MT09 | A写超时、切B、结果晚到、重启再查 | 原scope/原键恢复；B不重复写，不把ABSENT当失败 |
| MT10 | 选文件/保存回调/PUT/confirm进行中切队 | A session归属固定；B不能绑定A；旧回调无污染；GC精确 |
| MT11 | TEAM A配B task/member/附件/session/游标 | 统一拒绝且无越权写；同人有两队资格也不能混引用 |
| MT12 | A角色伪装B管理者、event伪造openid/role | 真实B membership授权；A超管不继承到B |
| MT13 | B scope查A command，同mutationId两队 | 结果隔离，hash含scope，查询不泄露A |
| MT14 | 同微信两设备分别A/B并发操作 | 目标互不被切换；无服务端global currentClub |
| MT15 | 加入B时已在A、A/B各有申请、邀请码末次并发 | 不被login跳转覆盖；每队申请/额度独立，原A不被自动替换 |
| MT16 | A成员文件给A管理者，B管理者混查/原fileID签名 | 前者可用、后者拒绝；真实TTL≤300秒且过期重鉴权 |
| MT17 | worker A job搭B attempt，GC/恢复采用竞争 | 归属校验拒绝、不误删B及ATTACHED；失去fence不能发布 |
| MT18 | 每队任务/公告/ROI/绩效/搜索/摘要/名册开关 | 明显不同fixture逐项核对无串队；分页不漏授权过滤 |
| MT19 | 清缓存/换机/换微信/换环境，返回旧页/深链 | 同账号云数据恢复；旧账号/旧队缓存不复用；深链先验证目标队 |
| MT20 | 客户端DB get/query/count/write/aggregate/watch与直接存储SDK | 全部拒绝；所有正式数据请求可追到函数 |
| MT21 | 两队受控初始化/重复执行/尝试抢owner | 每队正确唯一owner，重复无副作用，普通用户不能开通或跨队任免 |
| MT22 | 恢复A备份、两队同名/同文件hash、A额度满 | B数据/字节/owner不变；配额按队，平台共享限制另标 |

必须纳入上述ID的补充子用例：MT02含owner本队职务可编辑且B不变；MT06含旧账号GLOBAL列表/申请迟到不进入新账号、同账号GLOBAL加入C在切B后返回不自动切队；MT09/MT15含申请成功丢响应后token过期/轮换仍可查本人最小结果、rotate与首次submit竞争只按事务顺序生效；MT12含平台BLOCKED读写/新凭证拒绝及与关键写竞争；MT19含B开A链接、旧无scope链接、目标/id混配、取消切换与旧intent迟到；MT21含开通成功丢响应/重启恢复、同ID不同输入、同参考号双provisioningId、同人新参考号开第二队。

MT12还必须覆盖VERIFYING中封禁上传者后worker迟到、批准申请与目标账户封禁竞争：封禁事务先完成则不得发布CONFIRMED/新增有效membership，允许受控清理继续，不误删历史ATTACHED。

证据分层：本地类型/契约/属性测试、仓库模拟、真实函数入口+独立只读DB断言、真实存储、双账号/双设备真机。至少3个身份组合便于测试A owner/B member、A member/B manager及不属于目标队；同一物理设备切换账号可补部分用例，但双设备并发/换机不能由单设备模拟冒充。

验收记录含时间、AppID/env、SDK锁版、函数/客户端包hash、脱敏账号与role、fixture映射、请求/预期/实际/证据位置。未执行写NOT_RUN，不凭“能构建”判正式可用。

## 16. 官方依据、待验证门槛与自查

已于2026-10-17通过HTTPS读取腾讯CloudBase官方资料：

- 数据库安全规则：https://docs.cloudbase.net/database/security-rules
- 服务端事务与限制：https://docs.cloudbase.net/database/transaction
- 私有云存储安全规则：https://docs.cloudbase.net/storage/security-rules

技能提供执行边界，平台资料提供机制；两者不证明本项目远端已配置。新方案不引入未经核实的SDK方法；上传协议、凭证范围/期限、recoverByPath、300秒下载、可信定时来源、索引支持继续执行基础设计P0。多团队新增P0检查：真实身份跨队查询拒绝、membership唯一键/索引、TEAM scope贯穿打包边界、club写栅栏热点、所有读/统计/后台测试夹具覆盖。

交付自查：每个业务动作只有一个scope；账户没有全局队伍角色/姓名；owner按队；所有资源与命令有团队归属；本机切换不改另一设备；切换对异步/草稿/上传/未知写/深链有规则；DB仅函数访问，文件默认私有；现实现、待实施与真实验收明确分开。配套计划逐条映射MT01–MT22后方可宣称正式支持多团队。

### 16.1 本轮文档复审记录

2026-10-17分别进行了客户端与服务器只读审查，并在修订后再次复核设计及配套计划。已修正：合法目标任免字段与伪造调用者角色的混淆、GLOBAL账户上下文缺口、业务深链/旧链接范围、成员分页时间字段、申请入口轮换与提交写栅栏、开通幂等记录/参考号消费、全局封禁与worker/目标账户栅栏、owner职务编辑路径、过期token的既有命令结果恢复。复核在所审范围未发现剩余P0/P1实质问题；这是文档检查结论，不是代码或安全认证。

交付检查包括本地文档链接、代码围栏配对、MT01–MT22任务映射、拟新增与现存路径/命令区分、旧文档优先级入口、仅文档改动及暂存区保留。未运行应用测试/构建，未访问真实业务数据库或存储，未部署函数，也没有宣称本计划的88个实施步骤已完成。
