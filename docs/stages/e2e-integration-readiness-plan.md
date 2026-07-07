# E2E Integration Readiness Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

本阶段不是继续修 Stage 3 多节点阻塞，也不是合并 main。当前目标是为“四分支合并前”建立一份可执行的集成验收规划，回答三个问题：

1. 当前 `feature/mvp-e2e-verification` 是否干净并与远端对齐。
2. E2E 分支已经集成 backend、frontend、runtime 的哪些能力，尚未吸收哪些新提交。
3. main 统一集成后，应该如何用 E2E 证明真实 MVP 最小闭环可用。

当前阶段成功标准：

- 只读核对 Git 状态和远端状态。
- 不合并 `main`。
- 不改其他 worktree。
- 不把 deterministic 结果描述成真实 provider 生成。
- 产出 `docs\stages\e2e-integration-readiness-plan.md` 和 `docs\stages\e2e-integration-readiness-report.md`。
- 提交并 push 到 `origin/feature/mvp-e2e-verification`，等待主 Codex 统一集成决策。

## 2. 可复用方案和当前证据

可复用能力：

- Stage 2 已有 API-backed deterministic 浏览器 E2E：
  - `scripts\run-stage2-e2e.mjs`
  - `tests\e2e\stage2-deterministic.spec.ts`
  - `tests\e2e\support\redline.ts`
- Stage 2 已证明单项目最小闭环：
  - 新建项目。
  - 输入需求。
  - deterministic 需求规格 artifact。
  - 右侧节点显示。
  - 详情查看。
  - 用户确认。
  - 刷新恢复。
  - 工程词扫描。
- Stage 3 preflight 已证明当前 E2E 分支还不能独立验多节点：
  - 缺少多节点 progressor。
  - 缺少 runtime task 到 workflow node 的最终映射。

当前只读核对命令：

```powershell
git fetch origin
git status --short --branch
git branch -vv
git log --oneline --decorate --max-count=30
git log --oneline HEAD..origin/feature/mvp-backend-workflow-lite
git log --oneline HEAD..origin/feature/mvp-frontend-api-backed-workbench
git log --oneline HEAD..origin/feature/mvp-agent-runtime-adapter
```

## 3. 已集成能力与未集成能力

当前 E2E 分支已集成：

| 主线 | 集成点 | 说明 |
| --- | --- | --- |
| main | `b0d9e8e` merge，父提交含 `975001c` | 同步阶段循环规则和治理文档 |
| Backend Workflow Lite | `ff9d5a7` merge，父提交 `a64fa55` | 集成后端状态真源、Prisma schema、项目/消息/artifact/snapshot 基础 API |
| Frontend API-backed Workbench | `2aefe6c` merge，父提交 `24e4c1b` | 集成前端数据源骨架 |
| Agent Runtime Adapter | `74f4a0a` merge，父提交 `019c409` | 集成 deterministic/openai runtime 边界和 runtime 测试 |
| E2E Verification | `7a48dd7` | 跑通 Stage 2 deterministic 最小闭环 |
| E2E Verification | `20b777f` | 记录 Stage 3 多节点阻塞 |

当前远端功能分支仍有未进入 E2E 分支的提交：

| 分支 | 未集成提交 |
| --- | --- |
| `origin/feature/mvp-backend-workflow-lite` | `6d8b9a6`、`9d74a27`、`029393f`、`81533af`、`862df42`、`ac4e9c7`、`220a1bb` |
| `origin/feature/mvp-frontend-api-backed-workbench` | `5f0cf8e`、`15c4ea5`、`720e677` |
| `origin/feature/mvp-agent-runtime-adapter` | `d28ded3`、`30dbb21` |

## 4. main 集成后下一条 E2E 主线设计

建议新阶段名称：

```text
E2E Integration Acceptance After Main Merge
```

目标：

在主 Codex 完成四分支统一集成后，E2E 主线从干净集成态验证本地 MVP 是否真的可用。

推荐验收路径：

```text
新建项目
-> 输入一句自然语言需求
-> deterministic artifact 生成
-> 右侧节点显示
-> 打开详情
-> 用户确认
-> 刷新恢复
-> 双项目隔离
-> 工程词扫描
```

验收命令建议：

```powershell
npm run build
npm test
npm run test:stage1
npm run test:e2e:integration:preflight
npm run test:e2e:integration
```

建议新增或调整的 E2E 文件：

| 文件 | 目的 |
| --- | --- |
| `scripts\e2e-integration-preflight.mjs` | 检查 main 集成后所需 API、runtime、前端数据源、隔离能力是否存在 |
| `scripts\run-integration-e2e.mjs` | 使用独立 SQLite 测试库和 API 数据源运行浏览器验收 |
| `tests\e2e\integration-main.spec.ts` | 覆盖最小闭环、刷新恢复、双项目隔离、工程词扫描 |
| `docs\stages\e2e-integration-acceptance-report.md` | 记录最终验收证据、失败归因和合并建议 |

## 5. 风险与边界

- deterministic 只能证明链路稳定，不代表真实 OpenAI provider 已可用。
- 当前 E2E 分支还没有吸收 backend/frontend/runtime 最新远端提交，不能用当前分支给最终可合并结论。
- Stage 3 多节点链路仍需要其他主线提供 workflow progressor 或明确生成 API；本阶段不重复旧阻塞，也不越界修业务。
- main 集成前不应运行“最终验收通过”口径，只能形成 readiness plan/report。

## 6. 阶段结论

本阶段只提供四分支合并前的集成验收规划和当前状态报告。完成后提交并 push，等待主 Codex 统一集成决策。
