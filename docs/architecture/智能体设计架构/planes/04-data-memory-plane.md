# Data & Memory Plane 数据与记忆平面

## 1. 定义

数据与记忆平面负责保存事实、状态、上下文、证据和个性化信息，让用户回来后可以连续工作，让 Agent 调用时有可靠上下文。

## 2. 负责什么

- 项目数据：项目、成员、权限、业务状态。
- 对话数据：完整 Conversation Log、assistant turn、pending action。
- 上下文数据：SessionContextSnapshot、ContextBuildLog、token 估算。
- 产物数据：Artifact、版本、文件 metadata、下载路径、质量状态。
- 记忆数据：用户偏好、项目记忆、会话摘要、组织规范。
- 证据数据：来源、引用、文档、检索结果、置信度。

## 3. 不负责什么

- 不替代质量门禁。
- 不让摘要成为唯一事实源。
- 不把临时会话偏好自动写成长期记忆。
- 不让项目 A 的记忆污染项目 B。

## 4. 记忆分层

```text
Teacher/User Profile Memory：跨项目长期偏好，可审批、可删除。
Project Memory：绑定当前项目，保存已确认目标、决策和约束。
Session Memory：当前会话临时状态，可压缩、可重建。
Procedural Memory：契约、SOP、技能、流程知识。
Organization Memory：组织模板、规范、公共素材库。
```

## 5. 上下文保存原则

```text
Conversation Log 完整保存；
SessionContextSnapshot 可替代旧历史进入模型上下文；
ContextPackage 是每轮模型输入边界；
Artifact / Workflow / Quality Gate 才是真实状态来源。
```

## 6. 参考机制

- Hermes：USER.md / MEMORY.md、写入审批、session summary。
- Mem0：user/session/org memory 与 metadata filtering。
- Letta：memory blocks、archival memory、reflection。
- LangGraph：short-term state 与 long-term store 分离。

## 7. 验收问题

- 用户回到历史项目时，完整对话和产物是否仍在？
- 模型是否只读取 scoped memory？
- 摘要是否能重建、版本化、回滚？
- 长期记忆是否有审批和删除机制？
