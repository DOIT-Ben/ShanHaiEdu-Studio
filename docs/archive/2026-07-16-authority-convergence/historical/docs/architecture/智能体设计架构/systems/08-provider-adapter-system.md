# 08 Provider Adapter System 外部 Provider 适配系统

## 1. 核心职责

封装第三方服务和本地工具，让业务系统只面对统一的结构化输入输出。

## 2. 核心对象

```text
ProviderAdapter
ProviderConfig
ProviderRun
ProviderObservation
DownloadResult
ValidationResult
ErrorCategory
```

## 3. 设计要点

- 外部服务必须经过 Adapter，不允许业务层散落 SDK 调用。
- Adapter 要处理下载、格式校验、重试、错误分型。
- 高风险外部写入必须走 HumanGate。
- Provider 不可用时应返回可诊断错误，而不是伪造成功。

## 4. 参考机制

- 支付、短信、对象存储等 provider adapter 模式。
- OpenCode tools / plugins。
- 云服务 requestId 和错误码归一化。

## 5. 适配问题

- 业务依赖哪些外部服务？
- 哪些服务只读，哪些会外部写入？
- 每类服务的真实成功标准是什么？
