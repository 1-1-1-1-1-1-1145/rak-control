# M6 任务清单（执行顺序）

规格：[M6 规格](2026-10-17-rak-m6-biz-isolation-spec.md)。
约束：按序执行；每个任务完成后对照规格 §7 自检，再进入下一个；遇规格未明确点暂停反馈。

## T1 共享工具层（阻塞后续全部）

- [x] 新建 `server/shared/text.ts`：`normalizeSingleLine` / `normalizeMultiLine`（CRLF/CR→LF，控制符规则，码点长度）。
- [x] 新建 `server/shared/money.ts`：`parseYuanToCents` / `centsToYuanText`。
- [x] 新建 `server/shared/shanghai-date.ts`：`SH_OFFSET_MS`、`toShDay`、`periodRange`、`lastSixMonthKeys`。
- [x] `server/repositories/collections.ts`：新增 `announcements:'rak_announcements'`、`roiItems:'rak_roi_items'`。
- 验收：三工具纯函数可被 spec §5 各规则直接引用；类型检查通过。

## T2 公告模块

- [x] 新建 `server/modules/announcements/index.ts`（6 个导出，见规格 §5.1）。
- [x] `server/contracts/dtos.ts` 追加 `AnnouncementView` / `AnnouncementPage`。
- 验收：状态机、草稿过滤、三值游标、归档约束符合规格 §5.1、§7.1。

## T3 ROI 模块

- [x] 新建 `server/modules/roi/index.ts`（6 个导出，见规格 §5.2）。
- [x] `server/contracts/dtos.ts` 追加 `RoiItemView` / `RoiPage` / `RoiOverviewView`。
- 验收：金额分、上海周期、含 CANCELLED、软删、ratio null 符合规格 §5.2、§7.1。

## T4 绩效模块

- [x] 新建 `server/modules/performance/index.ts`（`myPerformance` / `listPerformance`，见规格 §5.3）。
- [x] `server/contracts/dtos.ts` 追加 `PerformanceView` / `PerformancePage`。
- 验收：去重口径、同分排序、mine 隔离、超预算 `stats_unavailable` 符合规格 §5.3、§7.1。

## T5 社团设置与摘要

- [x] 新建 `server/modules/club/index.ts`（`getClub` / `updateClub` / `clubDashboard` / `profileSummary`，见规格 §5.4）。
- [x] `server/contracts/dtos.ts` 追加 `ClubView` / `ClubDashboardView` / `ProfileSummaryView`。
- 验收：白名单、dashboard 显式摘要、名册关闭仍在册总数符合规格 §5.4、§7.1。

## T6 注册与信封白名单

- [x] `server/contracts/actions.ts`：新增 §6 的 `ACTION_DATA_SCHEMAS`。
- [x] `server/modules/api-handlers.ts`：注册 `announcement.*`/`roi.*`/`performance.*`/`club.*`/`profile.summary`。
- 验收：未注册动作仍 `not_implemented`；多余字段 `validation_failed`；scope 不匹配 `scope_mismatch`。

## T7 服务端测试

- [x] `server/tests/m6-announcements.test.ts`
- [x] `server/tests/m6-roi.test.ts`
- [x] `server/tests/m6-performance.test.ts`
- [x] `server/tests/m6-club-summary.test.ts`
- 验收：覆盖规格 §7.1 全部条目；`corepack pnpm test:server` 全绿。

## T8 客户端适配

- [x] `src/services/cloud/dto.ts` 追加 M6 DTO。
- [x] 新建 `src/services/cloud/club.ts`、`src/services/cloud/roi.ts`、`src/services/cloud/performance.ts`。
- 验收：调用签名与 server action/scope/expectedRevision 一致；根 `tsc --noEmit` 通过。

## T9 门禁与日志

- [x] 依次运行规格 §7.2 六条命令并记录原始结果。
- [x] 写 `docs/verification/m6-execution-log-2026-10-17.md`。
- [x] 更新 `docs/api/cloud-v2.md`（M6 动作/DTO/错误码）。
- 验收：六条全 PASS；日志含每步操作、命令、结果、自检结论；真实云项标 `NOT_RUN`。
