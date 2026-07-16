# Quality & Governance Plane 质量治理平面

## 1. 定义

质量治理平面负责判断“能不能继续、能不能执行、能不能下载、能不能交付、能不能写入记忆”。它是生产型 Agent 工作台的安全和可信边界。

## 2. 负责什么

- ContractValidator：节点输出是否满足契约。
- PlanGuard：模型计划是否安全、可执行、作用域正确。
- HumanGate：高风险动作是否获得明确授权。
- ArtifactValidator：文件是否真实存在、格式正确、metadata 可验证。
- EvidenceValidator：引用和来源是否可信。
- SummaryValidator：摘要是否丢失关键约束、伪造完成状态或污染记忆。
- PrivacyGuard：敏感信息、本地路径、密钥、账号脱敏。
- AuditLog：记录谁、何时、为什么触发了什么动作。

## 3. 不负责什么

- 不直接生产内容。
- 不替代用户做业务选择。
- 不用自然语言判断高风险授权。
- 不让模型自评替代可验证校验。

## 4. 设计做法

质量门禁应贴近事实对象：

```text
计划门禁：toolPlan / actionId / riskLevel
契约门禁：structured output / required fields / forbidden items
文件门禁：bytes / hash / format / page count / duration
证据门禁：sourceId / citation / confidence
记忆门禁：scope / approval / expiry / deletion
摘要门禁：source range / preserved constraints / no false completion
```

## 5. 参考机制

- OpenCode permissions：工具权限和操作边界。
- 企业审批流：高风险操作 actionId 绑定。
- CI/CD gate：测试通过不等于发布，还要门禁。
- 合规审计：日志、追踪、权限、回滚。

## 6. 验收问题

- 模型说完成时，系统是否有事实校验？
- 高风险工具是否必须确认？
- 摘要和记忆是否会越权写入？
- 交付包是否只包含通过门禁的真实产物？
