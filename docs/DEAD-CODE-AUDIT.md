# rak-control 无效代码检查报告

> 审计日期：2026-10-16
> 对象：`rak-control`（Taro 4.2.1 + React 18 + TS，微信小程序）
> 结论：**未发现整文件级的业务死代码**；可清理项集中在「未被引用的导出/成员」与「多端脚手架残留」。
> 执行状态：2026-10-16 已按用户授权完成确认项清理及微信单端脚手架精简。详见 [清理完成记录](./DEAD-CODE-CLEANUP.md)。
> 下文候选表及源文件行号为清理前快照，不能直接当作当前源码定位；保留历史依据供复核。

---

## 1. 审计范围与方法

覆盖 `src/`（81 个 TS/TSX/JS 源文件）、`config/`、`cloudfunctions/`、`types/`、`scripts/`、`tests/`
以及 `package.json`、`project.config.json`。

方法：

1. 以 `app.config.ts`（26 个注册页面）、`app.ts`、tabBar 为静态入口，逐文件追踪 TS/JS 导入链。
2. 对每个「导出符号 / 类成员 / 组件 prop / 依赖 / 图片 / 样式」逐一全仓搜索引用。
3. 复核仓库内既有的自动扫描产物 `scan-summary.json`，并**逐条人工纠正其误报**（见 §6）。

> 环境限制：当前目录不是 git 仓库（无 `.git`），无法做提交差异比对，所有结论均基于文件证据。

---

## 2. A 类：确认无引用的导出/成员（低风险，可安全删除）

下表是清理前的候选清单；现已执行。`fail` 仅移除 export，`updateTask` 仅移除 task 服务门面再导出，实际函数实现及测试保留。

| # | 文件:行 | 名称 | 核实结论 |
|---|---|---|---|
| 1 | `src/utils/format.ts:1` | `formatMoney` | 无调用；页面实际使用 `formatMoney2`（`pages/index/index.tsx:116`） |
| 2 | `src/utils/toast.ts:11` | `toastError` | 无调用 |
| 3 | `src/utils/permission.ts:33` | `useAuthGuard` | 无调用；守卫由 `components/page-shell.tsx:40-53` 自行实现 |
| 4 | `src/types/domain.ts:100` | `QUALITY_SCORE` | 无调用；`demo/adapter.ts:902` 另有局部 `scores` 表 |
| 5 | `src/components/ui.tsx:17` | `SectionTitle` | 无 import |
| 6 | `src/components/ui.tsx:105` | `EmptyState` | 无 import（注意与 `states.tsx` 的 `EmptyView` 是两个不同组件） |
| 7 | `src/components/ui.tsx:142` | `MetricCard` | 无 import |
| 8 | `src/services/club.ts:130` | `storageKeys` | `= STORAGE_KEYS` 的纯残留再导出，无 import |
| 9 | `src/services/task.ts:24` | `updateTask` | 解构再导出，无调用；`task-publish.tsx` 仅用 `publish` |
| 10 | `src/demo/adapter.ts:367` | `resetDemoState` | 无调用；实际重置链为 `services/domain-entry → demo/services → adapter.reset`，runtime 负责创建服务与 storage 适配器 |
| 11 | `src/demo/adapter.ts:444` | `DemoAdapter.isLoggedIn` | 无调用；实际使用的是 `authStore.isLoggedIn` |
| 12 | `src/store/index.ts:243` | `TaskStore.openTasks` | 无调用 |
| 13 | `src/store/index.ts:247` | `TaskStore.pendingReview` | 无调用（`review.tsx` 直接调 `fetchTasks({status:'SUBMITTED'})`） |
| 14 | `src/store/index.ts:256` | `TaskStore.myActive` | 无调用（`index.tsx` 的 `myActive` 是局部数据字段，同名不同物） |
| 15 | `src/store/index.ts:267` | `TaskStore.resetFilters` | 无调用 |
| 16 | `src/store/index.ts:384` | `TaskStore.fetchOne` | 无调用（`task/detail.tsx` 直接调 `taskService.fetchTask`） |
| 17 | `src/store/index.ts:510` | `TeamStore.loading` | 字段从未被读写 |
| 18 | `src/store/index.ts:642` | `export { API_BASE, WECHAT_UI_BASE }` | 无 import；连带 `store/index.ts:3` 的这两个 import 也可精简 |
| 19 | `src/components/page-shell.tsx:24` | `bare` prop | 无调用方传入，`page--flush`（第 65 行）成为死分支 |
| 20 | `src/store/index.ts:38` | `fail` 的 `export` 关键字 | 仅本文件内部调用，导出无意义 |

