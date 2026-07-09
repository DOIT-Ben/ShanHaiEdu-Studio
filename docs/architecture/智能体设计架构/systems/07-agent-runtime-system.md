# 07 Agent Runtime System 模型运行时系统

## 1. 核心职责

封装模型调用和结构化输出，让业务层不直接绑定具体模型供应商。

## 2. 核心对象

```text
ModelAdapter
AgentRuntime
RuntimeRequest
RuntimeResponse
StructuredOutputSchema
TokenUsage
CostRecord
FallbackPolicy
```

## 3. 设计要点

- 模型调用在服务端 runtime 层，不放在 UI 组件。
- 输出尽量结构化，减少自然语言解析。
- token、成本、延迟、cache usage 应观测。
- fallback 必须显式标记，不能冒充主模型成功。

## 4. 参考机制

- OpenAI-compatible API 抽象。
- JSON schema structured output。
- provider adapter / strategy pattern。

## 5. 适配问题

- 哪些任务需要强模型，哪些可用便宜模型？
- 哪些输出必须结构化？
- 模型失败时允许降级到什么程度？
