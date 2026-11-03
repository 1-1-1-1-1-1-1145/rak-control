# 对 docs/DEAD-CODE-AUDIT.md 的复核

日期：2026-10-16。仅审计其内容，不执行文档里的删除步骤，也不改原报告或业务源码。

结论：大部分未用符号判断正确，整体方向可以参考；但存在一处会误导删除微信平台插件的高风险表述，另有工具分类、验证标准、误报说明的问题和若干遗漏。

## 需要纠正

### 1. [P1] 多端清理清单误包含微信平台插件

报告第 75 行将 @tarojs/plugin-platform-weapp 与其他平台一并列入残留依赖，第 80 行又说可以移除上述依赖。照字面执行会把微信插件也删掉。package.json:54 声明此插件；本地已安装 @tarojs/cli/dist/cli.js 的平台选择分支会对 --type weapp 加载 @tarojs/plugin-platform-weapp，确实是当前构建入口。

修正：明确保留 weapp，只列七个非微信平台插件为可选移除项。不要将脚本、构建配置、类型声明、插件整体模糊地称为可全部删除。

### 2. [P2] 图标生成脚本被误归为一次性清理对象

报告第 102 行用“一次性生成、没有挂 npm script”描述 gen-tabbar-icons.py + requirements.txt，最后又建议清理这一类脚本。该脚本以仓内相对路径工作，生成当前的五类图标 × 亮暗主题 × 选中状态，总共 20 张 PNG；颜色与图形都在脚本中。docs/superpowers/specs/2026-09-19-rak-control-bento-redesign-design.md:86 明确将改色与再生成作为维护方式。

修正：列为有效的离线素材生成工具，默认保留。若明确接受放弃可复现的图标生成流程，可以作为工具精简另作决定，但不能以无 npm script 判死。删除不会立刻让现有 PNG 失效，却会丢掉其可编辑生成源。

### 3. [P2] 仅用开发构建通过作为删除验证，结论过强

报告第 125、129 行建议删完只跑 pnpm build:weapp，并说这是唯一构建路径、通过即证明无引用断裂。package.json:16 还有 build:weapp:prod；默认开发构建使用演示服务，而真实 API 模式有独立分支。打包也不能替代类型检查、测试、动态资源和云端调用核验。当前 Babel/SWC 转译链不等于独立 tsc 检查。

修正：至少结合 npm test、tsc --noEmit --skipLibCheck、开发构建；涉及模式/依赖裁剪时补生产真实 API 模式构建及相关页面回归。云函数独立验证实际部署与调用，图片/主题需运行时核验。没有运行就明确未验证，不能以推荐命令代表已验证。

### 4. [P3] 误报澄清中两处证据不实

- 报告第 116 行称 MemoryDemoStorage 的 getItem/setItem/removeItem 全部被接口多态调用。前两项在 adapter.ts:420、983 有真实调用；removeItem 只有接口声明、类实现和 runtime.ts 对象实现，没有任何调用表达式，当前 reset 通过 setItem 覆盖数据。结论应分开写；removeItem 可视为接口预留，若删应同步缩减接口和所有实现。
- 报告第 117 行称 createDemoSeed 被既有扫描漏计。但当前 reference-scan.json 对它记录 usageCount:3，使用点为 adapter.ts:368、431、449；scan-summary.json 的未用导出列表没有它。扫描脚本也统计同文件引用，并非“仅统计对外引用”。保留 createDemoSeed 的决定正确，解释其扫描误报的理由不成立。

### 5. [P3] 审计源文件数量口径写错

报告第 12 行称 src 有 88 个源文件。当前 src 下 TS/TSX/JS 共 81 个文件；88 是扫描源文件集合包含 src 81、config 4、tests 3 的合计。不是运行错误，但应改正覆盖范围描述。

## 需要限定范围，而非判错

- 第 39 行 updateTask：只删除 services/task.ts 中的解构门面导出可行，但不能扩展成删掉所有同名实现。domain-entry.ts:200、demo/services.ts:39、demo/adapter.ts:549 构成任务编辑能力，tests/demo-services.test.ts:379 明确测试它。
- 第 88 行三类云函数“不可删”过于绝对：应写“当前作为订阅功能预留，默认保留；取消订阅需求后可整体移除并同步配置”。发送虽然停用，Scheduler/config.json 仍保留每分钟触发器；本地删文件不能停掉已部署定时器，需核验云端，不能仅凭未被小程序调用就断言无其他用户。
- 删除 EmptyState/MetricCard/SectionTitle 组件，不应顺手删 empty-state/metric-card/section-label 样式：PageShell、ROI 页面、其他页面仍直接使用这些 class。
- 第 40 行 resetDemoState 的结论正确，但 reset 调用链位于 services/domain-entry → demo/services → adapter.reset，runtime 只是创建 storage 适配器和服务实例。

## 该报告有效补充的两项

1. bare prop 与 page--flush：原先报告漏列。AST 检查发现 32 个 PageShell JSX 使用点，均不传 bare，也没有 JSX spread；可以同时移除 props 字段、解构默认值、分支及 helpers.scss:17 对应规则。保留普通 page 样式。
2. fail 的 export：原先报告漏列。调用均在 store/index.ts 内，可以去掉 export，但函数本体仍有大量真实调用，不能删除。通常是接口收敛，不必承诺包体明显下降。

在内存中模拟以上 bare/fail 改动，以及移除 updateTask 门面导出，TypeScript 诊断为 0，未写回业务文件。复核脚本为 validate-report-additions.cjs。

## 相比前一份报告的遗漏

- 首页 taskStore.total 两分支均 null 的表达式、个人页模块顶层 void taskStore。
- app.scss 与 helpers.scss 重复导入 tokens；已有 Sass 内存验证展开 CSS 可少 3721 字节。
- 14 个旧选择器、两个只有注释的主题文件、未接入任何 hook/script/config 的 lint-staged。
- TaskStore.myTasks 只由无人使用的 myActive 调用；删 myActive 后还可继续删 myTasks。
- metric-card 重复样式不完全相同，应统一后合并，不是随便删一份。

这些属于完整性不足，不推翻其已列条目的大部分结论。原报告关于 demo、认证 JS/.d.ts、附件策略 JS/.d.ts、页面入口等保留建议基本正确。
