# Pattern 01：对话上下文与无感压缩

## 1. 要解决的问题

模型 API 通常无状态。用户感觉“它记得”，是因为应用每轮重新组装上下文。长对话如果直接全量发送，会导致成本升高、上下文溢出、关键约束丢失。

## 2. 核心原则

```text
完整历史给用户和审计；
压缩摘要给模型；
项目事实给系统；
质量状态给门禁；
长期偏好走审批。
```

## 3. 核心对象

```text
Conversation Log：完整原始消息，不因压缩删除。
SessionContextSnapshot：旧历史结构化摘要，可版本化和重建。
ContextPackage：每轮模型输入边界。
ContextBudgetManager：估算 token 和触发策略。
SessionCompactor：后台摘要生成器。
SummaryValidator：摘要质量门禁。
```

## 4. 推荐 ContextPackage

```text
system rules
+ project state
+ workflow/node state
+ active session snapshot
+ scoped project memory
+ approved user memory
+ relevant artifacts
+ relevant evidence
+ recent messages
+ current user input
+ runtime guardrails
```

## 5. 压缩触发策略

```text
< 40% context budget：不压缩。
40%-70% context budget：后台异步预压缩。
> 70% context budget：主模型调用前阻塞式压缩。
工具输出过大：生成 Tool Output Digest。
关键产物生成后：刷新项目摘要和会话摘要。
用户回到长会话前：预热 ContextPackage。
```

## 6. 摘要结构模板

```markdown
## Objective
- 当前业务目标。

## Confirmed Requirements
- 已确认约束和禁止项。

## Project Facts
- 项目事实和来源。

## Workflow State
- 节点进度、失败、待确认。

## Artifact State
- 产物 id、类型、真实文件状态、质量状态。

## User Preferences
- 会话中出现但未写入长期记忆的偏好。

## Open Decisions
- 尚待用户确认的问题。

## Next Best Actions
- 推荐下一步。

## Guardrails
- 不能违反的边界。
```

## 7. 失败策略

- 压缩失败不删除原始历史。
- 普通对话可降级到项目状态 + 最近消息 + Artifact metadata。
- 高风险交付节点若缺必要上下文，应中断并请求确认。

## 8. 参考机制

- OpenCode compaction：旧历史摘要、最近回合保留、锚定摘要更新。
- Hermes session summary。
- LangGraph checkpoint。
