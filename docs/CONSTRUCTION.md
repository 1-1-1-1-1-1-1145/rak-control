# rak-control 建设方案（CONSTRUCTION.md）

> 本文档是 rak-control（微信小程序）的**工程与建设真源**：定位约束、目标架构、
> 认证链路、权限模型、信息架构、字段表、里程碑。
> 视觉与交互契约见 [DESIGN.md](./DESIGN.md)；跨仓库裁决见生态宪法
> [ECOSYSTEM.md](../ECOSYSTEM.md) 与 [ECO-ADR-0014](../../docs/adr/adr-0014-rak-control-miniprogram.md)。
>
> **状态**：规划已收敛核心产品裁决（2026-09-18）。AppID / API 域名等接入项可后补，
> 不阻塞脚手架与 UI。rak-auth 契约提案见
> [docs/proposals/rak-auth-wechat-auth-contract.md](./proposals/rak-auth-wechat-auth-contract.md)。
>
> **2026-10-17 更新（当前实施路线）**：下方 §2/§3 的「rak-auth 唯一后端 / PG auth schema / JWT 登录 / COS/Flyway」
> 已被 [ADR-0006](./adr/adr-0006-cloudbase-multiteam-backend.md) 取代——正式业务真源改为
> **CloudBase 云函数 + 文档数据库 + 私有云存储**，并支持**同一微信多团队**（按 clubId 逻辑隔离，各队独立 owner）。
> 协议见 [cloud-v2.md](./api/cloud-v2.md)。执行主入口为
> [多团队实施计划](./superpowers/plans/2026-10-17-rak-multi-team-isolation-plan.md) 与
> [多团队设计](./superpowers/specs/2026-10-17-rak-multi-team-isolation-design.md)。
> 旧 rak-auth 提案保留为**历史资料（非当前实施路线）**，**不做双写**；§2/§3 旧约束仅作历史记录。

---

## 1. 产品定位（已锁定）

| 项 | 结论 | 依据 |
|---|---|---|
| 对外名称 | **Rak** | 用户裁决 2026-09-18 |
| 形态 | 微信小程序（仅 weapp） | ECO-ADR-0014 |
| 用户 | 社团成员、管理层、超级管理员 | 用户裁决 |
| 场景 | 学校社团内部应用 + 团队 ROI 管理 | ECO-ADR-0014 |
| 框架 | Taro 4.2.1 + React 18 + TypeScript + Sass + Webpack5 + pnpm | 脚手架现状 + §4 白名单 |
| 身份 | 接 rak-auth，禁止自研 session | §4 硬约束 |
| 数据 | 社团/ROI 挂 rak-auth，落 PG `auth` schema | ECO-ADR-0014 |
| UI | Xra-space token 桥接；Linear/Vercel/Supabase/shadcn | ECO-ADR-0007 |
| 组件 | **Taroify** + token 换肤 | ADR-0002 ✅ |
| 状态 | **mobx** + 统一 request | ADR-0005 ✅ |
| 社团模型 | **单社团**（无切换器） | 用户裁决 |
| 入驻 | **邀请码 + 扫码**（服务端同一 bind） | 用户裁决 |
| ROI | **项目/活动财务型**，MVP 做完整 | 用户裁决 |
| 管理可见性 | 分层隐藏，member **不见**管理入口 | 用户裁决 |

**不是**：通用 IM、完整 OA、多租户 SaaS 控制台、第二套身份后台。

---

## 2. 生态硬约束（违反即返工）

1. **禁止**新建服务 / 新增端口；API 唯一后端 = rak-auth（dev `:8080`）。
2. **禁止**自研登录/session；openid 绑定必须先改 `rak-auth/docs/API.md`（提案已备）。
3. **禁止**Tailwind/shadcn/radix 进 weapp；token 桥接见 DESIGN.md + ADR-0001。
4. **禁止**业务数据落小程序本地当权威源；本地只做缓存与草稿。
5. **禁止**只靠前端隐藏管理页——服务端必须按 `club_role` 鉴权。
6. Git：`main` 开发 / `rak-stable`；GitHub = 提交真源（ECO-ADR-0009）。
7. 包管理器 **pnpm**；`pnpm-workspace.yaml` 的 `allowBuilds` 勿删。
8. React 增量按脚手架 **18**（注册表写 19 的差异不阻塞本仓）。
9. AppID/域名后补：`project.config.json` 可暂用占位，真机联调前再填。