**风险**：极低。均为「定义了但没人用」，删除不会触达任何页面/服务调用路径。
**执行**：此表候选已清理，并连带移除仅被无用 `myActive` 引用的 `TaskStore.myTasks`、独占 import 和 `page--flush` 样式。EmptyState/MetricCard/SectionTitle 对应的有效 class 样式仍保留。

---

## 3. B 类：架构范围与本次处理

### B1. `@taroify/core` 依赖声明但未被使用

- `package.json:43` 声明 `"@taroify/core": "^1.0.6"`。
- 但 `src/` 内**没有任何 `from '@taroify/core'`**；仅 `src/styles/theme/taroify-overrides.scss`
  映射 `--taroify-*` CSS 变量，且其注释明确写着「不 import taroify 全量 CSS」。
- 与 `docs/CONSTRUCTION.md` §1 表格「组件 = **Taroify** + token 换肤 / ADR-0002 ✅」冲突。

**需要确认**：是「计划启用但尚未 import」，还是「已改为自绘组件、文档与 ADR 过期」。
若是后者 → 移除依赖并同步修订 ADR-0002 / CONSTRUCTION.md；若是前者 → 属于待办而非死代码。

### B2. 多端脚手架残留（已按仅 weapp 约定清理）

`docs/CONSTRUCTION.md:19` 与 ECO-ADR-0014 均明确「形态：微信小程序（**仅 weapp**）」。但仓库仍保留多端脚手架：

- `package.json` 脚本：`build:swan` / `build:alipay` / `build:tt` / `build:h5` / `build:rn` /
  `build:qq` / `build:jd` / `build:harmony-hybrid` 及对应 `dev:*`，共 16 条。
- 依赖中的 **7 个非微信平台插件**：`@tarojs/plugin-platform-{swan,alipay,h5,harmony-hybrid,jd,qq,tt}`。
  ⚠️ `@tarojs/plugin-platform-weapp` 是当前 `--type weapp` 的构建入口，**必须保留**，不可随这批一起删。
- `config/index.ts:66-102`：`h5` 与 `rn` 配置块。
- `src/index.html`：仅 h5 构建（htmlWebpackPlugin）使用。
- `types/global.d.ts:19`：多端 `TARO_ENV` 联合类型属于声明约定，不产生运行时代码；保留整个类型文件。

**执行**：依照现有仅 weapp 产品约定，已移除 16 个脚本、7 个非微信插件、h5/rn 配置与 H5 HTML；保留微信插件。已同步安装和锁文件，并通过开发构建与生产真实 API 分支编译。未来增加平台时需重新接入相应脚手架。

---

## 4. C 类：有效入口或待启用模块（本次保留）

| 对象 | 判定依据 |
|---|---|
| 原 `cloudfunctions/createSubTask`、`cancelSubTask`、`SubtaskScheduler` | 首轮清理保留；后经用户明确授权，于 2026-10-16 删除三个本地云函数、cloudfunctionRoot 和环境备忘。云端部署及触发器未操作。 |
| `src/demo/`（adapter / runtime / services） | `config/build-mode.ts:26` 显示开发构建默认 `demoMode=true`，且各 `services/*.ts` 始终引用 `demoServices`，是开发链路的必需依赖 |
| `src/utils/auth-contract.js` + `.d.ts` | 被 `utils/request.ts:4`、`services/domain-entry.ts:18`、`store/index.ts:35` 以 `from './auth-contract.js'` 引用，在用 |
| `src/utils/task-attachment-policy.js` + `.d.ts` | 被 `demo/adapter.ts:21`、`utils/task-attachments.ts:1` 引用，在用 |
| `types/global.d.ts` | 声明构建期常量 `__RAK_DEMO_MODE__` / `__RAK_API_BASE__` 及 `*.scss`/`*.png` 模块，构建必需 |

