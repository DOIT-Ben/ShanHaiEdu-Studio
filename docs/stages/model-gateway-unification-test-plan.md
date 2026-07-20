# 统一模型网关迁移测试计划

更新时间：2026-07-20

## 合同测试

- JSON 凭据文件只在服务端读取，序列化结果不得包含 Key。
- 五类 capability 均解析为同一 Base URL 和各自 `MODEL_GATEWAY_*_MODEL`。
- 缺 URL 或 Key 时失败关闭，不读取旧 Provider 变量。
- 图片、视频、TTS 请求分别命中网关 OpenAI 兼容端点。
- 生产 preflight 只接受统一网关；旧台账变量不能让检查通过。

## 真实探针

- `GET /v1/models`
- `POST /v1/responses`
- `POST /v1/chat/completions`
- `POST /v1/images/generations`
- `POST /v1/audio/speech`
- `POST /v1/videos`，随后 `GET /v1/videos/:id`，完成后下载并验真 MP4

探针输出只记录状态、模型、请求 ID 是否存在、字节数和 SHA-256，不记录凭据或完整生成内容。

2026-07-20 使用更新后的同一网关凭据执行 `npx tsx scripts/model-gateway-smoke.ts`：模型列表、Agent、文本、图片、TTS、视频六项检查全部通过；视频完成后已通过 `/v1/videos/:id/content` 下载并验真 MP4。

## 回归命令

```powershell
$env:VITEST_MAX_WORKERS='1'; npm test
npm run typecheck
npm run lint
npm run build
npm run gate:development
```

## 失败判定

- 任一模型端点 4xx/5xx、超时、空产物或格式无效即失败。
- `/models` 列出模型不能替代对应能力的真实调用。
- 文本/TTS 通过不能上推为图片/视频或全网关通过。
- fixture 通过不能替代真实网关探针。