---

## 3. 权限模型（已裁决）

```
super_admin（仅产品所有者，初始 1 人）
    │ 任免 / 撤销
    ▼
manager（管理层，super_admin 指定）
    │ 无任免权
    ▼
member（邀请码/扫码入驻，默认角色）
```

| 能力 | super_admin | manager | member |
|---|---|---|---|
| 看公告 / ROI 概览 / 个人资料 | ✓ | ✓ | ✓ |
| 成员目录（只读） | ✓ | ✓ | ✓（若社团开启） |
| 公告发布/编辑/删除 | ✓ | ✓ | ✗（入口不出现） |
| ROI 录入/调整/关闭 | ✓ | ✓ | ✗ |
| 邀请码生成/作废 | ✓ | ✓（默认允许） | ✗ |
| 成员角色任免 manager/member | ✓ | ✗ | ✗ |
| 社团基础设置（名称/简介） | ✓ | ✓（可配） | ✗ |
| **超级后台**（任免、全量运营视图） | ✓ | **✗ 不可见** | **✗ 不可见** |
| 管理面板（公告/ROI/邀请等） | ✓ | ✓ | **✗ 不可见** |

**入口策略**
- member：TabBar 与页面路由均无「管理」；深链管理页 → 拦截回首页 + toast。
- manager：「我的」或社团页显示管理入口 → 进 **subpackage-admin** 运营功能；不渲染任免/超级区块。
- super_admin：额外可见超级后台（可与管理分包同包、路由与菜单隔离）。
- 权限源：`GET .../me` → `clubRole` + `permissions`；JWT 仅作会话，业务以服务端 403 为准。

---

## 4. 信息架构（已收敛）

```
rak-control（主包）— 品牌名 Rak
├── pages/index                 # 首页：ROI 财务摘要 + 最新公告 + 快捷入口
├── pages/auth/login            # 登录：静默 wx.login；未绑定 → 邀请码/扫码
├── pages/auth/bind             # 绑定：输码 / 扫码回填 / 展示名（可与 login 合并）
│
├── pages/club
│   ├── home                    # 社团主页（简介、统计、公告摘要）
│   ├── announcement/list       # 公告列表
│   ├── announcement/detail     # 公告详情
│   └── members                 # 成员目录（角色徽章；无管理操作）
│
├── pages/roi
│   ├── overview                # 概览：成本/收益/ROI%/周期对比
│   ├── list                    # 项目/活动列表（筛选、状态）
│   └── detail                  # 单项明细与构成
│
└── pages/me
    ├── profile                 # 资料（displayName 等）
    ├── invite                  # 我的邀请（member 可只读自己的码说明；管理见生成入口）
    └── settings                # 主题、关于 Rak、登出

subpackage-admin（仅 manager / super_admin 加载入口）
├── pages/admin/home            # 管理面板首页（按角色渲染区块）
├── pages/admin/announcements   # 公告 CRUD
├── pages/admin/members         # 成员管理
├── pages/admin/roi-edit        # ROI 录入/编辑
├── pages/admin/invites         # 邀请码生成/列表/作废 + 小程序码
└── pages/admin/club-settings   # 社团设置

subpackage-super（仅 super_admin；或并入 admin 用路由守卫）
└── pages/super/roles           # 管理层任免；超级视图
```

**导航**
- TabBar：**首页 · 社团 · ROI · 我的**
- 管理/超级：不进 TabBar；按角色入口跳转分包
- 登录后冷启动：`me` → 刷新 `authStore`/`clubStore` → 再渲染角色相关入口

