# Main Agent 流式响应与 assistant-ui 步骤投影计划

日期：2026-07-16

状态：active implementation

## 目标

- Main Agent 的 Responses 请求使用 `stream: true`，首个教师可见文本不等待完整终态。
- 稳定静态前缀与 `prompt_cache_key`，记录 cache read/write tokens；ReAct 连续轮优先使用 `previous_response_id`。
- Tool 开始、Observation、失败步骤、reasonCode 和恢复状态按序持久化，再由现有 SSE 投影到 assistant-ui。
- Provider 原始 JSON、Tool 参数 delta 和推理内容不进入教师界面；最终 assistant 消息只提交一次。
- 教师自然语言与控制合同解耦：问候/解释/终态直接流普通文本，任务提案通过 `submit_task_brief` function call，业务选择只走原生 Tool call。
- 同一 turn 的 Tool、Observation、失败与 Artifact 形成一条紧凑实时轨迹；刷新后通过有界事件回放恢复在途步骤。

## 非目标

- 不调用真实图片、视频、PPTX、ZIP 或 V1-9 整包 Provider。
- 不创建 V1-9 manifest/runId，不重跑 R5，不跑390px。
- 不重构业务 Tool、Skill、Artifact 或发布流程。

## 实施顺序

1. 固定 GptProtocol 流式事件、usage 和 telemetry 合同。
2. 实现 Responses 流消费、缓存键、续接和终态累积。
3. 生产原生控制面直接投影普通文本；只为外层兼容路径保留结构化 JSON 正文投影，隔离所有 function-call 参数。
4. 持久化 Tool 步骤、Observation 与 Artifact 引用，通过提交后通知即时唤醒 SSE，并保留数据库轮询兜底。
5. 将同一 turn 的步骤合并为一条可恢复时间线，区分运行、失败暂停和完成状态。
6. 运行定向合同、独立 SQLite 集成、TypeScript、构建、桌面视觉复验和 diff 检查。

## 完成边界

仓内通过只证明 `contract` 与 `executor`。真实 Provider 是否返回合格流、真实缓存命中率、桌面首文本体感和连续业务轨迹仍需用户启动本地应用后验收。
