# 云-v2 动作矩阵（action-matrix）

日期：2026-10-17。依据：多团队 DESIGN §6.2/§9；BASE-DESIGN §8.2。协议见 [cloud-v2.md](../api/cloud-v2.md)。

说明：M1 只固化契约与注册表；下表"角色/资源关系/事务"为**待实现**的验收口径，不代表已实现。
业务动作当前在代码中返回 `not_implemented`（发布门禁禁止所需动作保留该状态）。测试ID 对应 DESIGN §15 MT 矩阵与 BASE §14。

统一：所有写操作均含命令记录（幂等）+ 审计；关键写含授权写栅栏（actor member/user/club 的 mutationSeq）。异队/不存在统一 `resource_not_found`。

## A. 身份 / 开通（GLOBAL，fn=api）

| action | 主要输入 | 授权 | 事务/幂等 | 主要错误 | 测试ID |
|---|---|---|---|---|---|
| `auth.bootstrap` | 空 | 可信微信身份（getWXContext） | 事务 get-or-create identity/user | identity_required/app_mismatch/environment_mismatch | MT12/MT20 |
| `auth.me` | 空 | 可信身份 | 只读本人 accountKey/状态 | 同上 | MT12 |
| `account.provisioningReference` | `{replaceConsumed?}` | 本人 | 参考号 30min hash/唯一、未消费复用 | identity_required/validation_failed | MT21 |

## B. 团队（api）

| action | scope | 主要输入 | 授权 | 资源关系/事务 | 主要错误 | 测试ID |
|---|---|---|---|---|---|---|
| `team.listMine` | GLOBAL | `cursor/pageSize` | 本人账户 | 按本人 membership.createdAt/id 分页 | validation_failed | MT04 |
| `team.enter` | TEAM | 空 | 该队 ACTIVE 成员 | 实时返回 TeamSession，不写 server currentClub | membership_required/disabled/maintenance | MT01/MT03/MT05 |
| `team.resolveJoinTarget` | GLOBAL | `joinKey` | 本人账户 | 解签→最小队名/displayCode + 短效 token | resource_not_found | MT15 |
| `team.joinLink.rotate` | TEAM | `expectedRevision` | manager+ | 事务写 join_entry_states + club 栅栏 | revision_conflict | MT15 |

## C. 入会 / 邀请（api）

| action | scope | 主要输入 | 授权 | 事务/幂等 | 主要错误 | 测试ID |
|---|---|---|---|---|---|---|
| `join.mine` | GLOBAL | `cursor` | 本人 | 本人申请独立分页 | validation_failed | MT04/MT15 |
| `join.status` | GLOBAL | `joinRequestId` | 本人 | 只读本人申请 | resource_not_found | MT15 |
| `join.submit` | GLOBAL | `joinTargetToken,name,wechat,reason` | 可信 NORMAL 账户 | 事务写 join_entry_states 栅栏；同键恢复本人最小结果 | validation_failed/rate_limited | MT15/MT09 |
| `invite.redeem` | GLOBAL | `{code\|sceneToken}` + `displayName` | 可信 NORMAL 账户 | 原子扣额+建/member+申请收敛 | invite_* /membership_disabled/left | MT15/MT01 |

## D. 命令结果（api，EITHER）

| action | scope | 主要输入 | 授权 | 说明 | 主要错误 | 测试ID |
|---|---|---|---|---|---|---|
| `command.status` | 与原命令相同 | `action,mutationId` | 本人 + 当前重新鉴权 | 返回 SUCCEEDED/DETERMINISTIC_REJECTED/ACCEPTED_JOB/ABSENT_IN_WINDOW/EXPIRED | cursor 无关；scope_mismatch | MT09/MT13 |

## E. 成员 / 资料 / 审核（TEAM，api）