---

## 5. 入驻流程

```
用户打开 Rak
  → Taro.login → rak-auth login
  → bound?
       │ no
       ├─ 有 invite query（扫码）→ bind(code, inviteCode)
       ├─ 手输邀请码 → bind(code, inviteCode)
       └─ 无码 → 展示「需要邀请」+ 说明，不提供开放注册
       │ yes
       ▼
     进首页（clubRole 决定入口）
```

- 扫码路径：`/pages/auth/login?invite=CODE`
- 邀请码：大写字母数字，建议 7 位；服务端唯一、可过期、可限次、可作废
- 初始 super_admin：由 rak-auth 运维播种（提案 §9），**不在**小程序注册流里「自封超管」

---

## 6. 技术架构

```
┌─────────────────────────────────────────────┐
│           微信小程序 Rak（rak-control）         │
│  Taro 4.2.1 · React 18 · TS · Sass · weapp   │
├─────────────────────────────────────────────┤
│ pages · subpackage-admin/super · components  │
│ services · store(mobx) · utils/request       │
├───────────────────┬─────────────────────────┤
│ tokens.scss       │ taroify-overrides.scss  │
│ CSS 变量 + RPX    │ Taroify 行为 + token 皮  │
├───────────────────┴─────────────────────────┤
│ request：Bearer JWT · RFC7807 code · 401 续登 │
└─────────────────────┬───────────────────────┘
                      │ HTTPS
                      ▼
              rak-auth :8080（唯一后端）
```

### 6.1 分层

| 目录 | 职责 | 禁止 |
|---|---|---|
| `src/pages/` | 页面装配、路由参数 | 裸 `Taro.request` |
| `src/components/` | Taroify 包装 + 业务组合件 | 直接 fetch |
| `src/services/` | API 与 DTO | UI 逻辑 |
| `src/store/` | auth / club / ui 全局态 | 服务端数据当第二真源 |
| `src/utils/` | request、token、permission、format | 散落 API path |
| `src/styles/` | tokens、taroify 覆盖、主题 | 页面级复杂样式 |
| `src/constants/` | 路由、角色、存储键 | — |

### 6.2 状态与请求（ADR-0005）

- `authStore`：accessToken、user、clubRole、permissions、login/logout/refreshMe
- `clubStore`：当前社团元数据（单社团）
- `request.ts`：唯一 HTTP 出口；`Authorization`；解包 ProblemDetail `{code}`；401/403 → 静默重登或回登录页
- 环境：`TARO_APP_API_BASE`、`TARO_APP_ID`（后补）

### 6.3 认证（对齐提案）

1. `Taro.login` → `code`
2. `POST /api/ui/wechat/miniprogram/login`
3. 未绑定 → bind（inviteCode）
4. 成功 → 存 token + `GET me` 刷新角色
5. 过期 → 重新 login 静默续期
6. 登出 → `POST /auth/logout`（尽力）+ 清本地

### 6.4 入口守卫

```ts
// utils/permission.ts
// canManage(role) => role === 'manager' || role === 'super_admin'
// isSuper(role)   => role === 'super_admin'
// 页面 onLoad：无权限 → Taro.redirectTo(index) + toast
```

---

## 7. 数据字段表（最佳实践定稿）

> 真源在 rak-auth DB；此表供前后端对齐。时间 UTC ISO-8601。

### Club

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | |
| slug | string | 唯一 |
| name | string | 社团名 |
| logoUrl | string? | |
| description | string? | |
| settings | object? | 如 `memberDirectoryVisible` |
| createdAt / updatedAt | string | |

### Member / me

| 字段 | 类型 | 说明 |
|---|---|---|
| userId | uuid | rak-auth users.id |
| displayName | string | 社团展示名优先 |
| avatarUrl | string? | 微信头像若获取失败则空 |
| clubRole | `super_admin` \| `manager` \| `member` | |
| status | `ACTIVE` \| `LEFT` \| `DISABLED` | |
| joinedAt | string | |

