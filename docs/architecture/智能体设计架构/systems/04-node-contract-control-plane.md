# 04 Node Contract Control Plane 节点契约控制系统

## 1. 核心职责

把“这个节点应该怎么做”从散落 prompt 中抽出来，变成可版本化、可审查、可发布、可回滚的业务规则。

## 2. 核心对象

```text
NodeContract
NodeContractVersion
PromptProfile
InputSchema
OutputSchema
QualityRubric
ForbiddenItems
FailurePolicy
MemoryReadPolicy
MemoryWritePolicy
ProviderPolicy
```

## 3. 设计要点

- Contract 说规则，Capability 说能力，Workflow 说顺序。
- Contract 必须有版本，Artifact 应记录使用哪个 contractVersion。
- 管理员可以编辑草稿、预览 prompt、测试运行、发布、回滚。
- Contract 不是 Memory，不能被用户偏好静默覆盖。

## 4. 参考机制

- OpenCode agents / commands / skills 文件化配置。
- JSON Schema / OpenAPI 的契约思想。
- 工作流节点输入输出规范。

## 5. 适配问题

- 哪些节点需要业务人员频繁调整？
- 每个节点的 required input 和 required output 是什么？
- 哪些 forbidden item 必须永远生效？
