# 11 Knowledge & Evidence System 知识与证据系统

## 1. 核心职责

为 Agent 输出提供可信来源、引用、检索和证据链，避免模型把猜测包装成事实。

## 2. 核心对象

```text
SourceDocument
EvidenceRecord
Citation
KnowledgeIndex
RetrievalQuery
RetrievalResult
ConfidenceLevel
```

## 3. 设计要点

- 区分已证实、推断、不确定。
- Evidence 应记录来源、位置、时间、可信等级。
- RAG 检索要按项目、组织、权限过滤。
- 产物 metadata 应记录引用的 evidenceIds。

## 4. 参考机制

- RAG metadata filtering。
- 文献引用和数据血缘。
- 企业知识库权限检索。

## 5. 适配问题

- 业务中什么算可信来源？
- 输出哪些结论必须带证据？
- 没有证据时允许模型如何表达？
