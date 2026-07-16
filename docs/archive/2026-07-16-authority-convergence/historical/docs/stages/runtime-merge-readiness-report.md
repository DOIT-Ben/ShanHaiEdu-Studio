# Runtime Merge Readiness Report

日期：2026-07-07

## 1. 结论

`feature/mvp-agent-runtime-adapter` 当前处于合并前可审查状态。本阶段未继续实现 Runtime 代码，未运行真实 provider，未合并 `main`，未修改其他 worktree。

合并建议：

- Runtime Adapter 功能主线可进入主 Codex 统一集成决策。
- 合并前必须明示剩余风险：真实 OpenAI smoke、`npm audit`、server-only 编译期护栏、`deterministic_draft` 展示边界、legacy 未跟踪文件。
- `SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 不应随本 Runtime 分支提交或合并；若需要进入仓库，应由 `main` 或 retrospective/legacy 任务单独处理。

## 2. 只读核对结果

执行命令：

```powershell
git status --short --branch
git branch -vv
git rev-parse HEAD
git rev-parse origin/feature/mvp-agent-runtime-adapter
```

当前事实：

- 当前分支：`feature/mvp-agent-runtime-adapter`
- 跟踪远端：`origin/feature/mvp-agent-runtime-adapter`
- 本地 HEAD：`30dbb21bd4306680777f2ab05e6b14d394c5027a`
- 远端 HEAD：`30dbb21bd4306680777f2ab05e6b14d394c5027a`
- 分支状态：本地与远端一致，不 ahead，不 behind。
- 工作区未跟踪文件：`SHANHAIEDU_LEGACY_RETROSPECTIVE.md`

未跟踪文件归属：

- 该文件是初代产品系统复盘，不属于 Runtime Adapter 阶段交付。
- Stage 5 closeout 和指定审查线程均建议不纳入本 Runtime 分支。
- 本阶段继续排除，不移动、不删除、不提交。

## 3. Stage 5 修复复核

Stage 5 已处理的审查项：

- TypeScript union 收窄问题：通过 `tests\agent-runtime\test-helpers.ts` 显式收窄成功结果。
- OpenAI 输出质量门禁不足：模型输出缺少任务必备字段或 `## 自检清单` 时返回失败恢复态。
- 上游 artifact 正文丢失：OpenAI request 携带 `markdownExcerpt`，并限制长度。
- 服务端边界偏脆：`index.ts` 不再导出 `createAgentRuntimeFromEnv`，factory 需要从服务端路径显式导入。
- `tsconfig.tsbuildinfo` 构建缓存：已加入 `.gitignore`。

Stage 5 已记录的可接受风险：

- 真实 OpenAI provider smoke 未执行。
- `SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 未跟踪且不属于 Runtime 阶段。
- `npm audit` moderate 风险不在本 Runtime 合同主线内强修。

## 4. 指定审查线程结论复核

指定审查线程：

```text
019f3924-e46f-7f20-a680-968ed38ea5e1
```

结论摘录：

- P0：未发现。
- P1：未发现。
- P2：`SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 仍是未跟踪文件，不应纳入本 Runtime 分支。
- 建议：可以 push 当前 Runtime commits；不要提交未跟踪复盘文档。

本阶段处理：

- 保持 legacy 文件未跟踪，不纳入提交。
- 仅新增 merge readiness 文档。
- 等待主 Codex 统一集成决策，不在本分支执行 main merge。

## 5. main 合并前风险清单

