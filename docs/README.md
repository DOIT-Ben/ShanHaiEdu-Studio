# ShanHaiEdu 文档入口与分类规则

更新时间：2026-07-10

本文是 `docs\` 的导航入口。后续任何需求增加、架构调整、阶段开发、测试验收和收尾记录，都必须先判断文档归属，再落到对应目录；不要把需求、架构、阶段计划和历史报告继续混在同一个文件里。

## 1. 必读顺序

新会话、新智能体或新阶段开始前，按顺序读取：

1. `AGENTS.md`：项目总则、工作方式、验证和安全边界。
2. `docs\README.md`：文档分类和入口。
3. `docs\product\current-requirements-baseline.md`：当前需求与质量门禁唯一权威口径。
4. `docs\product\requirements-backlog.md`：未完成需求、新增需求、延期需求和优先级。
5. 当前专题需求，例如 `docs\product\beta-feedback-requirements.md`。
6. `docs\mainlines\current-mainline-status.md`：当前主线状态、已完成阶段、下一阶段建议。
7. 相关架构入口：`docs\architecture\README.md`。
8. 当前阶段计划：`docs\stages\...-plan.md`。

## 2. 目录职责

| 目录 | 职责 | 不能放什么 |
|---|---|---|
| `docs\product\` | 产品需求、质量门禁、需求总账、交互需求、媒体工作流需求 | 不放代码实现细节和阶段验收流水账 |
| `docs\architecture\` | 架构总则、核心设计、五平面、十二系统、ADR 架构决策 | 不放一次性需求讨论和阶段测试结果 |
| `docs\mainlines\` | 当前主线、阶段顺序、已完成/未完成状态、跨阶段路线图 | 不放单阶段详细开发步骤 |
| `docs\stages\` | 单阶段计划、测试计划、验收报告、收尾记录 | 不作为长期需求或架构权威来源 |
| `docs\contracts\` | API、数据契约、前后端接口契约 | 不放产品愿景 |
| `docs\ui\` | 前端交互、视觉规范、页面专项计划 | 不放后端 runtime 设计 |
| `docs\runbooks\` | 部署、运维、演示、交接操作说明 | 不放需求决策 |
| `docs\handoffs\` | 多智能体/交接模板和任务包 | 不放长期产品基线 |
| `docs\archive\` | 历史归档、旧口径、已废弃材料 | 不作为当前开发依据 |

## 3. 权威级别

当文档冲突时，按以下顺序判断：

```text
AGENTS.md / 平台安全规则
  > docs\product\current-requirements-baseline.md
  > docs\product\requirements-backlog.md
  > docs\architecture\README.md 与核心架构文档
  > docs\mainlines\current-mainline-status.md
  > 当前阶段 plan / test-plan / closeout
  > 历史阶段报告和 archive
```

旧阶段计划、早期 MVP 方案、历史报告只能作为证据，不得覆盖当前需求基线。

## 4. 新文档命名规则

### 产品需求

```text
docs\product\requirements-backlog.md
docs\product\conversation-interaction-requirements.md
docs\product\conversation-commitment-execution-consistency-requirements.md
docs\product\beta-feedback-requirements.md
docs\product\frontend-workbench-priority-requirements.md
docs\product\competitor-derived-second-tier-requirements.md
docs\product\media-workflow-requirements.md
docs\product\YYYY-MM-DD-主题-requirements.md
```

### 架构设计

```text
docs\architecture\YYYY-MM-DD-主题.md
docs\architecture\decisions\YYYY-MM-DD-adr-主题.md
```

### 主线状态

```text
docs\mainlines\current-mainline-status.md
docs\mainlines\local-real-mvp.md
```

### 阶段开发

```text
docs\stages\local-real-mvp-mXX-主题-plan.md
docs\stages\local-real-mvp-mXX-主题-test-plan.md
docs\stages\local-real-mvp-mXX-主题-closeout.md
```

## 5. 当前文档治理策略

- 第一阶段只新增入口、索引和总账，不批量移动旧文档。
- 旧文档是否归档必须先查引用和历史作用，不因文件名旧就删除或移动。
- 任何归档、移动、删除都需要单独计划和确认。
- 新阶段必须优先把新增需求写入 `docs\product\requirements-backlog.md`，再写阶段计划。