| action | 主要输入 | 授权 | 资源关系 | 主要错误 | 测试ID |
|---|---|---|---|---|---|
| `member.updateMyProfile` | `displayName,expectedRevision`；owner 本人额外 `duty` | 本队本人 | 仅改本队本人 membership | revision_conflict | MT01/MT02 |
| `member.updateProfile` | `targetMemberId,duty?,displayName?,expectedRevision` | manager 仅 member；owner 可 manager/member | 不改 owner；不复制敏感资料 | permission_denied | MT01 |
| `member.list` | `cursor/filter` | ACTIVE 成员（名册开关） | 脱敏 DTO；关闭仍可给在册总数 | permission_denied | MT18/MT04 |
| `member.setRole` | `targetMemberId,targetRole:'member'\|'manager',expectedRevision` | **仅 owner** | 不能改 owner / 不能授 super | permission_denied/revision_conflict | MT01/MT12 |
| `member.setStatus` | `targetMemberId,targetStatus:'ACTIVE'\|'DISABLED',expectedRevision` | manager 仅 member；owner 可 manager/member | 不能处置 owner；LEFT 恢复仅受控运维 | permission_denied/revision_conflict | MT03/MT12 |
| `join.list` | `cursor,status?` | manager+ | 本队申请分页 | permission_denied | MT18 |
| `join.approve` | `joinRequestId,expectedRevision` | manager+ | 收敛 PENDING→APPROVED；不覆盖已 ACTIVE | revision_conflict | MT15/MT12 |
| `join.reject` | `joinRequestId,expectedRevision,rejectReason` | manager+ | 只改申请状态 | validation_failed | MT15 |
| `invite.list` | `cursor` | manager+ | 仅 maskedCode | permission_denied | MT18 |
| `invite.create` | `maxUses?,expiresInDays?` | manager+ | 当次显示明文；通用命令只恢复 id/masked | validation_failed | MT15 |
| `invite.revoke` | `inviteId` | manager+ | 撤销后不可兑换 | resource_not_found | MT15 |
| `invite.qr` | `inviteId` | manager+ | 高熵 sceneToken；能力不足降级文本码 | storage/code 能力相关 | MT15 |

## F. 社团 / 摘要（TEAM，api）

| action | 主要输入 | 授权 | 说明 | 测试ID |
|---|---|---|---|---|
| `club.get` | 空 | ACTIVE 成员 | 本队最小信息 | MT01 |
| `club.update` | `name?,description?,settings?`（白名单） | manager+ | 拒任意 settings/logoUrl | MT18 |
| `club.dashboard` | 空 | ACTIVE；manager+ 才返回待验收/榜单 | 计数投影，不伪造 total | MT18 |
| `profile.summary` | 空 | 本队本人 | 本人任务/绩效摘要 + asOf | MT18 |

## G. 任务 / 交付（TEAM，api）

| action | 主要输入 | 授权 | 事务/幂等 | 主要错误 | 测试ID |
|---|---|---|---|---|---|
| `task.list` | `cursor,status[],category,keyword,assigneeMemberId?` | ACTIVE 成员 | clubId 前缀稳定游标 | cursor_scope_mismatch | MT18/L01 |
| `task.get` | `taskId` | ACTIVE 成员 | 公共 DTO 不含他人交付/附件/私密备注 | resource_not_found | MT11 |
| `task.create` | `title,description,category,repo?,acceptanceCriteria?` | manager+ | 服务端写 authorMemberId | permission_denied | MT18 |
| `task.update` | `taskId,字段,expectedRevision` | manager+ | 仅 OPEN | invalid_transition | MT18 |
| `task.claim` | `taskId,expectedRevision` | ACTIVE 成员 | 双人竞争恰一成功 | task_not_claimable | MT08/T01 |
| `task.submit` | `taskId,note,attachmentIds[0..3],expectedRevision,targetRound` | 当前负责人 | 创建独立 round/submission；批次收敛；命令+审计 | revision_conflict/attachment_* | MT08/MT09/MT10/T02 |
| `task.approve` | `taskId,submissionId,grade,note?,expectedRevision` | manager+ | 只当前待验收轮次 | invalid_transition/revision_conflict | MT08 |
| `task.reject` | `taskId,submissionId,reason,expectedRevision` | manager+ | 驳回原因必填 | validation_failed | MT08 |
| `task.archive` | `taskId,expectedRevision` | manager+ | 仅 APPROVED→DONE；保留交付与附件 | invalid_transition | MT08 |
| `submission.list` | `taskId,cursor` | 负责人/manager+ | 历史不覆盖 | permission_denied | MT11/T03 |
| `submission.get` | `submissionId` | 负责人/manager+ | 独立轮次 | resource_not_found | T03 |