### Announcement

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | |
| title | string | ≤ 60 字 |
| body | string | 富文本或纯文本（MVP 纯文本 + 换行） |
| pinned | boolean | |
| publishedAt | string? | |
| authorId | uuid | |
| status | `DRAFT` \| `PUBLISHED` \| `ARCHIVED` | |

### RoiItem（项目/活动）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | |
| title | string | 项目/活动名 |
| category | string? | `activity` \| `project` \| `other` |
| cost | number | 成本（分或元，统一元、两位小数） |
| revenue | number | 收益/可计量产出折算 |
| participants | int | 参与人数 |
| periodStart / periodEnd | string? | |
| status | `PLANNING` \| `ACTIVE` \| `DONE` \| `CANCELLED` | |
| notes | string? | |
| roiRatio | number? | 服务端计算 `(revenue-cost)/cost`，cost=0 时 null |
| createdBy / updatedAt | | |

### RoiOverview（聚合）

| 字段 | 类型 |
|---|---|
| period | `month` \| `quarter` \| `year` \| `all` |
| totalCost / totalRevenue | number |
| net | number |
| roiRatio | number? |
| itemCount | int |
| series? | `{ label, cost, revenue }[]` 趋势 |

### Invite

| 字段 | 类型 | 说明 |
|---|---|---|
| code | string | 展示给成员 |
| maxUses / usedCount | int | |
| expiresAt | string? | |
| revokedAt | string? | |
| qrPath | string | 小程序码路径 |

---

## 8. 目录结构（目标）

```
rak-control/
├── docs/
│   ├── DESIGN.md
│   ├── CONSTRUCTION.md
│   ├── OPEN-QUESTIONS.md
│   ├── proposals/rak-auth-wechat-auth-contract.md
│   └── adr/
├── src/
│   ├── app.ts / app.config.ts / app.scss
│   ├── styles/
│   │   ├── tokens.scss
│   │   └── theme/
│   │       └── taroify-overrides.scss
│   ├── pages/…
│   ├── subpackage-admin/…
│   ├── subpackage-super/…          # 或并入 admin
│   ├── components/{atoms,business}/
│   ├── services/{auth,club,announcement,roi,invite}.ts
│   ├── store/{auth,club,ui}.ts
│   ├── utils/{request,token,permission,format}.ts
│   ├── constants/
│   └── assets/
├── config/
├── types/
├── .env.development | .env.test | .env.production
├── project.config.json
├── package.json
└── pnpm-workspace.yaml
```

---

## 9. MVP 范围（较完整）

**必须有（首版可验收）**
- 微信登录 + 邀请码/扫码绑定（对接 rak-auth 后）
- 首页 ROI 摘要 + 公告
- 公告列表/详情
- 成员目录
- ROI 概览/列表/详情 + 管理端录入编辑
- 邀请码管理（manager+）
- 角色入口隐藏与深链拦截
- 个人资料、主题 light/dark、登出
- super_admin 任免 manager

**明确延后**
- 活动报名/审批流（可先用 ROI `category=activity` 表达活动成本）
- 即时通讯、文件库
- 多社团切换
- 微信手机号/头像授权增强
- 正式审核类目材料（默认类目：**教育 > 教育信息服务** 或 **工具 > 效率**，上线前再定）

---

## 10. 微信小程序工程实践

1. 主包 ≤ 1.5MB；admin/super 分包；`preloadRule` 在进 ROI/社团时预载 admin。
2. 长列表分页；下拉刷新 + 触底加载。
3. 点击热区 ≥ 88rpx；底部 safe-area。
4. 实时日志只记 `code`/路由，不记 token。
5. 生产 `request 合法域名` = rak-auth HTTPS 域名（待 C2）。
6. 隐私：若仅用 openid 登录、不强制头像昵称，按最小化收集准备说明。

---

## 11. 构建与质量

```bash
pnpm install
pnpm dev:weapp
pnpm build:weapp
```

