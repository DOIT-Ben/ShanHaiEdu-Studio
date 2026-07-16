# V1-9F Main Agent 运行诊断与恢复计划

更新时间：2026-07-13

## 1. 背景

V1-9 首次教师 UI 真实任务在 Main Agent 理解阶段失败。最小真实协议探测证明备用通道的 Responses、reasoning、严格 JSON Schema 和 function tool 均可用，但产品只返回通用“智能生成服务暂时不可用”。当前 Responses Adapter 已形成脱敏 diagnostics，Main Agent ReAct 结果却只保留 `adapter_failed`，最外层 catch 又完全吞掉异常，无法归因首请求、Agent Tool、Continuation、Schema 或空输出。

## 2. 目标

- 教师端继续只显示安全、可理解的通用失败，不泄露模型、端点、密钥或工程细节。
- 服务端记录结构化、长度受限、已脱敏的 Main Agent失败事件。
- 直接响应与 ReAct loop 都显式区分 adapter failure、空输出、解析失败和循环停止原因。
- 使用同一真实 UI 项目重试并获得可归因证据，再修真正责任层；不得通过关闭 Agent Tool loop 或改用 deterministic fallback伪装恢复。

## 3. 范围

- `MainAgentControlledReActLoopResult` 保留 adapter 的脱敏诊断文本。
- Main Agent direct response 在 parse 前检查 diagnostics。
- Main Agent统一抛出带 phase/reason 的内部错误，再映射为安全日志事件。
- `createMainConversationAgentFromEnv` 默认日志只含 phase、reason、error name 与脱敏摘要，不含 endpoint/model/credential。
- 测试覆盖 direct adapter failure、ReAct adapter failure、空输出和日志脱敏。
- 若真实诊断证明 Provider 只拒绝某个模型可见 Tool Schema，允许在 OpenAI transport 边界做兼容投影；内部 Agent Tool 合同、Router 校验、Critic 输出定位和质量门禁不得降级。

## 4. 回退与边界

- 本阶段不修改模型、强度、Tool白名单、HumanGate或业务执行路径。
- 模型可见的 Critic 调用只绑定一个真实 Artifact；细粒度 page、asset、shot、track、timeline 与 frame-range 定位仍由独立 Critic 输出，内部九类 canonical locator 合同保持不变。
- 不把内部 diagnostics 写进教师消息、Artifact、提交说明或 API 响应。
- 可独立 revert；诊断修复完成后再决定是否需要受控通道 failover。

## 5. 退出标准

- 专项测试证明两条调用路径均不再静默吞错。
- 真实 UI 重试后服务端能够给出脱敏责任阶段。
- 根据真实证据修复根因后，Main Agent形成首轮计划或合法 HumanGate，不再停在通用失败。
