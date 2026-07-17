# 私有 API 台账使用说明

项目维护者可在仓库根目录自行放置一份私有 API 台账：

```text
.\ShanHaiEdu-API-Ledger-Standalone-PRIVATE.zip
```

它用于查询 ShanHaiEdu 各环节可用的 API、模型能力、参数、可靠性证据和本地私有配置。压缩包内包含能力目录、接口资料、PPT 生成、图片、视频、TTS、LLM/Agent、可靠性策略、密钥安装脚本和环境配置示例。

使用规则：

- 需要接入 API、选择 provider、确认模型能力、写 runtime adapter、做 PPT/图片/视频/TTS 方案时，先查这份台账。
- 允许在本机只读查看或按台账说明配置本地环境变量。
- 不得把台账 zip、解压目录、密钥、token、私有端点、真实账号或本地环境文件提交到仓库。
- 不得把台账中的密钥或敏感配置写入日志、文档、提交信息、截图或回复。
- 如果需要在规划文档中引用台账，只写“已参考私有 API 台账”，不要摘录敏感内容。

安全状态：

- `ShanHaiEdu-API-Ledger-Standalone-PRIVATE.zip` 已被 `.gitignore` 忽略。
- `ShanHaiEdu-API-Ledger-Standalone/` 解压目录也必须保持忽略。
