# 主线总览

日期：2026-07-07

## 当前状态

四条 MVP 并行支线已经通过 `integration/unified-mainline` 收束，并合并到 `main`。

当前项目不再按四条长期并行支线推进。后续默认只有一条持续主线：

```text
mainline/local-real-mvp
```

目标是把已经集成的 MVP 骨架推进成本地真实可用系统。

## 当前唯一主线

| 主线 | 工作区 | 目标 |
| --- | --- | --- |
| Local Real MVP | `E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\local-real-mvp-mainline` | 让教师在本机完成一节小学数学公开课材料的真实生产闭环 |

主线文档：

- `docs\mainlines\local-real-mvp.md`

## 已收束支线

以下支线已经进入 `main`，后续只作为历史记录和必要追溯来源：

- `feature/mvp-agent-runtime-adapter`
- `feature/mvp-backend-workflow-lite`
- `feature/mvp-frontend-api-backed-workbench`
- `feature/mvp-e2e-verification`
- `integration/unified-mainline`

旧支线 worktree 在确认不再需要后再归档或清理；删除动作必须单独确认。

## 执行规则

- 新开发只从 `mainline/local-real-mvp` 推进。
- 每个阶段先写阶段规划文档和测试定义，再开发。
- 阶段结束后集中验收，不用碎片化小验收冒充完成。
- 主线对话负责统一产品、前端、后端、Runtime、E2E 和交付边界。
- 临时审查或专项任务可以开短任务，但结论必须回写主线文档。

## 基线验收

`main` 合并后的基线已经通过：

- `npm test`
- `npm run build`
- `npm run test:e2e:stage2:preflight`
- `graphify update .`

## 关联文档

- `REQUIREMENTS_DECISION_V1.md`
- `原始需求记录_V1.md`
- `docs\mvp-to-production-agent-architecture.md`
- `docs\stages\unified-mainline-integration-report.md`
- `docs\handoffs\TARGET_MODE_HANDOFF_TEMPLATE.md`
