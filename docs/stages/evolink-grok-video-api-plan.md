# Evolink Grok Video API 接入台账计划

日期：2026-07-09

## 1. 第一性原理：当前阶段核心需求

当前视频链路已有 OTU/Omni 历史通道，但台账结论是冻结，原因是 10 并发 submit/query/download 与 MP4 artifact 校验不稳定。当前任务不是重构业务代码，而是把用户提供的新视频 API 作为可验证候选通道登记到 API 台账，并用最小真实调用证明它能生成一个视频。

本阶段核心需求：

- 明确 Evolink Grok Imagine Video API 的生产 base URL、鉴权、创建任务、查询任务、参数和结果字段。
- 将真实 key 只写入本机私有 env 区，公开台账只保留变量名和脱敏说明。
- 完成一次 6 秒、480p、文生视频 smoke，下载 MP4 并做基础 artifact 校验。
- 台账结论只放大到“候选可用”，不因单次 smoke 直接声明生产稳定。

## 2. 可复用方案调研

已复用一手来源：

- Evolink 产品页：`https://evolink.ai/zh/grok-imagine-video`
- Evolink 官方 OpenAPI 文档：`https://docs.evolink.ai/en/api-manual/video-series/grok/grok-imagine-text-to-video.md`
- Evolink 官方图生视频文档：`https://docs.evolink.ai/en/api-manual/video-series/grok/grok-imagine-image-to-video.md`
- Evolink 官方任务查询文档：`https://docs.evolink.ai/en/api-manual/task-management/get-task-detail.md`

已确认可复用能力：

- 统一鉴权：`Authorization: Bearer <EVOLINK_API_KEY>`。
- 创建任务：`POST https://api.evolink.ai/v1/videos/generations`。
- 查询任务：`GET https://api.evolink.ai/v1/tasks/{task_id}`。
- 文生视频模型：`grok-imagine-text-to-video-beta`。
- 图生视频模型：`grok-imagine-image-to-video-beta`。
- 状态：`pending`、`processing`、`completed`、`failed`。
- 结果字段：任务查询响应的 `results` 数组。

## 3. 复用、适配与必要自研

复用：

- 继续复用现有 `API台账系统` 的 provider、capability、manifest、evidence 结构。
- 继续复用私有 env 目录 `API台账系统\PRIVATE-LOCAL-SECRETS\apps-api\.env` 存放真实 key。
- 继续复用现有视频 artifact 校验口径：非空、MP4 header、可选 `ffprobe`。

适配：

- 新增 `EVOLINK_*` 环境变量，不覆盖历史 `OCTO_*`，降低回退风险。
- 将视频 provider 总状态从历史冻结调整为候选：Evolink 可作为后续默认候选，但生产放行仍需要并发和 SLA 证据。
- 将端点目录从历史 `/v1/videos` 补充 Evolink 的 `/v1/videos/generations` 与 `/v1/tasks/{task_id}`。

必要自研：

- 本阶段只自研一次性 smoke 验证脚本逻辑，不新增业务 adapter、不改前端、不改后端运行时。
- 若后续接入业务代码，再另开阶段计划和测试文档。

## 4. 落地方案、风险和验证标准

落地方案：

1. 更新 `API台账系统\providers\video-generation.md`、`capabilities\video-models.md`、`capabilities\endpoint-catalog.md`、`capabilities\parameter-reference.md`。
2. 更新 `API台账系统\manifest.json` 与 `config\shanhai-api.env.example`，加入 `EVOLINK_*` 变量。
3. 更新 `API台账系统\docs\source-traceability.md` 与 `evidence\index.md`。
4. 将真实 key 写入本机私有 env，公开文档不记录明文 key。
5. 调用子智能体执行一次真实 smoke：创建任务、轮询、下载 MP4、基础校验。
6. 更新脱敏 evidence 报告并运行台账校验。

风险：

| 风险 | 控制方式 | 回退方式 |
|---|---|---|
| key 泄露 | 公开文档只写变量名；测试输出不打印 Authorization | 删除或轮换本地私有 env 中的 key |
| 单次成功被误判为生产稳定 | 状态写 candidate，不写 wired；保留生产门槛 | 保持旧 OTU/Omni 冻结说明 |
| 结果 URL 24 小时过期 | 立即下载本地 artifact，只在报告写摘要 | 过期后重新 smoke |
| 上游偶发不可用 | 报告记录 HTTP 状态、任务状态和失败类型 | 后续做低并发重试验证 |

验证标准：

- `POST /v1/videos/generations` 返回任务 id。
- `GET /v1/tasks/{task_id}` 最终返回 `completed`。
- `results[0]` 可下载。
- 本地 MP4 文件非空且 header 可识别。
- 若本机有 `ffprobe`，能读取 duration、width、height。
- `python scripts\validate_ledger.py` 通过，公开台账不含 secret-like 值。
