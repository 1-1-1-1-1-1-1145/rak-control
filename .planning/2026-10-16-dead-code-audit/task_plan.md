# rak-control 无效代码审计

目标：检查源码、复核报告，并按用户授权执行确定的无效内容清理及验证。

## Phase 1: 入口与约定
Status: complete
已确认 Taro 4.2.1、React、微信小程序；26 个注册页面，存在演示模式和独立云函数。

## Phase 2: 引用与冗余核实
Status: complete
已逐一核实 TS/JS/样式/图片/构建脚本/依赖/云函数的静态与动态入口，并复核了
`scan-summary.json` 的自动扫描结果（该扫描对 `.js`/`.d.ts` 入口与接口多态实现存在误报，已逐条人工纠正）。

## Phase 3: 验证与报告
Status: complete
产出风险分级清单（见 findings.md）。仅审计，未删除任何业务代码。

## Errors
- git status / git diff 不可用：当前目录没有 .git，改用文件证据与现有检查，不作版本差异结论。
- 自动扫描 scan-summary.json 误报：`normalizeLoginOutcome`/`normalizeMeView`/`validateTaskAttachments`
  （经 `import ... from './x.js'` 使用）与 `MemoryDemoStorage.getItem/setItem/removeItem`（接口多态调用）被误判为未引用。

## Phase 4: 对比 docs/DEAD-CODE-AUDIT.md
Status: complete
已核实插件误含、图标工具分类、验证标准、两处误报澄清与计数问题，确认 bare/fail 的有效补充。详见 report-comparison.md；未执行原报告删除建议。

## Phase 5: 执行已确认清理
Status: complete
用户已授权清理；备份后删除确认无用符号、样式、一次性工具、lint-staged，按仅 weapp 约定裁掉多端脚手架。保留 Taroify、云函数、demo、图标生成工具及有效样式。

## Phase 6: 验证和交付
Status: complete
同步依赖锁文件；单测、类型检查、开发和生产模式构建；核对页面资源，更新清理记录。

- 产物检查首次错误要求每个页面都有 wxss；Taro 无独立样式页不输出该文件。已修正为核对必需的 js/json/wxml，26 个页面完整。

- 图标检查首次错误假设 dark- 前缀；实际为 home-dark/home-dark-active 后缀。已按 syncTabBarStyle 的命名修正检查器，20 个图标文件均在。

收尾结果：17/17 单测、TypeScript、微信生产/开发构建及 8 项边界检查全部通过；最终 dist 为开发演示包。清理明细与备份位置见 docs/DEAD-CODE-CLEANUP.md。

## Phase 7: 删除本地订阅云函数
Status: complete
用户追加授权：备份后删除三个本地云函数、cloudfunctionRoot、环境备忘并同步文档；重跑类型、单测及开发构建。云端部署不在本地删除动作范围内。
