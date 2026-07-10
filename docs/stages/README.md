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
