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

## 2026-07-08 分支盘点

本次已重新执行 `git fetch origin --prune`、`git branch -vv`、`git branch -r -vv`、`git worktree list --porcelain` 和祖先关系检查。

当前仓库仍有多个分支引用，但只有一条开发主线：

```text
mainline/local-real-mvp
```

分支现状：

| 类型 | 数量 | 说明 |
| --- | ---: | --- |
| 本地分支 | 7 | `main`、`mainline/local-real-mvp`、4 条历史 feature、1 条 integration |
| 远程分支 | 8 | `origin/main`、`origin/mainline/local-real-mvp`、4 条历史 feature、`origin/integration/unified-mainline`、`origin/master` |
| 本地 worktree | 8 | 包含 `main`、当前主线、历史支线、集成支线和一个 detached audit worktree |

祖先关系确认：

- `feature/mvp-agent-runtime-adapter` 已进入 `main`，也是 `mainline/local-real-mvp` 的祖先。
- `feature/mvp-backend-workflow-lite` 已进入 `main`，也是 `mainline/local-real-mvp` 的祖先。
- `feature/mvp-frontend-api-backed-workbench` 已进入 `main`，也是 `mainline/local-real-mvp` 的祖先。
- `feature/mvp-e2e-verification` 已进入 `main`，也是 `mainline/local-real-mvp` 的祖先。
- `integration/unified-mainline` 已进入 `main`，也是 `mainline/local-real-mvp` 的祖先。
- `main` 已是 `mainline/local-real-mvp` 的祖先。

同步状态：

- `main` 与 `origin/main` 同步：`0 0`。
- `mainline/local-real-mvp` 本地领先 `origin/mainline/local-real-mvp`：`0 62`。
- `mainline/local-real-mvp` 本地领先 `origin/main`：`0 63`。

结论：

- 代码和规划已经统一收束到 `mainline/local-real-mvp`。
- 旧 feature/integration 分支与 worktree 只作为历史追溯，不再承接新开发。
- 不删除旧 worktree、旧分支或远程分支，除非用户单独确认。
- 任何新阶段、测试定义、开发、验收、审查和提交都必须在 `local-real-mvp-mainline` 工作区、`mainline/local-real-mvp` 分支上推进。

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
- 不从 `feature/mvp-*`、`integration/unified-mainline`、`main` 或 detached audit worktree 继续开发。
- 如果需要临时审查或实验，必须从 `mainline/local-real-mvp` 当前 HEAD 创建短生命周期分支或 worktree，并把结论回写本主线文档。
- 每个阶段先写阶段规划文档和测试定义，再开发。
- 阶段结束后集中验收，不用碎片化小验收冒充完成。
- 主线对话负责统一产品、前端、后端、Runtime、E2E 和交付边界。
- 临时审查或专项任务可以开短任务，但结论必须回写主线文档。

## 基线验收

`main` 合并后的基线已经通过：

- `npm test`
- `npm run build`
- `npm run test:e2e:stage2:preflight`

## 关联文档

- `REQUIREMENTS_DECISION_V1.md`
- `原始需求记录_V1.md`
- `docs\mvp-to-production-agent-architecture.md`
- `docs\stages\unified-mainline-integration-report.md`
- `docs\handoffs\TARGET_MODE_HANDOFF_TEMPLATE.md`
