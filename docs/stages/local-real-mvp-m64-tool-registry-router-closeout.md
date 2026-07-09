# M64 Tool Registry / ToolRouter 集中验收收尾记录

日期：2026-07-10

## 1. 目标

M64 的目标是在 ShanHaiEdu 后端建立第一版工具注册与路由层：将现有内部能力与真实生成 provider 能力注册为稳定工具定义，通过 `ToolRouter` 统一执行入口、门禁检查、预算事件、失败观察记录和 adapter 调用，避免 `ConversationTurnService` 继续扩张工具执行分支，并为后续 M65 原生 tool call 闭环预留边界。

## 2. 范围

本阶段纳入范围：

- 建立 `ToolDefinition`、`ToolInvocation`、`ToolExecutionResult`、adapter 输入输出等工具层类型。
- 建立首批 `ToolRegistry`，支持按 toolId / capabilityId 查询，并能导出模型安全的 function tool schema。
- 建立 `Internal Capability Tool Adapter`，复用现有内部能力运行链路并映射成功、失败、质量门禁和观察记录。
- 建立 `Provider Tool Adapter`，统一 PPTX 等真实生成工具的结构化结果、artifact truth 字段和失败类型。
- 建立 `ToolRouter`，按注册表、schema、前置已确认产物、能力可用性、PlanGuard、HumanGate、预算和 adapter 顺序执行。
- 将 `ConversationTurnService` 第一批已确认工具执行路径接入 `ToolRouter`，保留外部行为不回退。
- 补齐工具注册、工具路由、内部 adapter、provider adapter、对话执行、预算和观察记录测试。

## 3. 提交清单

M64 阶段相关提交清单：

- `0d522ac docs: 制定M64工具层实施计划 | v0.9.76 | 2026-07-10 00:05`
- `65a92b3 feat: 建立工具定义与注册表 | v0.9.77 | 2026-07-10 00:20`
- `8986c66 fix: 修正M64工具注册边界 | v0.9.77 | 2026-07-10 00:35`
- `15a03dc fix: 加强M64工具Schema边界 | v0.9.78 | 2026-07-10 00:50`
- `6922f1e feat: 接入内部能力工具适配器 | v0.9.79 | 2026-07-10 01:10`
- `2525517 fix: 修正内部工具阻断观察记录 | v0.9.80 | 2026-07-10 01:25`
- `1cfaad5 feat: 接入Provider工具适配器 | v0.9.81 | 2026-07-10 01:45`
- `a291551 fix: 补齐Provider工具质量门禁结果 | v0.9.82 | 2026-07-10 02:05`
- `142358c feat: 建立工具路由核心 | v0.9.83 | 2026-07-10 02:25`
- `556d9fc fix: 收紧Provider工具前置材料校验 | v0.9.84 | 2026-07-10 02:40`
- `1790683 feat: 对话执行接入工具路由 | v0.9.85 | 2026-07-10 03:00`
- `6bafea6 fix: 保留PPTX路由项目上下文与生成任务 | v0.9.86 | 2026-07-10 03:25`

本收尾文档提交：`docs: 完成M64工具路由验收收尾 | v0.9.87 | 2026-07-10 03:50`。

## 4. 最终能力

M64 完成后，工具层具备以下能力：

1. **注册化**：内部能力和 provider 能力通过稳定 toolId 注册，不再依赖散落的临时分支识别。
2. **模型安全投影**：工具定义可导出为安全的 function schema，避免暴露 provider、存储、调试、密钥或本地路径语义。
3. **统一路由**：`ToolRouter` 负责查找工具、校验参数、检查前置产物、检查能力可用性、执行门禁和预算，再委派 adapter。
4. **内部能力适配**：内部能力成功时返回结构化工具结果；失败、阻断、质量门禁失败时返回 `ToolObservation`，且不创建假产物。
5. **Provider 适配**：真实生成工具以结构化 result 表达 artifact truth、字节数、摘要、质量门禁和失败类别，失败不保存伪产物。
6. **预算与观察复用**：继续复用 M63 `AgentHarnessBudget` 与 `ToolObservation`，工具成功、失败、重试耗尽均可追踪。
7. **对话主链路收束**：`ConversationTurnService` 第一批执行路径通过 router 进入工具层，减少继续把 capability/provider 分支写入主服务的风险。

