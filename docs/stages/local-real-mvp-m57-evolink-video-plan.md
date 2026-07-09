# M57 Evolink Grok Imagine 视频接入计划

## 1. 核心需求

当前视频链路使用 OCTO `/v1/videos` 后任务失败，M56 只能用本地 ffmpeg 合成 MP4。M57 的核心需求是把视频 provider 切到 Evolink Grok Imagine Text-to-Video，真实请求远端视频 API，并下载一个可校验 MP4。

成功标准：`scripts/video-smoke.mjs` 能使用 Evolink 配置提交任务、轮询完成、下载 MP4，并输出 `ok: true`、`provider: video_generation`、`channel: evolink`。

## 2. 可复用方案调研

Evolink 官方文档说明：Grok Imagine Text to Video 使用 `POST /v1/videos/generations` 创建异步任务，使用 `GET /v1/tasks/{task_id}` 查询任务；鉴权为 `Authorization: Bearer YOUR_API_KEY`。请求参数包括 `model=grok-imagine-text-to-video-beta`、`prompt`、`duration`、`quality`、`mode`、`aspect_ratio`。

官方来源：

- `https://evolink.ai/zh/grok-imagine-video`
- `https://docs.evolink.ai/en/api-manual/video-series/grok/grok-imagine-text-to-video.md`
- `https://docs.evolink.ai/en/api-manual/task-management/get-task-detail.md`

## 3. 复用与适配方式

复用现有视频 smoke 与 Runtime Adapter 的异步任务流程：提交任务、提取 task id、轮询状态、提取结果 URL、下载 MP4、校验 `ftyp`。只新增 Evolink 端点构造和请求体适配，不改 Artifact 存储结构。

密钥只放本地 `.env`，不写入仓库文档、测试、提交信息或回复。

## 4. 落地方案与验证

- 增加 `EVOLINK_API_KEY` / `EVOLINK_BASE_URL` / `VIDEO_PROVIDER_MODE=evolink` 配置读取。
- Evolink 创建端点：`/v1/videos/generations`。
- Evolink 查询端点：`/v1/tasks/{task_id}`。
- Evolink 请求体：`model`、`prompt`、`duration`、`quality`、`mode`、`aspect_ratio`。
- 测试覆盖端点构造、query URL、请求体、pending 状态归一化和结果 URL 提取。
- 运行 `node scripts/video-smoke.mjs` 做真实远端验收。

风险：Grok Imagine 页面标注可能偶发不可用，且生成 6-30 秒视频；若任务失败，需要保留失败原因，不回退为 placeholder 成功。
