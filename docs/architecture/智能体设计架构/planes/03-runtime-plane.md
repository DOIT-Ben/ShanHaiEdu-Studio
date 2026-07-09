# Runtime Plane 执行运行平面

## 1. 定义

执行运行平面负责真正“做事”：调用模型、调用工具、访问外部 Provider、生成文件、下载文件、转换格式、打包交付物。

## 2. 负责什么

- 模型运行时：OpenAI-compatible、Gemini、Claude、本地模型等。
- 工具运行：文件解析、OCR、搜索、代码执行、数据处理。
- Provider Adapter：PPT、图片、视频、语音、邮件、工单、数据库等第三方服务。
- 文件落地：下载、保存、hash、metadata、版本记录。
- 错误分型：配置缺失、权限失败、请求失败、下载失败、格式无效、质量失败。
- 观测数据：token、耗时、bytes、sha256、外部 requestId、成本。

## 3. 不负责什么

- 不决定业务流程。
- 不宣称交付完成。
- 不直接写用户可见成功状态。
- 不读取不属于本次任务作用域的长期记忆。

## 4. 关键组件

```text
AgentRuntime
ModelAdapter
ToolRunner
ProviderAdapter
ArtifactStorage
DownloadManager
RetryPolicy
RuntimeObservation
```

## 5. 设计做法

所有外部能力都通过 Adapter：

```text
业务任务 -> ProviderAdapter.run(structuredInput)
  -> 外部服务
  -> 下载/解析/校验
  -> RuntimeObservation
  -> Artifact 或 error
```

Adapter 输出必须结构化，不能只返回自然语言。

## 6. 参考机制

- OpenCode custom tools / plugins：统一工具接口和权限。
- 云服务 SDK 适配器模式：隔离业务和 provider 差异。
- 任务队列：长任务异步运行、重试、幂等。

## 7. 验收问题

- Provider 失败是否会被错误分型？
- 文件是否真实保存并记录 metadata？
- 模型 fallback 是否被标记为 fallback，而不是伪装真实生成？
- 外部调用是否都经过权限和确认？
