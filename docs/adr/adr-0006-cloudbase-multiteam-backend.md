# ADR-0006：CloudBase 多团队云后端 —— 唯一业务真源，无双写

- **日期**：2026-10-17 · **状态**：✅ 采纳（用户裁定：云端正式使用 + 多团队切换）
- **背景**：
  1. 旧 `CONSTRUCTION.md` §2/§3 规定「API 唯一后端 = rak-auth（PG/JWT）」；该后端未交付、无运行实例，无法支撑本小程序正式使用。
  2. 用户 2026-10-16 确认：业务数据放云数据库、文件放私有云存储，**小程序不得直连数据库**，须经云函数访问；云端从空业务数据起步。
  3. 用户 2026-10-17 进一步确认：同一微信可属多团队，按 clubId 逻辑隔离，各队有独立 owner；由有平台管理权限者受控创建团队。
  4. DESIGN 明确禁止方案 C（云数据库与旧后端双写/失败回退 demo）。
- **决策**：
  1. **采用 CloudBase 云函数 + 文档数据库 + 私有云存储**作为唯一业务真源，替代旧 rak-auth/PG 主业务路线。旧提案（`docs/proposals/rak-auth-*.md`）保留为历史资料，标记「非当前实施路线」，不双写。
  2. 三个部署函数：`rakApi`（会话/入会/任务/公告/成员/ROI/绩效/邀请/命令）、`rakFiles`（上传会话/授权/确认/下载）、`rakMaintenance`（有租约的后台，**客户端禁止 invoke**）。
  3. 协议基线为 **apiVersion=2**，`scope ∈ {GLOBAL, TEAM}`；TEAM 必须显式 `clubId` 且该字段**不授予**权限。所有集合客户端读写一律拒绝，服务端 SDK 高权限下每个处理器自行鉴权。
  4. 全局账户（`rak_users`）无团队角色/姓名/职务；成员资料/角色/状态归属 `rak_members`；业务参与者一律用 memberId 引用。
  5. 唯一归属字段名 `clubId`（产品文案叫「团队」）；不引入 teamId/companyId/tenantId 多套可变归属。
  6. 构建引入 `TARO_APP_BACKEND=demo|cloud|http`（见 M2）；生产必须显式 cloud + 环境，缺 env 或混入 demo 失败。`project.config.json` 恢复 `cloudfunctionRoot: "cloudfunctions/"`。
  7. 文件字节经云函数授权的 exact-key 受限 PUT（首选）或受控分块函数（备选），**不得**公开桶或客户端任意 `wx.cloud.uploadFile`。传输门禁由 P0/M0 裁决（见 `docs/verification/cloudbase-capabilities-2026-10-17.md`）。
- **后果**：
  - 客户端不得出现 DB SDK 实例/collection/doc/aggregate/watch（由 `verify:no-client-db` 静态门禁约束）。
  - 事务仅 doc 操作、无 where、无网络/存储副作用；关键写含命令记录与授权写栅栏。
  - 旧 HTTP `API_BASE` 路线降级为 legacy/test 选项，不再作为发布入口；生产构建不依赖不存在的 rak-auth 地址。
  - 真实云端/真机验收（M8/M9）与部署分离，`test:cloud:integration` 需真实身份，缺配置明确非零退出。
- **取代/引用**：
  - 取代：`CONSTRUCTION.md` 中「rak-auth 唯一业务后端 / PG auth schema / JWT 登录 / COS/Flyway」对应约束。
  - 保留：产品规则、角色层级（改多队化）、单 AppID、现有 UI/视觉。
  - 配套：`docs/superpowers/specs/2026-10-17-rak-multi-team-isolation-design.md`、`docs/superpowers/plans/2026-10-17-rak-multi-team-isolation-plan.md`、`docs/api/cloud-v2.md`。
