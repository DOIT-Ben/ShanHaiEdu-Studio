# Pattern 03：记忆、事实、契约的边界

## 1. 要解决的问题

很多 Agent 产品会把用户偏好、项目事实、系统规则、会话摘要混成一个“memory”。这会导致越权、污染和不可审计。

## 2. 必须分开的五类信息

| 类型 | 作用域 | 示例 | 写入方式 |
|---|---|---|---|
| User Profile Memory | 跨项目 | 用户偏好、语言习惯 | 审批或可撤销 |
| Project Memory | 当前项目 | 已确认目标、决策、约束 | 项目内自动或半自动 |
| Session Memory | 当前会话 | 临时状态、会话摘要 | 后台压缩生成 |
| Procedural Memory | 系统/组织 | SOP、契约、技能 | 版本化发布 |
| Evidence / Facts | 来源绑定 | 文档、引用、数据 | 来源和置信度校验 |

## 3. 禁止事项

- 不把临时会话偏好写成长期偏好。
- 不让用户偏好覆盖系统契约。
- 不让摘要决定 Artifact 真实状态。
- 不让一个项目的记忆污染另一个项目。
- 不保存密钥、敏感账号、私密路径为记忆。

## 4. 参考机制

- Hermes write approval。
- Mem0 scope + metadata filtering。
- Letta memory blocks。
- 企业权限和数据隔离模型。
