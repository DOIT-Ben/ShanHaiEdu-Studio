# M65 OpenAI Responses 原生工具调用闭环集中验收收尾记录

日期：2026-07-10

## 1. 目标

M65 的目标是在 M64 `ToolRegistry` / `ToolRouter` 已建立的受控工具层之上，将 OpenAI Responses 原生 `function_call -> function_call_output -> continuation` 闭环纳入 ShanHaiEdu 后端 GPT 协议层，并确保模型只表达工具意图，真实工具执行仍由后端 `ToolRouter`、门禁、预算与观察体系控制。

## 2. 范围

本阶段纳入范围：

- 扩展 GPT Protocol 请求与响应类型，支持 `tools`、`toolChoice`、`parallelToolCalls`、`inputItems` 和结构化 `functionCalls`。
- 扩展 OpenAI Responses Adapter，透传 function tools，禁用并行工具调用，并解析 `response.output` 中的 `function_call`。
- 建立 `ToolCallIntent` 映射层，将模型产生的 function call 降级为低风险工具意图，不采信模型伪造的项目、产物、消息或 provider 参数。
- 建立 tool output 安全序列化器，将 `ToolExecutionResult` 转为可回灌给模型的教师语义 JSON 字符串。
- 建立受控 OpenAI tool-call loop runner，完成模型请求、工具意图解析、ToolRouter 执行、`function_call_output` 回灌和 continuation。
- 为 `OpenAIRuntime` 增加显式可选的 native tool loop 接线；默认 structured output 行为不变。
- 补齐协议解析、工具意图、安全回灌、loop runner、OpenAI runtime 和 M64/M63 回归测试。

## 3. 官方口径

本阶段依据 OpenAI 官方 Function Calling / Responses API 口径进行最小实现：

1. Function calling / tool calling 是模型请求应用侧功能的机制；模型产生 tool call，真实执行必须由应用代码完成。
2. Responses API 的工具调用流包含：提供 `tools` 请求模型、接收 `function_call`、应用侧执行工具、追加 `function_call_output`、再次请求模型得到最终文本或更多工具调用。
3. `response.output` 中可能出现 `type: "function_call"` 的条目，包含 `call_id`、`name` 和 JSON 字符串形式的 `arguments`。
4. 回灌工具结果时使用 `{ type: "function_call_output", call_id, output }` 追加到 continuation input。
5. strict function schema 需要收紧 object schema 边界，避免额外属性和不受控参数进入执行层。
6. M65 MVP 采用 `parallel_tool_calls: false` 和单工具受控闭环；多个工具调用在本阶段安全阻断，不定义 side effect 顺序。

M65 对应工程约束：OpenAI SDK / Responses Adapter 只负责模型协议；`ToolRouter` 负责真实工具执行；`ConversationTurnService` 的持久化、artifact truth、PlanGuard、HumanGate、Quality Gate 与预算边界不被绕过。

## 4. 提交清单

M65 阶段相关提交清单：

- `2a168ac docs: 制定M65原生工具调用规划 | v0.9.88 | 2026-07-10 08:35`
- `75f5053 docs: 收紧M65工具调用安全边界 | v0.9.89 | 2026-07-10 08:45`
- `51b32e1 feat: 扩展GPT协议工具调用解析 | v0.9.90 | 2026-07-10 09:00`
- `1675b1c feat: 建立工具调用意图与安全回灌 | v0.9.91 | 2026-07-10 09:20`
- `5792370 fix: 收紧工具回灌工程词过滤 | v0.9.92 | 2026-07-10 09:35`
- `aa5cbf1 fix: 阻断工具意图伪字段多值注入 | v0.9.93 | 2026-07-10 09:50`
- `257dcef feat: 建立OpenAI工具调用闭环Runner | v0.9.94 | 2026-07-10 10:10`
- `6956ade feat: 为OpenAIRuntime接入可选工具闭环 | v0.9.95 | 2026-07-10 10:35`

本收尾文档提交：`docs: 完成M65原生工具调用验收收尾 | v0.9.96 | 2026-07-10 11:00`。

## 5. 最终能力

M65 完成后，系统具备以下能力：

