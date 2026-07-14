# ShanHaiEdu 文档入口与分类规则

更新时间：2026-07-13

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

阶段目录的活动、后续和历史导航统一从 `docs\stages\README.md` 进入。

V1 Agent、PPT、视频和交付质量专题资料统一入口：

```text
docs\architecture\2026-07-11-v1-agent-delivery-quality\README.md
```

当前 V1 执行、验证与续接入口：

```text
docs\handoffs\2026-07-13-v1-main-agent-mainline-handoff.md
docs\stages\local-real-v1-mainline-adjustment-plan.md
docs\stages\local-real-v1-mainline-adjustment-test-plan.md
docs\stages\local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-plan.md
docs\stages\local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-test-plan.md
docs\stages\local-real-v1-v1-1-orchestration-attribution-audit.md
docs\stages\local-real-v1-v1-1-orchestration-attribution-closeout.md
docs\stages\local-real-v1-v1-2-tool-agent-tool-registration-plan.md
docs\stages\local-real-v1-v1-2-tool-agent-tool-registration-test-plan.md
docs\stages\local-real-v1-v1-2-tool-agent-tool-registration-checkpoint.md
docs\stages\local-real-v1-v1-3-main-agent-controlled-react-plan.md
docs\stages\local-real-v1-v1-3-main-agent-controlled-react-test-plan.md
docs\stages\local-real-v1-v1-3-main-agent-controlled-react-closeout.md
docs\stages\local-real-v1-v1-4-human-gate-natural-language-interruption-plan.md
docs\stages\local-real-v1-v1-4-human-gate-natural-language-interruption-test-plan.md
docs\stages\local-real-v1-v1-4-human-gate-natural-language-interruption-closeout.md
docs\stages\local-real-v1-v1-5-generation-intensity-plan.md
docs\stages\local-real-v1-v1-5-generation-intensity-test-plan.md
docs\stages\local-real-v1-v1-5-generation-intensity-closeout.md
docs\stages\local-real-v1-v1-6-ppt-internal-orchestration-plan.md
docs\stages\local-real-v1-v1-6-ppt-internal-orchestration-test-plan.md
docs\stages\local-real-v1-v1-6-ppt-internal-orchestration-closeout.md
docs\stages\local-real-v1-v1-7-video-internal-orchestration-plan.md
docs\stages\local-real-v1-v1-7-video-internal-orchestration-test-plan.md
docs\stages\local-real-v1-v1-7-video-internal-orchestration-closeout.md
docs\stages\local-real-v1-v1-8-two-user-concurrency-plan.md
docs\stages\local-real-v1-v1-8-two-user-concurrency-test-plan.md
docs\stages\local-real-v1-v1-8-two-user-concurrency-closeout.md
docs\stages\local-real-v1-v1-8-multi-client-sqlite-write-blocker.md
```

V1 收尾智能体回复呈现要求：

```text
docs\product\v1-agent-guided-response-presentation-requirements.md
```

V1.5 当前成果工作区与糖葫芦退场决策：

```text
docs\product\v1-5-artifact-workspace-requirements.md
docs\architecture\decisions\2026-07-13-adr-当前成果工作区替代常驻糖葫芦.md
```

V1 发布完成后的 V1.1 对话Runtime、活动流、反馈闭环与教师体验入口：

```text
docs\product\v1-1-assistant-ui-conversation-runtime-requirements.md
docs\product\v1-1-feedback-closed-loop-requirements.md
docs\architecture\decisions\2026-07-14-adr-v1-1采用assistant-ui与AG-UI兼容事件层.md
docs\stages\v1-1-feedback-closed-loop-plan.md
docs\stages\v1-1-feedback-closed-loop-test-plan.md
```

V1.1 只在 V1-10 发布门关闭后进入实施；当前 V1 主线不得因上述规划提前改道。

V1.1发布后的审查需求分期：

```text
V1.2：docs\product\v1-2-stage-qa-requirements.md
V2.0之后：docs\product\v2-plus-continuous-review-requirements.md
```

V1.2只做每阶段独立QA、一次定点返修复验和前端展示；持续多轮、高强度、可计费审查不早于V2.0之后。

V2.0前生产化、50人在线与5人同时使用的硬门入口：

```text
docs\product\v2-0前生产化与容量要求.md
docs\stages\v2-0前生产化30天计划.md
docs\stages\v2-0前生产化验收计划.md
```

`local-real-v1-quality-release-*`、Stage 0R 至 Stage 6 以及旧真实交付包文档只保留为历史实现和证据来源。它们不得覆盖当前主线，也不得触发新的真实图片、视频或整包生成；真实媒体整包验证统一延后到 V1-9。

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
