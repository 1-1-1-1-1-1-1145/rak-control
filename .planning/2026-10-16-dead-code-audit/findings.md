# rak-control 无效代码与文件检查

日期：2026-10-16。范围：磁盘上的 src、config、tests、scripts、cloudfunctions、构建配置与样式。

结论：存在未用组件/函数、Store 成员、旧样式、占位表达式和脚手架残留；26 个页面全部注册，未发现可直接整页删除的孤立业务页面。本次只检查，未改写或删除业务源码、依赖、dist 或云端资源；新增文件均在本审计目录。

## 一、可优先清理的代码

以下按具体符号清理，不是删除整个文件。已对源码/测试搜索、编译器引用与动态入口交叉核实。

| 位置 | 候选 | 证据与边界 |
| --- | --- | --- |
| src/components/ui.tsx:17 | SectionTitle | 无消费者；页面直接写 section-label，保留该 class。 |
| src/components/ui.tsx:105 | EmptyState | 无消费者；页面使用 states.tsx 的 EmptyView。PageShell 仍用 empty-state class，保留样式。 |
| src/components/ui.tsx:142 | MetricCard | 无消费者；ROI 页直接写 metric-card 结构，组件可删但其 class 样式保留。 |
| src/utils/format.ts:1 | formatMoney | 只有定义，实际使用 formatMoney2；后者保留。 |
| src/utils/toast.ts:11 | toastError | 只有定义；实际使用 toast/fail。 |
| src/utils/permission.ts:33 | useAuthGuard | 无页面使用；删后连带移除其独占的 Taro、useEffect、authStore、ROUTES、toast 导入。canManage/isSuper/roleLabel 保留。此结论不等于所有页面鉴权已安全审计通过。 |
| src/services/club.ts:130 | storageKeys | STORAGE_KEYS 的无消费者别名；可连带移除该文件中的 STORAGE_KEYS import，保留 constants 原定义。 |
| src/types/domain.ts:100 | QUALITY_SCORE | 无引用；demo/adapter.ts:902 实际用本地 scores。可删无用常量，或改用常量并删本地映射，二选一。 |
| src/demo/adapter.ts:367 | resetDemoState | 无调用；设置页恢复数据走 resetDemoData → demo.auth.reset → adapter.reset，后者保留。 |
| src/demo/adapter.ts:444 | DemoAdapter.isLoggedIn | 无读取；不要混淆有效的 AuthStore.isLoggedIn。 |
| src/store/index.ts:243 | TaskStore.openTasks/pendingReview/myTasks/myActive | 前两者和 myActive 无消费者，myTasks 只被 myActive 调用，可整组删；首页 HomeData.myActive 是另一字段，保留。 |
| src/store/index.ts:267 | TaskStore.resetFilters | 无调用；实际使用 setFilters，保留 setFilters。 |
| src/store/index.ts:384 | TaskStore.fetchOne | 无调用；任务详情直接调 service。ROI 详情使用 RoiStore.fetchOne，后者保留。 |
| src/store/index.ts:510 | TeamStore.loading | 只有初始声明，无读写；页面各自维护 loading。 |
| src/store/index.ts:642 | API_BASE/WECHAT_UI_BASE 重复导出 | 消费方均从 constants 引入，无人从 store 导入；删重复导出及 store 顶部对应 import，保留 constants 中的原定义。 |

## 二、占位语句与重复编译

1. src/pages/me/profile.tsx:131–132 的注释和模块顶层 `void taskStore`：不会建立 observer 的 render 依赖。本页计数由 useDidShow 调 service 得到，可删该语句及 taskStore import。
2. src/pages/index/index.tsx:251–252 的注释和 `{taskStore.total ? null : null}`：只增加 MobX 重渲染依赖，两个分支都不显示内容，也不会调用首页 load 或更新其 useState 数据；可删并移除该页 taskStore import。
3. src/app.scss:1 直接导入 tokens，helpers.scss:1 也导入 tokens，而 app.scss:2 又导入 helpers，导致两次编译。保留 helpers 内导入时可删 app.scss:1。当前 Sass 展开 CSS 从 17,313 降为 13,592 字节，减少 3,721 字节；去除重复顶层规则后内容一致。这不是最终微信包体节省量的实测值。
4. config/prod.ts 内注释掉的 analyzer/prerender 模板代码可删；文件仍被 config/index.ts 导入，不应整文件删除造成断链。

