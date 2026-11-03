# 多团队方案编制任务

Goal：只交付Rak多团队切换与云端隔离设计、AI实施计划；不开发或部署。

## Phases
1. 技能、源码、既有云化设计与官方边界核查。 Status: complete
2. 明确团队创建边界和账号/成员模型。 Status: complete
3. 编写完整设计及依赖有序实施计划，同步旧方案优先级。 Status: complete
4. 并行复审、逐项追踪、回读文档并交付。 Status: complete

## Decisions
- 首版由有平台管理权限的人受控创建团队，用户已明确确认。
- 同微信可属多队；每队姓名/职务/角色/任务/附件/绩效/ROI独立。
- 小程序禁止直连数据库，全部经云函数；私有附件由云函数按本队业务关系授权。
- 2026-10-16云化基线尚未实施，本轮覆盖其单团队假设，保留其他可靠性规则。
- 本轮只写文档，不实施、不部署、不改线上规则。

## Errors
- 首次合并读取输出过长被截断：改为针对文件/章节的有限读取；不以截断部分为完整证据。
- rg包含不存在的src/demo/model.ts：已用rg --files确认实际demo文件，不据此编造路径。
- 旧云化计划称无.git；当前已存在.git且两份旧文档有暂存修改。保留用户暂存区，不reset/stage/commit。
- 初次批量apply_patch有一处完整行匹配失败，未产生部分改动；拆成精确段落后成功。
- Python文档检查在Windows GBK输出勾号时报UnicodeEncodeError；改ASCII JSON输出后重跑通过，未据失败输出判验证成功。

## Deliverables
- docs/superpowers/specs/2026-10-17-rak-multi-team-isolation-design.md
- docs/superpowers/plans/2026-10-17-rak-multi-team-isolation-plan.md
- 两份2026-10-16旧方案各增加当前多团队文档导航及历史范围说明，暂存区不变。
- 只完成文档，全部88项实施复选框未勾选；没有修改应用/环境配置、运行应用测试/构建或部署。
