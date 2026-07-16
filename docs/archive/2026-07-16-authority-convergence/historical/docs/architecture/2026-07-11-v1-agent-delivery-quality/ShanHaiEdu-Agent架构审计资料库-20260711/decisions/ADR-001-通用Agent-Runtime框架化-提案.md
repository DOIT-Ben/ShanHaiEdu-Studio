# ADR-001：通用 Agent Runtime 框架化提案

## Status

Proposed。尚未接受，不授权实施。

## Date

2026-07-11

## Context

ShanHaiEdu 当前已经具备 MainConversationAgent、ConversationControlResolver、Capability、ToolRouter、Provider Adapter、Artifact、WorkflowNode、AgentRun 和 GenerationJob 等业务骨架。

与此同时，自研运行控制链正在继续承担 Tool Loop、预算、模型协议、状态观察、计划推进和失败处理。当前 Tool Loop 默认只有一轮并阻断多个 Tool Call；Checkpoint、Interrupt/Resume、条件 Replan 和图版本恢复仍未形成完整运行主链。

项目需要支持长时间 PPT/视频生产、自然语言回跳、局部返修、人工审批、Provider 中断恢复和专业智能体协作。继续自研全部通用运行时能力，维护成本和可靠性风险已经高于其差异化价值。

## Proposed Decision

将“通用 Agent Runtime 框架化”作为候选方向：

1. 优先验证 LangGraph OSS Core 作为唯一 StateGraph 和运行编排权威源。
2. 保留 ShanHaiEdu 业务 Main Agent、ConversationControlResolver、ToolRouter、Provider Adapter、Artifact、Job、Lease、Contract、Rubric 和 FinalDeliveryGate。
3. Graph State 只保存业务引用和运行状态，不保存大型交付工件，不取代业务数据库。
4. 第一阶段不同时引入 OpenAI Agents SDK 和 Vercel Workflow SDK 的循环运行时。
5. 在隔离 Spike 通过前，不修改主线依赖和运行路径。

## Alternatives Considered

### 继续全自研

优点：完全控制、没有框架锁定。

缺点：需要继续实现 Checkpoint、Interrupt、Replay、子图、条件边、Tracing、图升级兼容和故障恢复；这些不是 ShanHaiEdu 的产品差异化能力。

当前判断：不推荐作为长期方向。

### OpenAI Agents SDK 作为唯一 Runtime Kernel

优点：Manager、Agents-as-Tools、Runner Loop、HITL 和 Tracing 完整，接入 OpenAI 体系直接。

缺点：自动业务图 Checkpoint 和 Artifact DAG 仍需自研；JavaScript SDK 当前为 0.x；复杂可编辑状态图不是最强项。

当前判断：保留为第二候选，适合偏 Agent 协作而非复杂工件图的方案。

### Vercel AI SDK + Workflow SDK

优点：Next.js 流式 UI、ToolLoopAgent、Provider 生态和 Workflow 持久步骤结合紧密。

缺点：ToolLoopAgent 自身不是 durable；Workflow SDK 仍在快速变化；一次引入 UI、Agent 和 Workflow 三层迁移面较大。

当前判断：AI SDK 可后续用于交互层；Workflow SDK 需单独版本和部署 Spike。

### LangGraph OSS Core

优点：StateGraph、条件边、循环、Checkpoint、Interrupt、Subgraph、Streaming 和 Time Travel 与当前需求直接对应；可嵌入现有 Next.js 服务端。

缺点：引入图状态和业务状态双源风险；节点副作用必须幂等；图升级和历史 Run 需要版本治理。

当前判断：首选验证候选，但尚未接受。

## Expected Consequences

若后续接受：

- ConversationTurnService 应逐步回归应用入口职责。
- PPT Director、Video Director 和 Critic 可形成独立子图。
- HumanGate 可使用框架 Interrupt 实现运行暂停，但批准事实仍写业务数据库。
- Provider 调用必须通过现有 ToolRouter，不允许框架绕过业务门禁。
- 必须新增图版本、状态版本、Prompt 版本和 Contract 版本治理。
- 必须建立 Checkpoint 与 Artifact 事务边界以及幂等恢复测试。

## Acceptance Gates

ADR 只有在以下验证全部通过后才能改为 `Accepted`：

1. 样张阶段可自然语言回跳修改叙事大纲。
2. 质量失败可局部返修，不重跑无关节点。
3. 人工暂停和进程重启后可恢复。
4. Provider 已提交时恢复不会重复提交。
5. ToolRouter、Artifact、Job、Lease 和质量门继续作为业务权威。
6. UI 事件流无重复、丢失或乱序导致的错误状态。
7. 有明确的图升级、旧 Run 处置和回退方案。

## References

- `../01-当前Main-Agent运行时审计.md`
- `../02-框架适配对比.md`
- `../03-候选接入边界与迁移风险.md`
- `../04-官方参考来源与核验状态.md`
- `../evidence/2026-07-11-代码快照证据.md`