---

## 5. D 类：非源码文件（可清理，但性质是产物/工具/草稿）

| 路径 | 说明 |
|---|---|
| `dist/` | 构建产物，已在 `.gitignore:1`；删后由 `pnpm build:weapp` 再生 |
| `.swc/` | 可重建编译缓存；本次构建完成后已删除，下次构建可能重建 |
| `scripts/gen-tabbar-icons.py` + `requirements.txt` | **有效素材生成工具，默认保留**：生成当前 20 张 tabBar PNG（5 图标 × 亮/暗 × 选中态），改色/重生成依赖它，不宜按「无 npm script」判死 |
| `scripts/setup-github-team-repo.js` / `.ps1` | 仓库初始化一次性脚本，已备份后删除 |
| `.planning/2026-10-16-dead-code-audit/` | 保留审计依据、清理结果及验证日志；不属于小程序业务包 |

---

## 6. 附：既有自动扫描的误报澄清

仓库内 `.planning/.../scan-summary.json` 的自动扫描存在误报，**以下条目实际在用，不可删**：

| 被误判项 | 实际使用点 |
|---|---|
| `normalizeLoginOutcome` / `normalizeMeView`（`utils/auth-contract.js`） | `utils/request.ts:4,92`、`services/domain-entry.ts:18,54,134` |
| `validateTaskAttachments`（`utils/task-attachment-policy.js`） | `demo/adapter.ts:21,585`、`utils/task-attachments.ts:1` |
| `MemoryDemoStorage.getItem` / `setItem` | 经 `DemoStorage` 接口被多态调用（`adapter.ts:418`）；不要按「成员零引用」误删 |
| `MemoryDemoStorage.removeItem` | 当前适配器逻辑**确实没有调用点**，属接口预留（`runtime.ts` 也实现了它）；若要删须同步缩减接口与所有实现，不列入首批 |
| `createDemoSeed` | 被 `adapter.ts:368,431,449` 内部调用；扫描已计入（usageCount=3），保留结论正确 |

误报根因：扫描器未正确处理 `import ... from './x.js'` 的 `.js` 入口；接口成员的引用计数也需人工复核。

---

## 7. 原建议与执行结果（2026-10-16）

1. **已完成**：§2 确认项、复核记录补充的占位表达式、14 个旧选择器及 page--flush、重复 tokens 导入、2 个注释主题文件。
2. **已完成**：按现有 weapp 单端范围清理多端脚手架，卸除未接入的 lint-staged，同步 pnpm-lock.yaml。
3. **已完成**：备份后删除 2 个一次性建仓脚本及 .swc 缓存，重建 dist；保留审计记录。
4. **继续保留**：Taroify 方案、demo、图标生成工具、实际用到的样式和 JS/.d.ts 入口。订阅云函数在首轮保留后，已按用户追加授权删除本地模块。

> **验证建议**：`npm test`（17 个用例）+ `tsc --noEmit --skipLibCheck` + `pnpm build:weapp`。
> 注意 `build:weapp` 是**开发**构建（默认启用演示服务），不等于真实 API 模式；
> 涉及模式/依赖裁剪时还需补 `pnpm build:weapp:prod`（配 `TARO_APP_API_BASE`）与相关页面回归。
> 打包不能替代类型检查与测试。

## 8. 本次实际验证

- TypeScript：`tsc --noEmit --pretty false --skipLibCheck` 通过。
- 单测：17/17 通过。
- `pnpm build:weapp:prod` 通过，TARO_APP_DEMO=false；API 使用 https://example.invalid 仅验证编译，不代表真实后端联调。
- `pnpm build:weapp` 通过；最后产物为演示模式，dist 已重建。
- 26 个注册页面的 js/json/wxml 齐全；20 张图标与源码一致；清理收尾检查 8/8 通过。
- 构建仍有既有 Sass @import 弃用提示，单测仍有既有 Node 模块类型提示；未做真机和线上云函数验证。
- 详细备份位置、文件清单和边界见 [DEAD-CODE-CLEANUP.md](./DEAD-CODE-CLEANUP.md)。
