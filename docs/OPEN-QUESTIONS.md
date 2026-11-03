# rak-control 开放问题清单

> ⬜ 待确认 · ✅ 已确认 · ⏭ 跳过/后补 · 🟨 进行中
>
> **2026-10-17 更新（见 [ADR-0006](./adr/adr-0006-cloudbase-multiteam-backend.md) 与
> [多团队设计](./superpowers/specs/2026-10-17-rak-multi-team-isolation-design.md)）**：
> 下列旧结论已被覆盖，保留仅作历史——A1「单社团」→ **多团队（按 clubId 隔离，各队独立 owner）**；
> C4「rak-auth 微信契约」→ **已被 CloudBase 云函数路线取代，不做双写**；C10「初始 super_admin 播种」→
> **改为平台受控开通 + 每队 owner**。新增人工事项见多团队计划 §7。

## A. 产品与信息架构

| # | 问题 | 结论 | 状态 |
|---|---|---|---|
| A1 | 单社团还是多社团？ | **单社团**，无切换器 | ✅ |
| A2 | 管理员如何产生？ | **super_admin = 仅你**；你指定 **manager**；member **不见**管理入口；超级后台仅你可见 | ✅ |
| A3 | ROI 统计对象？ | 项目/活动，财务型 | ✅ |
| A4 | ROI 指标？ | cost / revenue / ROI% / participants / period / status | ✅ |
| A5 | 谁录入 ROI？ | manager + super_admin | ✅ |
| A6 | 入驻方式？ | **邀请码 + 扫码**（同一 bind） | ✅ |
| A7 | MVP 范围？ | **较完整**：公告/成员/ROI/邀请/角色/主题；活动审批等延后 | ✅ |
| A8 | 品牌名？ | **Rak** | ✅ |
| A9 | 其他未列产品项 | **按最佳实践由实现侧定稿**（已写入 CONSTRUCTION 字段表） | ✅ |

## B. 设计与体验

| # | 问题 | 结论 | 状态 |
|---|---|---|---|
| B1 | 默认主题？ | light 默认，dark 完整维护 | ⬜（默认已写入 DESIGN，可改） |
| B2 | 组件库？ | **Taroify** | ✅ |
| B3 | 状态库？ | **mobx** | ✅ |
| B4 | 自定义导航栏？ | 自定义 + 胶囊避让（最佳实践） | ✅（按最佳实践） |
| B5 | TabBar？ | 首页 · 社团 · ROI · 我的 | ✅（按最佳实践） |

## C. 工程与接入

| # | 问题 | 结论 | 状态 |
|---|---|---|---|
| C1 | 微信 AppID？ | **先跳过**，联调前再填 | ⏭ |
| C2 | rak-auth API Base URL？ | dev `localhost:8080`；生产待提供 | ⬜ |
| C3 | 合法域名配置？ | 随 AppID 一起 | ⏭ |
| C4 | rak-auth 微信契约？ | **尽早**；提案已写：`docs/proposals/rak-auth-wechat-auth-contract.md` | 🟨 |
| C5 | React 18 vs 19？ | 按脚手架 18 | ✅ |
| C6 | CI？ | 先本地 `pnpm build:weapp` 门禁 | ✅（按最佳实践） |
| C7 | 审核类目/隐私？ | 默认教育/工具；隐私由 Rak 草拟 | ⬜（上线前） |
| C8 | worktree？ | 继续主 worktree | ✅ |
| C9 | manager 能否发邀请码？ | 默认 **可以** | ✅（默认） |
| C10 | 初始 super_admin 账号？ | 播种你的 userId/openid | ⬜ |
| C11 | 任务交付附件后端契约？ | 本机演示已支持最新交付附件；真实共享及历史尚未实现，需 rak-auth 按 [任务附件契约](./proposals/rak-auth-task-attachments-contract.md) 实现，步骤见 [任务附件实施教程](./TASK-ATTACHMENTS-GUIDE.md) | 🟨 |

## D. 数据字段

| 实体 | 状态 |
|---|---|
| Club / Member / Announcement / RoiItem / RoiOverview / Invite | ✅ 已按最佳实践写入 [CONSTRUCTION.md §7](./CONSTRUCTION.md) |

---

## 已裁决摘要（2026-09-18）

| 项 | 结论 |
|---|---|
| 品牌 | Rak |
| 入驻 | 邀请码 + 扫码 |
| 角色 | super_admin（你）→ manager（你指定）→ member |
| 管理入口 | member 全隐藏；manager 见运营面板不见超级后台；超级后台仅你 |
| ROI | 财务型，MVP 较完整 |
| UI / 状态 | Taroify + mobx |
| AppID | 先跳过 |
| rak-auth 契约 | 尽早，提案已备 |

## 下一步

1. **rak-auth**：按提案落仓级 ADR + 表结构 + 端点 + `docs/API.md`（阻塞 M2）  
2. **rak-control M1**：tokens + Taroify 换肤 + mobx + request + TabBar + 角色守卫 + 登录/绑定 UI（可 mock API）  
3. 你提供：初始 super_admin 播种身份、（联调时）AppID 与 API 域名