| 门禁 | 要求 |
|---|---|
| ESLint / Stylelint | 0 error；禁组件内硬编码色 |
| TypeScript | services/store 无 any 扩散 |
| 提交 | commitlint conventional，描述中文 |
| 分支 | main / rak-stable |
| PR | 至少 `pnpm build:weapp` 通过 |

---

## 12. 里程碑

| 阶段 | 内容 | 退出标准 |
|---|---|---|
| **M0 文档** ✅ | DESIGN/CONSTRUCTION/ADR/契约提案 | 产品核心裁决已回写 |
| **M1 脚手架** ✅ | tokens + Taroify 换肤 + mobx + request + TabBar + 角色守卫 + 登录/绑定 UI + 主包/管理分包页面骨架 | `pnpm build:weapp` 通过；Mock 角色可切换；member 无管理入口；light/dark 可切换 |
| **M2 认证** | rak-auth 契约实现后接真 API | 真机邀请码/扫码入驻 + JWT 调业务 API |
| **M3 社团+公告+成员** | 列表/详情/管理 CRUD | member/manager/super 三态验收通过 |
| **M4 ROI 完整** | 概览/列表/详情/录入/编辑 | 财务字段与聚合正确 |
| **M5 超级后台+上线** | 任免、邀请码、隐私声明、体验版/审核 | 可发布 |

并行：**rak-auth 侧按提案尽早实现**（阻塞 M2）。

---

## 13. 仓库级 ADR 索引

| ADR | 主题 | 状态 |
|---|---|---|
| [0001](./adr/adr-0001-design-token-bridge.md) | token 桥接 | 草案（技术结论，可随 M1 验收转采纳） |
| [0002](./adr/adr-0002-ui-component-strategy.md) | Taroify + token 换肤 | ✅ 采纳 |
| [0003](./adr/adr-0003-weapp-motion-strategy.md) | weapp 动效（GSAP 例外） | 草案（技术结论） |
| [0004](./adr/adr-0004-wechat-auth-client.md) | 微信登录客户端 + 入驻/角色 UI | 草案（已含产品裁决，待 API 真源） |
| [0005](./adr/adr-0005-state-and-request.md) | mobx + request | ✅ 采纳 |

---

## 14. 反模式表

| 行为 | 为什么错 |
|---|---|
| 自研 session / 不经 rak-auth 就「登录成功」 | 违反 §4 |
| 小程序内放 AppSecret 或本地 code2session | 密钥泄露 |
| member 仍渲染管理入口「以防万一」 | 违反产品裁决；攻击面外露 |
| 只在前端隐藏管理页、服务端不鉴权 | 越权 |
| manager 界面暴露任免/超级后台 | 违反角色矩阵 |
| 引入 Tailwind/shadcn 进 weapp | 构建/体积不可行 |
| 组件硬编码颜色 | 违反 DESIGN/token |
| 绕过 API.md 猜微信接口 | 契约漂移 |
| 删除 `allowBuilds` | pnpm 11 构建连环失败 |
| ROI 只存本地当权威 | 不可审计、多端不一致 |

---

## 15. 剩余开放项

| 项 | 状态 | 说明 |
|---|---|---|
| 微信 AppID | ⏭ 跳过 | 真机联调前填入 env / project.config.json |
| rak-auth 生产 API 域名 | ⬜ | M2 前提供 |
| rak-auth 微信契约实现 | 🟨 尽早 | 提案已写，待 rak-auth 仓 ADR + 实现 + API.md |
| 初始 super_admin 播种账号 | ⬜ | 建议你的 rak-auth userId/openid |
| manager 能否发邀请码 | 默认 **能** | 可改 |
| 审核类目最终值 | 默认 教育/工具 | 上线前定 |
| 隐私协议文案负责人 | ⬜ | 默认 Rak 团队草拟 |

全表：[OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md)  
微信契约提案：[proposals/rak-auth-wechat-auth-contract.md](./proposals/rak-auth-wechat-auth-contract.md)
