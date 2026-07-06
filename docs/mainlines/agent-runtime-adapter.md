# 主线：MVP Agent Runtime Adapter

## 1. 主线目标

建立可替换的 Agent Runtime 层，让系统先用稳定的 deterministic runtime 跑通端到端，再接入 OpenAI 生成真实文本产物。

当前完成状态（2026-07-07）：

- 已完成 `AgentRuntime` 输入输出合同。
- 已完成 `DeterministicRuntime`，无 key 时可稳定生成文本 artifact draft。
- 已完成 `OpenAIRuntime` 服务端边界，OpenAI SDK 未进入 React 组件。
- 已覆盖需求规格、教材证据、教案、PPT 大纲、导入视频方案、最终交付清单。
- 已补齐任务级必备字段和轻量自检清单。
- 已用 fake client 覆盖 OpenAI request/parse/failure 边界；真实 provider smoke 仍需显式环境配置后单独执行。

## 2. 为什么单独成主线

生成能力必须和业务状态分离。OpenAI SDK / OpenAI Agents SDK 只负责规划、生成、审查和工具调用，不应成为项目、节点和产物状态真源。

## 3. 可复用方案

- `AgentRuntime` 接口。
- DeterministicRuntime：用于 E2E 稳定闭环。
- OpenAIRuntime：用于真实生成。
- 后续可扩展 Coze、图片、视频、TTS provider adapter。

## 4. 职责边界

负责：

- runtime interface。
- deterministic generator。
- OpenAI runtime。
- prompt templates。
- artifact draft 输出。
- 失败恢复信息。
- run 记录字段定义。

不负责：

- 数据库写入真源。
- 前端视觉。
- WorkflowNode 状态推进。
- provider key 暴露。
- PPTX / 视频文件真实生成。

## 5. 长期阶段

### 阶段 1：Runtime Interface 与 DeterministicRuntime

交付：

- `AgentRuntime` 类型。
- 输入输出结构。
- deterministic response。
- 节点产物 draft。
- 输出结构测试。

验收：

- 无 API key 也能跑完整 MVP 文本链路。
- deterministic 输出明确标记为测试/演示运行时，不伪装真实模型。

### 阶段 2：OpenAI Runtime

交付：

- 服务端 OpenAI runtime。
- 环境变量读取。
- prompt templates。
- 错误处理。
- AgentRun 记录。

验收：

- 有 key 时能真实生成需求规格、教案、PPT 大纲、视频方案。
- 无 key 时自动回退或明确提示，不阻塞 E2E。

### 阶段 3：节点 Prompt 与产物质量

交付：

- 需求澄清 prompt。
- 教材/教案 prompt。
- PPT 规划 prompt。
- 视频导入 prompt。
- 最终交付 prompt。

验收：

- 输出是 Markdown-first。
- 不出现工程词。
- 视频方案不提前讲知识点，只通过课程锚点回接。

### 阶段 4：Review Lite

交付：

- 轻量自检清单。
- 失败原因归一化。
- 用户可理解恢复建议。

验收：

- 模型失败不泄露堆栈。
- 产物有基本质量自检。

## 6. 测试策略

- runtime contract tests。
- deterministic golden tests。
- prompt output structure tests。
- error handling tests。
- optional real OpenAI smoke，需要显式环境配置。

## 7. 集成输入输出

输入：

- project context。
- current node。
- user message。
- approved upstream artifacts。

输出：

- assistant message。
- artifact draft markdown。
- artifact summary。
- next suggested action。
- run metadata。

## 8. 阻塞条件

- 后端未定义 AgentRun，不做真实 OpenAI 运行记录。
- Artifact draft contract 未定，不接前端展示。
- provider secret 不能进入前端或提交。
