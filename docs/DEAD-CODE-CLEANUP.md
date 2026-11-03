# rak-control 无效内容清理完成记录

日期：2026-10-16。依据用户授权、《DEAD-CODE-AUDIT.md》及 `.planning/2026-10-16-dead-code-audit/{findings,report-comparison}.md` 执行。

## 已清理

- 未使用的 SectionTitle、EmptyState、MetricCard、formatMoney、toastError、useAuthGuard、storageKeys、QUALITY_SCORE、resetDemoState、DemoAdapter.isLoggedIn。
- TaskStore.openTasks/pendingReview/myTasks/myActive/resetFilters/fetchOne、TeamStore.loading、store 中无消费者的 API_BASE/WECHAT_UI_BASE 重复导出。
- fail 仅去掉 export；updateTask 仅去掉 services/task.ts 门面导出，其实际编辑能力、demo 方法和测试保留。
- PageShell.bare 未用 prop/分支、首页两个分支都返回 null 的 taskStore 占位表达式、个人页 void taskStore，及相关独占导入/失实注释。
- 14 个无消费者的旧样式选择器、page--flush 和 app.scss 重复 tokens 导入。对保留样式做编译规则对比，规则内容一致。
- 5 个文件：src/styles/theme/light.scss、dark.scss、src/index.html、scripts/setup-github-team-repo.js、.ps1。
- 依据 CONSTRUCTION.md 的仅 weapp 范围，移除 16 个非微信 build/dev 脚本、7 个非微信平台插件及 h5/rn 构建配置；微信平台插件保留。
- 未配置或接入任何 hook 的 lint-staged；pnpm 安装和锁文件已同步。直接依赖剩余版本未变，peer 关系重解析带来的 less@4 等间接项由包管理器生成。
- 删除 .swc 可重建缓存 2682584 字节（约 2.56 MiB），dist 已重新构建。
- 更新 CONSTRUCTION.md 的现行目录树及原审计报告的执行状态。历史设计/计划保留原始记录，旧行号仅作审计快照。

首批修改 22 个文件、删除 5 个文件，已修改文件净减少 356 行（不含被删除文件、后续锁文件和本记录；不是包体节省量）。完整列表见 cleanup-result.json。

## 保留的内容

- Taroify 依赖与 token 覆盖：仍为文档中的既定方案，尚未接入业务不等于已取消。
- 订阅云函数首轮保留，随后用户明确授权删除，现已移除三个本地模块、cloudfunctionRoot 和环境备忘；云端部署与定时器未操作，见下方追加记录。
- demo 和重置/任务编辑能力、MemoryDemoStorage 接口预留。
- 26 个页面、20 张图标及 gen-tabbar-icons.py/requirements.txt、auth-contract/task-attachment-policy 的 JS 和声明文件。
- empty-state、section-label、metric-card、form__textarea 等仍有效样式；未合并存在视觉差异的 metric-card 重复定义。
- 类型声明、框架隐式依赖、commitlint/Husky/stylelint、pnpm allowBuilds 和所有审计证据。项目外原 zip 未改动。

## 验证

| 检查 | 结果 |
| --- | --- |
| `tsc --noEmit --pretty false --skipLibCheck` | 通过；安装同步后复跑通过 |
| `npm test` | 17/17 通过 |
| `pnpm build:weapp:prod` | 通过；TARO_APP_DEMO=false，API 为 https://example.invalid 仅编译验证 |
| `pnpm build:weapp` | 通过；最后执行，保留演示模式 dist |
| 页面和资源 | 26 页 js/json/wxml 完整，20 张图标逐字节一致，深浅色路径齐全 |
| 删除与保留边界、样式、依赖锁、备份哈希 | verify-cleanup.cjs 的 8 项检查通过 |

既有提示：构建 4 个 Sass @import 弃用警告；Node 单测有 MODULE_TYPELESS_PACKAGE_JSON 提示。未做微信开发者工具/真机点击回归、真实 API 联调、云函数部署状态核验；编译成功不代表这些验证已完成。

验证日志位于 `.planning/2026-10-16-dead-code-audit/`：build-production.log、build-development.log、typecheck.log、test.log、cleanup-verification.json、production-output-check.json。

## 恢复备份

当前目录没有 .git，已在任何业务文件编辑前备份 31 个文件，包含所有首批编辑/删除目标、package.json、pnpm-lock.yaml 及原报告，SHA-256 校验全部通过。备份位于项目外：

`C:/Users/24800/Desktop/小程序/rak-control-cleanup-backup-2026-10-16T11-28-32-753Z`

如需撤销，将备份中的对应文件按原相对路径覆盖回项目，再运行 `pnpm install --frozen-lockfile --ignore-scripts` 并重建微信产物。备份无需复制进 src/dist。新增的清理记录与验证脚本不影响业务运行。

## 追加清理：本地订阅云函数

2026-10-16 用户明确授权，已删除 createSubTask、cancelSubTask、SubtaskScheduler 三个目录（7 个文件）、config/cloudbase-env.local，并移除 project.config.json 的 cloudfunctionRoot。同步开发者工具指南、附件教程/契约、审计报告及验证脚本。

修改前备份：`C:/Users/24800/Desktop/小程序/rak-control-cloudfunctions-backup-2026-10-16T11-58-16-353Z`。未查询、删除或停用云端部署和触发器；如曾部署，仍需另行核对云端资源。TypeScript 检查通过，17/17 单测通过，微信开发构建通过（4 个既有 Sass 弃用警告），8 项边界检查通过。源码与 dist/project.config.json 均无 cloudfunctionRoot；运行代码无三个云函数或原环境 ID 引用，备份 SHA-256 全部校验通过。