## 三、14 个无消费者的旧样式选择器

| 文件 | 选择器 |
| --- | --- |
| src/styles/helpers.scss:30 | .surface-muted |
| src/styles/helpers.scss:174 | .btn-primary--pressed |
| src/styles/helpers.scss:342 | .metric-card__value--sm |
| src/styles/helpers.scss:351 | .mt-8 |
| src/styles/helpers.scss:393 | .home-badge-dot |
| src/styles/form.scss:3 | .form__input |
| src/styles/form.scss:27 | .profile__avatar、.profile__avatar-text |
| src/pages/club/club.scss:1 | .team-row--me |
| src/pages/club/club.scss:8 | .club-stats、.club-stats__item、.club-stats__num |
| src/pages/me/me.scss:13 | .me-counts、.me-counts__item |

源码未发现使用或对应动态 class 生成入口。不要删整份 form.scss/club.scss/me.scss；form__textarea 被任务交付页使用。

另外，helpers.scss:279 与 components/ui.scss:1 重复定义 metric-card 系列，但 padding/flex/字号不完全相同，属于需要统一视觉后才能合并的重复规则，不建议盲删一份。EmptyView 的 art 变体属于可配置参数，不把扫描未命中的动态变体当确定死代码。

## 四、可删除的空壳或一次性工具

- src/styles/theme/light.scss（95 字节）与 dark.scss（58 字节）：各只有一行注释，没有 import，没有样式。实际主题在 tokens.scss；删它们不影响主题，清理时同步工程目录文档。
- scripts/setup-github-team-repo.js 与 .ps1：无构建/测试/script/hook 入口，是独立手动建仓工具。PowerShell 版固定指向旧目录 D:\XRAK\team\rak-end\rak-control。若不再用于首次建仓/推送可删除两份，共约 5.2 KB。本次只读，没有执行它们。
- config/cloudbase-env.local：只记录环境 ID，当前源码与脚本未读取，无运行时作用；若仍当人工环境备忘则保留，移除订阅模块时可一起清。

## 五、有条件的精简项

### 多端脚手架

docs/CONSTRUCTION.md:19 明确仅 weapp。若保持该范围，可移除 package.json 中 swan/alipay/tt/h5/rn/qq/jd/harmony-hybrid 共 16 个 build/dev 脚本，7 个非微信平台插件（alipay/h5/harmony-hybrid/jd/qq/swan/tt）、config/index.ts:66 的 h5 与 :95 的 rn 配置、dev/prod 中 h5 空壳，以及微信构建不使用的 src/index.html。需同步 pnpm-lock.yaml 并重跑 weapp 构建。

不要仅凭业务无 import 删除 runtime/helper/shared/@tarojs/react/react-dom/Babel/Webpack/Sass 等框架依赖：本地 plugin-framework-react 明确生成 react-dom 引用并设置到 @tarojs/react 的别名。

### Taroify

@taroify/core 在业务源码零 import；theme/taroify-overrides.scss 只有无人消费的 --taroify-* 变量，却被 app.scss:4 编译。若决定放弃该 UI 库，可一起移除包、覆盖文件及 import。但 DESIGN.md 和 ADR-0002 明确选用 Taroify，所以它属于方案收敛后的可选清理，不能直接认定为废弃方案；需同步文档并验证构建。

### lint-staged

package.json:85 声明 lint-staged，但无配置文件、package 配置、pre-commit hook 或 script 调用。现有 commit-msg 用 commitlint。若没有仓外手动流程，lint-staged 可移除并更新 lockfile；保留实际启用的 Husky/commitlint。stylelint 有配置，可能被手动/编辑器使用，不能按无 script 判死。

