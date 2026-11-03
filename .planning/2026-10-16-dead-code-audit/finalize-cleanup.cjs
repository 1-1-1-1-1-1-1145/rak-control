const fs = require('fs')
const path = require('path')
const planDir = '.planning/2026-10-16-dead-code-audit'
const result = JSON.parse(fs.readFileSync(planDir + '/cleanup-result.json', 'utf8'))
const verification = JSON.parse(fs.readFileSync(planDir + '/cleanup-verification.json', 'utf8'))
const production = JSON.parse(fs.readFileSync(planDir + '/production-output-check.json', 'utf8'))
const cache = JSON.parse(fs.readFileSync(planDir + '/cache-cleanup.json', 'utf8'))
if (verification.failed || production.exitCode !== 0) throw new Error('Verification incomplete')
const reportPath = 'docs/DEAD-CODE-AUDIT.md'
let report = fs.readFileSync(reportPath, 'utf8').replace(/\r\n/g, '\n')
function replace(from, to) {
  if (report.split(from).length !== 2) throw new Error('Report anchor missing/nonunique: ' + from)
  report = report.replace(from, to)
}
replace('> 本报告仅审计，未删除任何业务代码。', '> 执行状态：2026-10-16 已按用户授权完成确认项清理及微信单端脚手架精简。详见 [清理完成记录](./DEAD-CODE-CLEANUP.md)。\n> 下文候选表及源文件行号为清理前快照，不能直接当作当前源码定位；保留历史依据供复核。')
replace('以下符号全仓搜索无任何调用/导入，删除不影响运行链路。', '下表是清理前的候选清单；现已执行。`fail` 仅移除 export，`updateTask` 仅移除 task 服务门面再导出，实际函数实现及测试保留。')
replace('无调用（`demo/runtime.ts` 走 `adapter.reset()`）', '无调用；实际重置链为 `services/domain-entry → demo/services → adapter.reset`，runtime 负责创建服务与 storage 适配器')
replace('**建议**：可一次性删除；`page-shell` 的 `bare` 若确无计划使用，连 `page--flush` 样式一起清理。', '**执行**：此表候选已清理，并连带移除仅被无用 `myActive` 引用的 `TaskStore.myTasks`、独占 import 和 `page--flush` 样式。EmptyState/MetricCard/SectionTitle 对应的有效 class 样式仍保留。')
replace('## 3. B 类：需产品/架构裁决（存在语义冲突，未动）', '## 3. B 类：架构范围与本次处理')
replace('### B2. 多端脚手架残留（项目仅 weapp）', '### B2. 多端脚手架残留（已按仅 weapp 约定清理）')
replace('- `types/global.d.ts:19`：多端 `TARO_ENV` 联合类型。', '- `types/global.d.ts:19`：多端 `TARO_ENV` 联合类型属于声明约定，不产生运行时代码；保留整个类型文件。')
replace('**需要确认**：是否「永不接其它端」。若确认，可移除上述脚本/依赖/配置/html，**但这是一次较大改动，需单独排期与回归**。', '**执行**：依照现有仅 weapp 产品约定，已移除 16 个脚本、7 个非微信插件、h5/rn 配置与 H5 HTML；保留微信插件。已同步安装和锁文件，并通过开发构建与生产真实 API 分支编译。未来增加平台时需重新接入相应脚手架。')
replace('## 4. C 类：有意保留，**不可删**', '## 4. C 类：有效入口或待启用模块（本次保留）')
replace('| `.swc/` | 编译缓存，已在 `.gitignore:7`；可安全删除 |', '| `.swc/` | 可重建编译缓存；本次构建完成后已删除，下次构建可能重建 |')
replace('| `scripts/setup-github-team-repo.js` / `.ps1` | 仓库初始化一次性脚本，未挂到任何 npm 脚本 |', '| `scripts/setup-github-team-repo.js` / `.ps1` | 仓库初始化一次性脚本，已备份后删除 |')
replace('| `.planning/2026-10-16-dead-code-audit/` | 本次审计的工作文件（plan / findings / 扫描产物），交付后可移除 |', '| `.planning/2026-10-16-dead-code-audit/` | 保留审计依据、清理结果及验证日志；不属于小程序业务包 |')
replace('## 7. 建议的清理顺序（供决策，本报告未执行）', '## 7. 原建议与执行结果（2026-10-16）')
replace('1. **第一步（低风险）**：删除 §2 的 20 项无引用导出/成员 → 按下方验证。\n2. **第二步（需确认）**：就 §3 的两处做产品裁决，再分别处理依赖与多端脚手架。\n3. **第三步（收尾）**：清理 §5 的一次性脚本与审计工作文件。', '1. **已完成**：§2 确认项、复核记录补充的占位表达式、14 个旧选择器及 page--flush、重复 tokens 导入、2 个注释主题文件。\n2. **已完成**：按现有 weapp 单端范围清理多端脚手架，卸除未接入的 lint-staged，同步 pnpm-lock.yaml。\n3. **已完成**：备份后删除 2 个一次性建仓脚本及 .swc 缓存，重建 dist；保留审计记录。\n4. **继续保留**：Taroify 方案、订阅云函数、demo、图标生成工具、实际用到的样式和 JS/.d.ts 入口。')
report += '\n## 8. 本次实际验证\n\n- TypeScript：`tsc --noEmit --pretty false --skipLibCheck` 通过。\n- 单测：17/17 通过。\n- `pnpm build:weapp:prod` 通过，TARO_APP_DEMO=false；API 使用 https://example.invalid 仅验证编译，不代表真实后端联调。\n- `pnpm build:weapp` 通过；最后产物为演示模式，dist 已重建。\n- 26 个注册页面的 js/json/wxml 齐全；20 张图标与源码一致；清理收尾检查 8/8 通过。\n- 构建仍有既有 Sass @import 弃用提示，单测仍有既有 Node 模块类型提示；未做真机和线上云函数验证。\n- 详细备份位置、文件清单和边界见 [DEAD-CODE-CLEANUP.md](./DEAD-CODE-CLEANUP.md)。\n'
fs.writeFileSync(reportPath, report)
const linesRemoved = result.written.reduce((n, f) => n + f.linesBefore - f.linesAfter, 0)
const record = [
  '# rak-control 无效内容清理完成记录',
  '',
  '日期：2026-10-16。依据用户授权、《DEAD-CODE-AUDIT.md》及 `.planning/2026-10-16-dead-code-audit/{findings,report-comparison}.md` 执行。',
  '',
  '## 已清理',
  '',
  '- 未使用的 SectionTitle、EmptyState、MetricCard、formatMoney、toastError、useAuthGuard、storageKeys、QUALITY_SCORE、resetDemoState、DemoAdapter.isLoggedIn。',
  '- TaskStore.openTasks/pendingReview/myTasks/myActive/resetFilters/fetchOne、TeamStore.loading、store 中无消费者的 API_BASE/WECHAT_UI_BASE 重复导出。',
  '- fail 仅去掉 export；updateTask 仅去掉 services/task.ts 门面导出，其实际编辑能力、demo 方法和测试保留。',
  '- PageShell.bare 未用 prop/分支、首页两个分支都返回 null 的 taskStore 占位表达式、个人页 void taskStore，及相关独占导入/失实注释。',
  '- 14 个无消费者的旧样式选择器、page--flush 和 app.scss 重复 tokens 导入。对保留样式做编译规则对比，规则内容一致。',
  '- 5 个文件：src/styles/theme/light.scss、dark.scss、src/index.html、scripts/setup-github-team-repo.js、.ps1。',
  '- 依据 CONSTRUCTION.md 的仅 weapp 范围，移除 16 个非微信 build/dev 脚本、7 个非微信平台插件及 h5/rn 构建配置；微信平台插件保留。',
  '- 未配置或接入任何 hook 的 lint-staged；pnpm 安装和锁文件已同步。直接依赖剩余版本未变，peer 关系重解析带来的 less@4 等间接项由包管理器生成。',
  '- 删除 .swc 可重建缓存 ' + cache.bytes + ' 字节（约 2.56 MiB），dist 已重新构建。',
  '- 更新 CONSTRUCTION.md 的现行目录树及原审计报告的执行状态。历史设计/计划保留原始记录，旧行号仅作审计快照。',
  '',
  '首批修改 22 个文件、删除 5 个文件，已修改文件净减少 ' + linesRemoved + ' 行（不含被删除文件、后续锁文件和本记录；不是包体节省量）。完整列表见 cleanup-result.json。',
  '',
  '## 保留的内容',
  '',
  '- Taroify 依赖与 token 覆盖：仍为文档中的既定方案，尚未接入业务不等于已取消。',
  '- cloudfunctions 三个订阅模块、project.config.json 的 cloudfunctionRoot 和环境备忘；未查询或改动云端部署与定时器。',
  '- demo 和重置/任务编辑能力、MemoryDemoStorage 接口预留。',
  '- 26 个页面、20 张图标及 gen-tabbar-icons.py/requirements.txt、auth-contract/task-attachment-policy 的 JS 和声明文件。',
  '- empty-state、section-label、metric-card、form__textarea 等仍有效样式；未合并存在视觉差异的 metric-card 重复定义。',
  '- 类型声明、框架隐式依赖、commitlint/Husky/stylelint、pnpm allowBuilds 和所有审计证据。项目外原 zip 未改动。',
  '',
  '## 验证',
  '',
  '| 检查 | 结果 |',
  '| --- | --- |',
  '| `tsc --noEmit --pretty false --skipLibCheck` | 通过；安装同步后复跑通过 |',
  '| `npm test` | 17/17 通过 |',
  '| `pnpm build:weapp:prod` | 通过；TARO_APP_DEMO=false，API 为 https://example.invalid 仅编译验证 |',
  '| `pnpm build:weapp` | 通过；最后执行，保留演示模式 dist |',
  '| 页面和资源 | 26 页 js/json/wxml 完整，20 张图标逐字节一致，深浅色路径齐全 |',
  '| 删除与保留边界、样式、依赖锁、备份哈希 | verify-cleanup.cjs 的 8 项检查通过 |',
  '',
  '既有提示：构建 4 个 Sass @import 弃用警告；Node 单测有 MODULE_TYPELESS_PACKAGE_JSON 提示。未做微信开发者工具/真机点击回归、真实 API 联调、云函数部署状态核验；编译成功不代表这些验证已完成。',
  '',
  '验证日志位于 `.planning/2026-10-16-dead-code-audit/`：build-production.log、build-development.log、typecheck.log、test.log、cleanup-verification.json、production-output-check.json。',
  '',
  '## 恢复备份',
  '',
  '当前目录没有 .git，已在任何业务文件编辑前备份 31 个文件，包含所有首批编辑/删除目标、package.json、pnpm-lock.yaml 及原报告，SHA-256 校验全部通过。备份位于项目外：',
  '',
  '`' + result.backupRoot.replace(/\\/g, '/') + '`',
  '',
  '如需撤销，将备份中的对应文件按原相对路径覆盖回项目，再运行 `pnpm install --frozen-lockfile --ignore-scripts` 并重建微信产物。备份无需复制进 src/dist。新增的清理记录与验证脚本不影响业务运行。',
  '',
].join('\n')
fs.writeFileSync('docs/DEAD-CODE-CLEANUP.md', record)
let plan = fs.readFileSync(planDir + '/task_plan.md', 'utf8')
plan = plan.replace('## Phase 6: 验证和交付\nStatus: in_progress', '## Phase 6: 验证和交付\nStatus: complete')
plan += '\n收尾结果：17/17 单测、TypeScript、微信生产/开发构建及 8 项边界检查全部通过；最终 dist 为开发演示包。清理明细与备份位置见 docs/DEAD-CODE-CLEANUP.md。\n'
fs.writeFileSync(planDir + '/task_plan.md', plan)
fs.appendFileSync(planDir + '/progress.md', '\n2026-10-16：更新 docs/DEAD-CODE-AUDIT.md 执行状态，新增 docs/DEAD-CODE-CLEANUP.md。所有清理和验证阶段完成。保留尚未取消的 Taroify/云函数；未进行真机、真实后端或云端部署验证。\n')
console.log(JSON.stringify({record:'docs/DEAD-CODE-CLEANUP.md',updatedReport:reportPath,planStatus:'complete',backupRoot:result.backupRoot}, null, 2))
