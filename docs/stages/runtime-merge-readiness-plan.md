# Runtime Merge Readiness Plan

日期：2026-07-07

## 1. 当前阶段核心需求

本阶段不是继续实现 `AgentRuntime` 主线，也不是合并 `main`。当前目标是在 `feature/mvp-agent-runtime-adapter` 已完成并推送后，做合并前收口记录，给主 Codex 后续统一集成提供可审计依据。

成功标准：

- 只读核对本地分支与 `origin/feature/mvp-agent-runtime-adapter` 是否一致。
- 确认工作区只剩已排除的 `SHANHAIEDU_LEGACY_RETROSPECTIVE.md`。
- 对照 Stage 5 修复记录和指定审查线程结论，列出 `main` 合并前风险。
- 明确下一条 Runtime 主线，不超过 10 个阶段。
- 不运行真实 provider，不合并 `main`，不修改其他 worktree。
- 本阶段只新增合并准备计划与报告文档，提交并 push 到本 Runtime 分支。

关键假设：

- Runtime 功能主线已在 `v0.4.11` 收口，当前阶段只做 merge readiness。
- `SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 不是本分支交付物，继续排除。
- 真实 OpenAI provider smoke 需要显式环境配置与调用授权，本阶段不执行。
- 主 Codex 负责统一集成决策，本分支只给出风险、证据和下一主线建议。

## 2. 可复用依据与成熟方法

本阶段复用项目已建立的严格链路：

- 先写阶段计划，再写阶段报告。
- 不把一次本地通过当作闭环，必须核对远端状态。
- 审查意见必须处理或记录为风险。
- mock / deterministic / fake client 不能伪装成真实 provider 产物。
- OpenAI SDK 只允许在服务端 Runtime Adapter 边界内使用。

本阶段参考的项目内依据：

- `docs\mainlines\agent-runtime-adapter.md`
- `docs\stages\agent-runtime-stage5-review-fixes-closeout.md`
- 指定只读审查线程 `019f3924-e46f-7f20-a680-968ed38ea5e1` 的结论记录
- 当前 git 状态、分支跟踪状态和工作区未跟踪文件

可复用的工程方法：

- Merge readiness 只记录可验证事实，不重新扩大实现范围。
- 合并前风险按“是否阻塞合并”和“后续主线承接方式”拆开。
- 下一主线优先承接真实运行闭环：AgentRun、真实 provider smoke、质量门禁、队列和重试。

## 3. 复用、适配与自研边界

直接复用：

- 已完成的 `AgentRuntime` 合同。
- `DeterministicRuntime` 的稳定 draft 输出。
- `OpenAIRuntime` 的服务端 request/parse/failure 边界。
- Stage 5 质量门禁和 closeout 风险记录。
- 当前测试和 build 命令作为合并前证据口径。

需要适配：

- 后端主线的 AgentRun / Artifact / WorkflowNode 状态真源，需要在下一 Runtime 主线中正式接线。
- 真实 provider smoke 需要显式开关、预算、证据目录和停止条件。
- 结构化质量门禁需要从轻量 Markdown 字段校验升级为更稳定的任务级 schema / review result。
- 任务队列和重试策略需要与后端 Workflow Lite 或后续 durable workflow 协调。

不在本阶段自研：

- 不新增 runtime 代码。
- 不接真实 OpenAI provider。
- 不写数据库状态。
- 不写任务队列。
- 不处理 npm audit 的破坏性依赖升级。
- 不移动或删除 legacy 未跟踪文件。

## 4. 本阶段执行方案

### 4.1 只读核对

执行：

```powershell
git status --short --branch
git branch -vv
git rev-parse HEAD
git rev-parse origin/feature/mvp-agent-runtime-adapter
```

验收：

- 本地分支不 ahead / behind。
- `HEAD` 与 `origin/feature/mvp-agent-runtime-adapter` 一致。
- 未跟踪文件只允许有 `SHANHAIEDU_LEGACY_RETROSPECTIVE.md`。

### 4.2 文档产出

新增：

- `docs\stages\runtime-merge-readiness-plan.md`
- `docs\stages\runtime-merge-readiness-report.md`

报告必须覆盖：

- 当前分支和远端对齐状态。
- Stage 5 审查修复复核。
- 指定审查线程结论复核。
- 合并前风险清单。
- 下一 Runtime 主线阶段拆分。
- 本阶段未执行项和原因。

### 4.3 合并前风险分类

风险分类口径：

- Blocking：当前会阻止合并。
- Acceptable before merge：可合并但需在集成决策中明示。
- Next-mainline：不阻塞当前 Runtime merge，但必须进入下一 Runtime 主线。

需要列出的风险：

- 真实 OpenAI provider smoke 未跑。
- `npm audit` 仍有 2 个 moderate，强修会破坏性依赖变更。
- `server-only` 边界仍主要靠目录和聚合出口控制，未加编译期强护栏。
- `deterministic_draft` 必须继续被后端/前端视为 draft，不能被展示为真实模型完成。
- `SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 仍是未跟踪文件，不属于 Runtime 分支。

### 4.4 下一 Runtime 主线规划

下一主线建议命名：

```text
feature/runtime-provider-execution-hardening
```

主线目标：

把已完成的 Runtime Adapter 从“可替换生成合同”推进到“可审计真实运行闭环”，重点是 AgentRun 接线、真实 provider smoke 开关、结构化质量门禁、任务队列和重试策略。

阶段不超过 10 个，每阶段仍遵守：

```text
阶段规划文档 -> 阶段测试文档 -> 集中开发 -> 集中测试 -> 修复复测 -> 审查 -> 阶段收尾 -> 提交 -> push
```

### 4.5 验证与提交

本阶段是文档阶段，验证命令：

```powershell
git diff --check
rg -n "sk-[A-Za-z0-9_-]{20,}" docs\stages\runtime-merge-readiness-plan.md docs\stages\runtime-merge-readiness-report.md
git status --short --branch
```

提交：

```powershell
git add docs\stages\runtime-merge-readiness-plan.md docs\stages\runtime-merge-readiness-report.md
git commit -m "docs: 补充Runtime合并前收口规划 | v0.4.12 | 2026-07-07 HH:mm"
git push origin feature/mvp-agent-runtime-adapter
```

## 5. 回退方式

本阶段只新增两个文档。若主 Codex 不采用本阶段规划，可用普通 revert 回退该文档提交；不影响 Runtime 代码、测试或已完成合同。