| 风险 | 等级 | 当前状态 | 合并建议 | 后续承接 |
| --- | --- | --- | --- | --- |
| 真实 OpenAI smoke 未跑 | Acceptable before merge | 当前只覆盖 fake client、request/parse/failure 边界 | 可合并，但不能宣称真实 provider 已闭环 | 下一 Runtime 主线 Stage 2 |
| `npm audit` 2 个 moderate | Acceptable before merge | `audit fix --force` 会触发破坏性依赖变更 | 可合并，单独依赖安全任务处理 | 依赖治理或集成 hardening |
| server-only 编译期护栏不足 | Next-mainline | 当前靠 `src\server` 目录、聚合出口和扫描约束 | 可合并，但需后续加硬护栏 | 下一 Runtime 主线 Stage 1 |
| `deterministic_draft` 展示边界 | Next-mainline | Runtime 输出已标记 draft，但后端/前端集成时仍需保持教师侧区分 | 可合并，集成时必须保留 draft 标签 | 后端/前端/E2E 集成 |
| legacy 未跟踪文件 | Acceptable before merge | `SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 未跟踪 | 不纳入本分支；合并前可保持未跟踪本地状态 | retrospective/main 单独处理 |
| AgentRun 未接后端真源 | Next-mainline | Runtime 输出 metadata，不负责持久化 | 可合并，不能宣称运行记录闭环 | 下一 Runtime 主线 Stage 3 |
| 队列/重试未实现 | Next-mainline | 当前是同步 runtime 边界和失败恢复 | 可合并，长任务不应在本主线宣称完成 | 下一 Runtime 主线 Stage 5-6 |

当前未发现阻止 `feature/mvp-agent-runtime-adapter` 进入统一集成决策的 Blocking 风险。

## 6. 下一条 Runtime 主线规划

建议主线名：

```text
feature/runtime-provider-execution-hardening
```

主线目标：

把 `AgentRuntime` 从“可替换生成合同 + deterministic/OpenAI 边界”推进为“可审计真实运行闭环”。该主线不替代后端状态真源，而是与后端 AgentRun、Workflow Lite 和 Artifact contract 接线。

### Stage 1：Server-only 编译期护栏

目标：

- 给 Runtime factory、OpenAI client 创建入口和 provider secret 读取入口加服务端专用护栏。
- 防止未来 React 组件误 import 服务端 runtime factory。

交付：

- 服务端入口约束。
- import 边界测试或静态扫描脚本。
- 前端目录禁止导入 runtime factory 的回归测试。

验收：

- 前端组件无法直接拿到 OpenAI client。
- 扫描仍显示 `src\components` / `src\app` 无 OpenAI SDK 或 browser key 风险。

### Stage 2：真实 provider smoke 开关

目标：

- 建立显式真实 provider smoke 模式，不默认运行，不在 CI 误触发。
- 每次真实调用必须带预算、停止条件和证据输出。

交付：

- `RUNTIME_PROVIDER_SMOKE=1` 之类的显式开关。
- smoke 输入 fixture。
- smoke 结果记录模板。
- provider 失败的教师侧恢复文案。

验收：

- 无开关时不调用真实 provider。
- 有开关和环境配置时，只跑一条最小文本节点 smoke。
- smoke 失败不会泄露 key、provider、schema、debug、stack。

### Stage 3：AgentRun 后端接线

目标：

- Runtime 每次运行形成可持久化 run record，由后端业务层保存。
- Runtime 不自己持久化业务状态，只返回后端需要的字段。

交付：

- AgentRun request / result DTO 对齐后端主线。
- run status、startedAt、finishedAt、runtime、failureReason、artifact draft refs 字段。
- fake repository 或 contract test。

验收：

- deterministic 和 OpenAI fake client 都能生成可保存的 AgentRun 记录。
- 失败恢复也有 run status，不丢失教师可见恢复信息。

### Stage 4：结构化质量门禁

目标：

- 从 Markdown 字段轻量检查升级为任务级结构化 review result。
- 保留教师侧自然语言，不暴露 schema/debug。

交付：

- `RuntimeQualityGate` 合同。
- 每个任务的必填段落、禁止项、warning、blocking reason。
- deterministic 和 fake OpenAI 输出的质量门禁测试。

验收：

- 缺少课程锚点的视频方案不能进入 review-ready。
- 缺少教材依据的教案必须给 warning 或失败恢复。
- 质量门禁结果可被后端和前端消费。

### Stage 5：任务队列接线边界

目标：

- 定义 Runtime 与队列/Workflow Lite 的边界，避免长任务直接绑死 request/response。

交付：

- enqueue / run / complete / fail 的接口草案。
- 幂等 key 和 retry token 设计。
- 不持久化业务状态的边界说明。

验收：

- Runtime 可以被队列 worker 调用，也可以被测试直接调用。
- 失败不会自动无限重试。

### Stage 6：重试与失败恢复策略

目标：

- 定义可控重试，不把 provider 抖动暴露给教师。

交付：

- 可重试/不可重试错误分类。
- 最大重试次数和退避策略。
- 教师侧恢复动作：重试、修改输入、保留已生成内容、联系管理员。

验收：

- key/config 缺失不重试，直接给配置恢复。
- provider timeout 可按策略重试。
- 所有失败文案不出现 provider、schema、debug、key。

### Stage 7：多节点真实 smoke 阶段

目标：

- 在显式授权和配置下，从单节点 smoke 扩展到 2-3 个文本节点。

交付：

- 需求规格、教案、视频方案 smoke fixture。
- smoke 报告模板。
- 成本和停止条件记录。

验收：

- 成功时产物明确标记真实 provider 生成。
- 失败时保留 deterministic fallback 路径，不影响 E2E 稳定测试。

### Stage 8：集成与合并准备

目标：

- 把下一 Runtime 主线与后端、前端、E2E 主线对齐，准备统一集成。

交付：

- 集成 checklist。
- 风险 closeout。
- 审查记录。
- 合并建议。

验收：

- 后端 AgentRun 可保存。
- 前端能区分 deterministic draft 和真实 provider artifact。
- E2E 可选择 deterministic 模式稳定运行。
- 真实 provider smoke 结果不被伪装为生产上线。

## 7. 本阶段未执行项

- 未运行真实 OpenAI provider。
- 未合并 `main`。
- 未修改其他 worktree。
- 未删除或移动 `SHANHAIEDU_LEGACY_RETROSPECTIVE.md`。
- 未处理 `npm audit fix --force`，因为会触发破坏性依赖变更。

## 8. 等待主 Codex 决策

本阶段完成后，本分支只提供合并准备证据和下一 Runtime 主线规划。是否合并 `main`、是否启动真实 provider smoke、是否创建下一 Runtime 分支，均等待主 Codex 统一集成决策。
