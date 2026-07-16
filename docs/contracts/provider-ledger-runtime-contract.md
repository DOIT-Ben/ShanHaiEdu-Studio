# Provider 台账运行合同

状态：A20 当前合同

## 1. 权威边界

`API台账系统\manifest.json` 中每个生产能力的 `runtime_contract` 是 Provider 字段映射和发布选择的唯一权威。应用 Runtime、V1-9 Provider lock、健康 evidence 和 `production-preflight` 必须消费同一份声明；代码不能另建 purpose、channel、credential、base URL、model 或 reasoning 字段表。

可跟踪的无密钥合同 fixture 位于：

```text
tests\fixtures\provider-ledger\manifest.json
```

本机真实台账目录受 Git exclude 保护；fixture 只保存字段名和结构，不保存凭据、真实端点或健康结论。

## 2. Agent Brain

`kind=agent_brain_responses` 必须声明：

- `selected_channel_env`
- `main_agent_responses`、`critic_responses`、`fallback_responses` 到唯一 channel 的映射
- 每个 channel 的 `credential_env`、`base_url_env`、`model_env`
- reasoning 的 env、default 和 allowed values
- `endpoint_category=openai_compatible_responses`

合同缺失、未知 kind、未知 channel、重复 channel、未声明 env、缺 credential/base/model 或未知 reasoning 均失败关闭。

配置摘要使用两层带版本域的 SHA-256：先对凭据生成域隔离指纹，再把该指纹与 channel/base/model/reasoning/source/endpoint 一起生成最终 digest。凭据和中间指纹均不进入可枚举配置、日志、Provider lock 或健康 evidence；最终 digest 只用于精确识别配置版本。仅轮换凭据也必须改变 digest，使旧 lock/evidence 自动失效。

## 3. V1 媒体发布门

图片只接受 `kind=minimax_image` 声明的 `IMAGE_PROVIDER_CHANNEL=minimax`，并要求同一合同绑定的 key、base URL 和 model 全部存在。旧 primary、free 与 fallback 图片通道不能满足 V1 发布门。

TTS 只接受 `kind=minimax_tts` 声明的 `TTS_PROVIDER_MODE=minimax`，并要求同一合同绑定的 key、base URL 和 model 全部存在。未声明别名或只有共享 MiniMax key 不能冒充 TTS 就绪。

## 4. 安全输出

预检和证据只可输出合同字段名、选择结果、失败 reason code、最终配置 digest 与非敏感 provider identity。不得输出 credential、Authorization header、私有 endpoint 或可复用的 credential fingerprint。