## 5. 未纳入范围

本阶段明确未纳入：

- 不接入真实 MCP client 或 MCP server。
- 不实现 OpenAI Responses 原生 `function_call_output` 多轮回灌闭环。
- 不允许 GPT tool_call 绕过 PlanGuard、HumanGate、CapabilityAvailability、AgentHarnessBudget 或 Quality Gate。
- 不把尚未真实接通的能力伪装为可执行真实工具。
- 不重写 workflow engine、ArtifactStorage、ProviderAdapter 或前端 UI。
- 不在教师可见内容、文档或提交中写入密钥、账号、token、外部任务标识或本地绝对输出路径。

## 6. 验证命令与结果

集中验收命令与实际结果如下：

| 命令 | 结果 |
|---|---|
| `npx vitest run tests/tool-registry.test.ts tests/tool-router.test.ts tests/internal-capability-tool-adapter.test.ts tests/provider-tool-adapter.test.ts tests/conversation-turn-service.test.ts tests/agent-harness-budget.test.ts tests/tool-observation.test.ts --maxWorkers=1` | 通过；7 个测试文件通过，77 个测试通过，失败数 0。 |
| `npx tsc --noEmit` | 通过；命令无错误输出，exit 0。 |
| `npm run build` | 通过；`prisma generate` 成功，Next.js 生产构建成功，8 个静态页面生成完成。 |
| `graphify update .` | 通过；重建 2339 nodes、5952 edges、190 communities，更新 `graphify-out`。本次运行后未产生待提交变更。 |
| `git diff --check` | 通过；无 whitespace error 输出。 |
| `git status --short` | 在创建本文档前为 clean；创建本文档后仅本文档为新增待提交文件。 |

文档交付验证：

| 命令 | 预期 |
|---|---|
| `Get-Item docs/stages/local-real-mvp-m64-tool-registry-router-closeout.md` | 应显示本文档存在、大小和时间信息。 |
| `Get-Content -TotalCount 20 docs/stages/local-real-mvp-m64-tool-registry-router-closeout.md` | 应显示标题、日期、目标和范围开头内容。 |

## 7. 风险与后续 M65 建议

### 7.1 残余风险

- 当前 M64 只完成第一批工具注册与路由，尚未覆盖完整 MCP 工具生态。
- 原生 OpenAI Responses tool call 回灌循环尚未接入，后续仍需定义 `ToolCallIntent`、`function_call_output` 和 continuation 策略。
- Provider 工具仍依赖既有真实生成链路的可用性和质量门禁，外部服务不可用时仍会按失败观察记录处理。
- `ConversationTurnService` 已经承担较多职责，M64 只完成首批执行路径收束，后续仍需继续削薄主服务。

### 7.2 M65 建议

建议 M65 聚焦“原生 tool_call 闭环与 MCP 边界预备”：

1. 建立 `ToolCallIntent`，将 OpenAI Responses function call 与内部 tool invocation 解耦。
2. 定义 `function_call_output` 回灌规则：只回传 teacher-safe summary、结构化状态和必要 artifact 引用，不回传敏感细节。
3. 为 MCP client adapter 写接口和测试桩，但仍先不接生产 MCP server，避免扩大外部写入面。
4. 继续削薄 `ConversationTurnService`，将工具执行后的消息摘要、artifact 引用和观察记录写入拆到专门服务。
5. 增加端到端级别验收：模型提出工具意图、router 执行、observation 回灌、模型继续对话、用户可见结果无工程词泄露。