## H. 公告 / ROI / 绩效（TEAM，api）

| action | 主要输入 | 授权 | 说明/错误 | 测试ID |
|---|---|---|---|---|
| `announcement.list` | `cursor`（pinned/createdAt/id 复合游标） | 普通成员只 PUBLIC；manager+ 含草稿 | 草稿只本队管理可见 | MT18/N01 |
| `announcement.get` | `announcementId` | 同上 | 草稿越权拒绝 | N01 |
| `announcement.create/update/publish/archive` | 白名单字段 + `expectedRevision` | manager+（含 owner） | 服务端写 author；归档后可不可编辑 | MT18 |
| `roi.list` | `cursor,status?,category?,keyword?` | ACTIVE 成员 | 本队分/日期；软删 | MT18/R01/R02 |
| `roi.get` | `roiId` | ACTIVE 成员 | — | R01 |
| `roi.create/update/delete` | 元字符串金额、日期、period、`expectedRevision` | manager+ | 严格转分；软删留审计 | validation_failed/R01 |
| `roi.overview` | `period` | ACTIVE 成员 | 服务端聚合，cost0→null 比例 | R01/R02 |
| `performance.mine` | 空 | 本人 | 从本队计算，不接收全局 userId | MT18 |
| `performance.list` | `cursor`（score desc/memberId asc） | manager+ | 超扫描预算→stats_unavailable | MT18 |

## I. 私有文件（TEAM，files）

| action | 主要输入 | 授权 | 事务/幂等 | 主要错误 | 测试ID |
|---|---|---|---|---|---|
| `file.init` | `taskId,expectedTaskRevision,name,declaredSize` | 当前负责人 | 预占固定3槽；仅递增 batch.revision | revision_conflict/upload_expired | MT10/F01 |
| `file.status` | `sessionId` | 上传者/manager+ | 只读状态，**不签 URL** | resource_not_found | MT10 |
| `file.confirm` | `sessionId` | 上传者 | 冻结后校验；可返回处理中 | attachment_not_ready | F04/F05 |
| `file.cancel` | `sessionId` | 上传者 | 释放槽/fence++；VERIFYING 亦可 | upload_cancelled | F04 |
| `file.downloadUrls` | `attachmentIds[≤3]` | 负责人/manager+ 且 ATTACHED | 逐项结果保序；TTL≤300s | attachment_forbidden | MT16/F02/F06 |
| `file.previewDraft` | `attachmentId` | 仅本人有效 CONFIRMED/DRAFT | 草稿预览 | attachment_forbidden | MT16 |
| `file.putChunk` | `sessionId,index,base64,chunkHashHint` | 上传者 | 同片幂等；片不可变（仅分块 transport） | validation_failed | F07/U4 |

## J. 未纳入客户端的动作

- `rakMaintenance`：无客户端 action；平台定时/受控后台来源，客户端 invoke 拒绝（`infra/cloudbase/function-rules.json`）。
- 受控开通：`scripts/bootstrap-cloud-platform.mjs` / `provision-cloud-team.mjs`（M3 创建，仅环境管理权限者运行）。

## K. BG 基线验收叠加

BASE-DESIGN §14 的 A01–A06/T01–T04/F01–F07/P01/P02/N01/R01/R02/L01/I01/I02/B01/O01/D01 在实施时按同队 fixture 叠加执行；MT 通过不免除任务/附件/财务原规则。