1. **协议层工具调用表达**：`GptProtocolRequest` 可携带 tools、tool choice、并行工具调用开关和 continuation input items；`GptProtocolResponse` 可返回结构化 `GptFunctionCall`。
2. **Responses Adapter function_call 解析**：OpenAI Responses 输出中的 `function_call` 会解析为 `callId`、`name`、`argumentsText`、JSON 解析状态和安全摘要；诊断摘要不保存完整 arguments。
3. **模型意图降级**：`ToolCallIntent` 只保留工具名和低风险教师意图字段；模型伪造的 `projectId`、`artifactRefs`、`sourceMessageId`、provider 参数和多值注入不会进入 `ToolRouterInput`。
4. **安全工具结果回灌**：工具执行结果回灌只暴露 `statusLabel`、`teacherSafeSummary`、`nextActionLabel`、`artifactTitle`、`artifactReadyForReview` 等教师语义字段，不回显密钥、token、本地路径、provider 细节或工程调试字段。
5. **受控 loop runner**：runner 按 `function_call -> ToolRouter -> function_call_output -> final response` 执行；限制最大工具轮次，默认禁用并行工具调用，对多工具调用、未知工具、非法 JSON 和执行异常返回安全失败。
6. **OpenAIRuntime 可选接线**：默认模型结构化输出路径不变；仅在显式提供 tools、allowlist、toolRouter 和 server-authoritative input builder 后启用 native tool loop。
7. **M64/M63 回归保持**：工具路由、对话服务、工具观察和预算测试通过，说明 M65 未回退既有 artifact truth、ToolRouter、ConversationTurnService 与 AgentHarnessBudget 边界。

## 6. 未纳入范围

本阶段明确未纳入：

- 不接入真实 MCP Client Adapter 或生产 MCP server。
- 不把所有工具一次性暴露给模型；仍以 allowlist 控制可调用工具。
- 不支持并行 tool calls；本阶段 `parallel_tool_calls: false`。
- 不迁移前端 UI，不改变教师可见工作台交互。
- 不改密钥、账号、部署、生产配置或外部服务权限。
- 不把 `ConversationTurnService` 的 artifact 持久化责任移动到 adapter / runner / router。
- 不允许模型绕过 CapabilityAvailability、PlanGuard、HumanGate、AgentHarnessBudget、Quality Gate 或 artifact truth 校验。

## 7. 验证命令与结果

集中验收命令与实际结果如下：

| 命令 | 结果 |
|---|---|
| `npx vitest run tests/gpt-protocol-adapter.test.ts tests/gpt-tool-call-intent.test.ts tests/gpt-tool-output-serializer.test.ts tests/openai-tool-loop-runner.test.ts tests/agent-runtime/openai-runtime.test.ts tests/tool-router.test.ts tests/conversation-turn-service.test.ts tests/tool-observation.test.ts tests/agent-harness-budget.test.ts --maxWorkers=1` | 通过；9 个测试文件通过，91 个测试通过，失败数 0。 |
| `npx tsc --noEmit` | 通过；命令无错误输出，exit 0。 |
| `npm run build` | 通过；`prisma generate` 成功，Next.js 生产构建成功，8 个静态页面生成完成。 |
| `graphify update .` | 通过；重建 2377 nodes、6019 edges、194 communities，更新 `graphify-out`。本次运行后 `git status --short` 无 graphify 待提交变更。 |
| `git diff --check` | 通过；无 whitespace error 输出。 |
| `git status --short` | 创建本文档前为 clean；创建本文档后仅本文档进入本轮待提交范围。 |

文档交付验证：

| 命令 | 结果 |
|---|---|
| `Get-Item docs/stages/local-real-mvp-m65-openai-native-tool-call-closeout.md` | 通过；文件存在，并显示长度与更新时间。 |
| `Get-Content -TotalCount 20 docs/stages/local-real-mvp-m65-openai-native-tool-call-closeout.md` | 通过；命令 exit 0。当前 shell 捕获的中文显示为编码乱码；专用文件读取确认 Markdown UTF-8 内容正常，标题、日期、目标和范围开头内容完整。 |

## 8. 风险与后续 M66 建议

### 8.1 残余风险

- M65 已完成协议层原生工具调用闭环，但生产级 MCP 工具生态和更多 provider 工具仍未纳入。
- 当前 loop runner 对多个 function call 采取安全阻断；后续如要支持并行或多工具链，仍需先定义 side effect 顺序、事务边界和失败回滚策略。
- OpenAIRuntime native tool loop 仍为显式可选能力，主对话链路是否全面启用还需要结合真实课程任务、工具 allowlist 和用户可见体验再评估。
- 工具输出已做教师语义 allowlist，但新增工具接入时仍必须逐项补充脱敏与工程词回归测试。
- `ConversationTurnService` 仍承担较多编排职责，M65 未进行职责拆分。

### 8.2 M66 建议

建议 M66 聚焦“原生工具闭环进入真实工作台主链路前的产品化门禁”：

1. 明确首批允许模型选择的工具 allowlist，并为每个工具补充教师可理解的调用说明、失败提示和安全回灌字段。
2. 在 `ConversationTurnService` 主链路中设计可回退的 native tool loop 开关，先对低风险内部工具灰度，不直接放开真实 provider side effect。
3. 为多轮工具调用建立更严格的 state machine：最大轮次、预算扣减、observation 记录、用户确认点和失败恢复。
4. 继续削薄 `ConversationTurnService`，将工具执行后的消息摘要、artifact 引用、观察记录和质量门禁结果写入拆到专门服务。
5. 增加真实 workbench E2E 验收：模型提出工具意图、后端执行、工具结果回灌、模型继续对话、教师可见结果不含工程词且 artifact truth 不回退。
