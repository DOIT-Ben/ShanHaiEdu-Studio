# 12 Quality / Guard / Governance System 质量、门禁与治理系统

## 1. 核心职责

保证 Agent 工作台不是“生成即完成”，而是“通过校验、授权和审计后才可继续或交付”。

## 2. 核心对象

```text
PlanGuard
HumanGate
ContractValidator
ArtifactValidator
EvidenceValidator
SummaryValidator
PrivacyGuard
SecurityGuard
AuditLog
FinalDeliveryGate
```

## 3. 设计要点

- 模型计划必须经过 PlanGuard。
- 高风险真实执行必须经过 HumanGate。
- Artifact 完成状态必须来自真实校验。
- Session summary 不能伪造完成状态或污染长期记忆。
- 最终交付包只包含通过门禁的真实产物。

## 4. 参考机制

- OpenCode permissions。
- CI/CD quality gate。
- 企业审计和审批流。
- 安全开发中的最小权限原则。

## 5. 适配问题

- 哪些动作属于高风险？
- 哪些产物必须机器校验，哪些必须人工确认？
- 审计日志需要满足什么合规要求？