### 订阅提醒云函数

cloudfunctions/createSubTask、cancelSubTask、SubtaskScheduler 当前没有客户端调用；src/config 中没有 cloud.callFunction、requestSubscribeMessage 或 cloud 初始化接入。Scheduler/index.js:20–29 明确停用发送，固定 sent:0 / TEMPLATE_NOT_CONFIGURED，但 config.json 保留每分钟触发。

这是尚未启用的独立模块。若决定取消订阅提醒，可整体删 cloudfunctions，并同步 project.config.json:3 的 cloudfunctionRoot、环境备忘及指南。没有查询实际 CloudBase 部署，无法排除其他调用方；删除本地源码不会自动删除已部署函数或停用线上触发器，需要另行核对。TASK-ATTACHMENTS-GUIDE.md:19 明确这些函数与任务附件无关。

## 六、可重建目录

- .swc：1 个缓存，2,682,584 字节（约 2.56 MiB），可清理，下次构建可能再生成。
- dist：129 个产物，562,561 字节（约 549 KiB），可删后重建；开发者工具 miniprogramRoot 指向它，删后须先构建。不能只改 dist 永久清理源码。
- node_modules：依赖目录，可按 lockfile 重装，不按业务引用逐文件删除。
- 项目外的 ../rak-control.zip 约 125 MiB，是归档而非源码入口；本次未验证其内容是否与当前项目相同，是否保留属于备份管理。

## 七、已排除的误删项

- 26/26 页面注册完整：主包 16、分包 10；页面与 *.config.ts 是框架入口，无普通 import 正常。
- 20 张 tabBar PNG 均有效，共 8,329 字节；亮色由 app.config 引用，深色由 syncTabBarStyle 动态拼接。gen-tabbar-icons.py 与 requirements.txt 是有效图标生成工具及依赖。
- demo 目录是开发构建默认使用的服务及测试依赖；不能整目录删，真实 API 分支也有用途。
- auth-contract.js/task-attachment-policy.js 与各自 .d.ts 分别提供运行逻辑及类型。静态扫描因 .d.ts 解析有误报，已按真实 import 纠正。
- MemoryDemoStorage 的 getItem/setItem 通过 DemoStorage 接口调用，不能依赖成员零引用误删实现。removeItem 在当前适配器逻辑中没有调用，但属于接口及运行时 storage 适配约定，若要缩减须同时调整各实现，不列入首批。
- services/task.ts:updateTask 无页面消费者，但 createTaskService.updateTask 和 DemoAdapter.updateTask 有对应测试，是未接入 UI 的已测试能力；可精简门面导出，整条删除须同时裁掉能力和测试，不列入直接清理。
- pnpm-workspace.yaml 的 allowBuilds、lockfile、Babel 与微信项目配置等都有工具入口。

## 八、验证结果与限制

- npm test：17/17 通过。现有 Node MODULE_TYPELESS_PACKAGE_JSON 提示不影响通过，不为消除提示直接把整个工程改 ESM。
- tsc --noEmit --pretty false --skipLibCheck：通过，跳过第三方声明库内部检查。
- 内存模拟移除第一节全部候选、第二节两个占位语句及相关 import（10 个源文件）：TypeScript 诊断 0，删除约 152 行声明/import；未将修改写回业务文件。详见 validation-results.json。
- 重复 tokens import 经 Sass 内存编译与规则对比：去重后等价，展开 CSS 减少 3721 字节。
- 未卸包、重打包、运行开发者工具/真机或核验云端部署，因此不声称依赖裁剪后的完整构建已通过。
- 当前目录无 .git，无法做历史/分支差异检查，结论针对当前文件。

建议顺序：未用符号与占位语句 → 14 个旧选择器与重复 tokens import → 两个注释主题文件 → 一次性工具和 lint-staged → 按产品范围决定多端、Taroify 与订阅模块。
