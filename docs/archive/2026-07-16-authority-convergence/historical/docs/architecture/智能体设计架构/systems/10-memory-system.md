# 10 Memory System 记忆系统

## 1. 核心职责

让系统具备连续性和个性化，同时防止记忆污染项目事实、节点契约和隐私边界。

## 2. 核心对象

```text
MemoryItem
MemoryScope
MemoryWriteProposal
MemoryRetrievalLog
SessionContextSnapshot
ContextPackage
MemoryApproval
```

## 3. 设计要点

- 长期偏好需要审批、删除和追溯。
- 项目记忆只绑定当前项目。
- 会话摘要服务上下文压缩，不等于长期记忆。
- 程序性记忆是 SOP / contract / skill，不应和用户偏好混写。

## 4. 参考机制

- Hermes USER/MEMORY 和写入审批。
- Mem0 user/session/org memory。
- Letta memory blocks。
- OpenCode compaction。

## 5. 适配问题

- 哪些信息值得跨项目记住？
- 哪些信息只属于当前项目？
- 记忆写入是否需要用户审批？
