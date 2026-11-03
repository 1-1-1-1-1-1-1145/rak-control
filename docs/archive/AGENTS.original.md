# AGENTS.md — rak-control 开发指南

## 生态定位

rak-control 是 rak-end 生态的**微信小程序端**：学校社团内部应用 + 团队 ROI 管理。
定位、上下游与契约真源以生态宪法 [ECOSYSTEM.md](../ECOSYSTEM.md) **§1 注册表**为准
（入册依据：**ECO-ADR-0014**，2026-09-18 采纳）。本段是 §7.3 要求的定位指针，
改定位必须先改 §1 注册行。

- **上下游**：依赖 rak-auth（生态唯一身份后端）。认证走
  **「微信 code2session → rak-auth」**：小程序 `wx.login` 取 code → 服务端
  `code2session` 取 openid → 映射 rak-auth 身份。
  **禁止自建 session / 登录体系**（§4 白名单硬约束）。
  openid 绑定链路属身份契约变更，须同步真源 `rak-auth/docs/API.md`。
- **数据**：社团 / ROI 业务数据挂 rak-auth 控制平面，落 PG `auth` schema；
  **不新增服务、不新增端口**（§3 不变）。
  ⚠️ 该选择使 `auth` 由纯身份面变为「身份 + 社团业务」混合，与 ECO-ADR-0008
  数据所有权分层存在张力（见 ADR-0014 后果段）；业务增长后建议另立第 7 域迁出。
- **UI 基准**：design token 以 Xra-space 为基准（ECO-ADR-0007），GSAP 为动效第一优先。
  小程序无 DOM，Tailwind 类名**不可直接照搬**，需 token → 小程序样式桥接
  （CSS 变量 + RPX 换算）。

## 技术栈与命令

- Taro 4.2.1 + React 18 + TypeScript 5 + Sass；编译工具 Webpack5
- 包管理器：**pnpm**（对齐 rak）；目标端**仅微信小程序**

```bash
pnpm install
pnpm dev:weapp     # 开发模式（--watch），产物 dist/，用微信开发者工具导入
pnpm build:weapp   # 生产构建
```

## 已知坑（踩过，别再踩）

- **pnpm 11 拦截构建脚本**：首次安装会报 `ERR_PNPM_IGNORED_BUILDS` 并以退出码 1
  失败，进而让 `taro build` 的 `depsStatusCheck` 连带失败。解法是
  `pnpm approve-builds --all`，它会写 `pnpm-workspace.yaml` 的 **`allowBuilds`** 字段。
  ⚠️ pnpm 11 **不认** `onlyBuiltDependencies`（那是 pnpm 10 的键），
  放 `package.json` 的 `pnpm` 字段里同样无效。本仓已配好 `allowBuilds`，勿删。
- **`taro init` 参数枚举首字母大写**：`--npm Pnpm`、`--css Sass`（不是 `pnpm`/`sass`），
  否则报 `does not match any variant of enum NpmType`。框架与编译工具**没有**对应
  flag，必须交互输入（脚本化时用 `yes '' |` 喂默认值，默认即 React + Webpack5）。

## 分支模型

沿用生态统一模型（ECO-ADR-0009）：`main` 开发 / `rak-stable` 发布；
GitHub = 提交真源（**VANexus 团队仓**），GitLab 仅 CI/CD 端点，禁止提交。

- **远程（团队仓）**：`https://github.com/VANexus/rak-control.git`（remote 名 `origin`）
- **作者用户名**：保持 `Thecnfor`（与生态既有提交一致）；**禁止**改推到个人私有仓
- **纪律**：后续开发步骤与 `docs/` 文档每次变更都必须 commit 并 push 到团队仓
- 小程序 AppID：`wxa8bf102dcfdcec4c`（已写入 `project.config.json` 与 `.env.*`）
