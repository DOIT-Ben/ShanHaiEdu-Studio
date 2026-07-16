# Pattern 02：节点契约控制

## 1. 要解决的问题

如果节点规则只写在 prompt 或业务代码里，系统会很快变成不可维护的 prompt 堆。节点契约把规则抽象成可治理对象。

## 2. 契约应包含什么

```text
id / version / displayName
purpose
inputs.required / inputs.optional
outputs.schema / requiredSections
controls
constraints
forbidden
qualityRubric
failurePolicy
memoryReadPolicy
memoryWritePolicy
providerPolicy
teacher/userVisibleProjection
```

## 3. 生命周期

```text
draft -> schema validation -> prompt preview -> test run -> publish -> runtime use -> rollback
```

## 4. 与其他对象的关系

```text
Capability：系统会做什么。
NodeContract：这个能力怎么做、怎样算合格。
Workflow：能力按什么顺序运行。
Artifact：运行结果是什么。
QualityGate：结果能不能通过。
```

## 5. 参考机制

- OpenCode agents / commands / skills 文件化。
- OpenAPI / JSON Schema 的契约思想。
- CI/CD 配置版本化和回滚。
