# 阶段文档目录说明

`docs\stages\` 只保存阶段性计划、测试计划、验收报告和收尾记录。

## 1. 命名规则

```text
local-real-mvp-mXX-主题-plan.md
local-real-mvp-mXX-主题-test-plan.md
local-real-mvp-mXX-主题-closeout.md
```

## 2. 边界

- 阶段文档不能取代 `docs\product\current-requirements-baseline.md`。
- 阶段文档不能取代 `docs\product\requirements-backlog.md`。
- 阶段文档里的旧结论如果与当前产品基线冲突，按当前产品基线执行。
- 历史阶段文件保留为追溯证据，不直接作为当前开发依据。

## 3. 新阶段必须包含

1. 目标与范围
2. 关键假设
3. 不纳入范围
4. 文件影响面
5. 测试计划
6. 风险与回退
7. 集中验收命令

## 4. 当前活动阶段

V1 当前只从以下入口继续：

```text
local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-plan.md
local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-test-plan.md
local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-blocker.md
```

V1-9R 关闭前不得进入 V1-9 唯一真实 Provider 全链路。V1 发布前真实浏览器门只运行桌面视口；既有窄屏合同和历史证据继续保留。

## 5. 已接受但未进入当前主线

以下文档属于独立切片或 V1 发布后的规划，不得打断当前 V1 主线：

```text
interactive-courseware-spec-foundation-plan.md
interactive-courseware-spec-foundation-test-plan.md
v1-1-feedback-closed-loop-plan.md
v1-1-feedback-closed-loop-test-plan.md
v2-0前生产化30天计划.md
v2-0前生产化验收计划.md
```

实施前必须重新核对对应需求、架构决策、依赖和当时主线状态。

## 6. 历史阶段证据

其余阶段文档默认属于已完成阶段、早期并行主线、MVP迁移、失败阻塞、合并准备或审查记录。历史文件不因名称旧而自动删除或移动；需要归档时，先检查引用并建立单独迁移清单、回滚 manifest 和用户确认。
