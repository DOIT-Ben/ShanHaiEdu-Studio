# Local Real MVP M18 Image API Live Smoke Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M18 的核心需求是把“图片和视频需要接入真实 API”中的图片部分从台账 readiness 推进到真实图片 provider smoke：后端脚本能使用私有台账固定图片通道生成一张课堂视觉图，下载或解码为本地图片文件，并完成最小合法性校验。

本阶段必须满足：

- 使用私有台账中的固定 `free` 图片通道变量，不把 key、token、私有端点或远程图片 URL 写入文档、日志、提交或回复。
- 只做服务端脚本级 smoke，不把未接入 workflow 的能力暴露给教师 UI。
- 生成文件落在 `.tmp\image-smoke\`，不提交真实图片。
- 验收至少证明：真实请求成功、本地图片文件非空、PNG/JPEG 魔数合法、输出脱敏。
- 不自动 fallback 到备用通道；`primary`、`free_primary` 等通道只记录风险和后续排查，不把灰度通道误当生产主链路。

## 2. 可复用方案调研

已参考项目内资料：

- `docs\private-api-ledger.md`
- `docs\stages\local-real-mvp-m14-ledger-openai-smoke-report.md`
- `docs\stages\local-real-mvp-m16-coze-ppt-live-smoke-report.md`

已参考私有 API 台账：

- `providers\image-generation.md`
- `capabilities\image-models.md`
- `capabilities\endpoint-catalog.md`
- `policies\secrets-and-env.md`

成熟做法判断：

- OpenAI-compatible `/v1/images/generations` 是当前固定通道的成熟接口形态。
- 图片 provider 响应可能返回 `b64_json` 或 URL；本地脚本需要同时支持两种解析，但输出不能打印远程 URL。
- 图片合法性最小校验先用 PNG/JPEG 魔数和非空大小；后续 artifact adapter 阶段再加尺寸解码和工作流 slot 校验。
- 台账中的 `BASE_URL` 可能是根地址、`/v1` 地址或完整 generation endpoint；脚本必须规范拼接 endpoint，避免重复追加 `/v1`。

## 3. 复用、适配和必要自研

复用：

- 复用 M14/M16 的 provider smoke 结构：env 门禁、真实请求、下载到 `.tmp`、脱敏 JSON。
- 复用私有台账主通道变量：
  - `IMAGE_PROVIDER_MODE`
  - `IMAGE_PROVIDER_CHANNEL=free`
  - `IMAGEGEN_FREE_API_KEY`
  - `IMAGEGEN_FREE_BASE_URL`
- 复用 `.gitignore` 对 `.tmp` 和 `.env` 的保护。

适配：

- 新增 `scripts\image-smoke.mjs`。
- 脚本按 `IMAGE_PROVIDER_CHANNEL` 选择变量；M18 固定读取 `IMAGEGEN_FREE_API_KEY` 和 `IMAGEGEN_FREE_BASE_URL`。
- 脚本使用 `POST /v1/images/generations`，默认模型 `gpt-image-2`。
- prompt 使用小学数学百分数课堂视觉图场景。
- 输出只记录 `ok`、provider、channel、fileName、bytes、sha256、imageValid 和 mime，不记录远程 URL。

必要自研：

- 增加图片响应解析与图片魔数校验测试。
- 增加缺 env 门禁测试，确保不会在无凭据时伪造成功。
- 增加 M18 报告，记录 live smoke 成功或脱敏失败类别。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M18 阶段规划和测试定义。
2. 写红灯测试：缺脚本、解析和图片校验尚未实现时失败。
3. 实现 `scripts\image-smoke.mjs`。
4. 把私有台账图片固定 `free` 通道变量映射到项目根 `.env`，不提交 `.env`。
5. 运行真实图片 live smoke。
6. 运行 `npm test` 和 `npm run build`。
7. 更新 M18 报告和当前状态审计。
8. 做敏感信息扫描、`.tmp/.env` 忽略检查和 `git diff --check`。
9. 提交 M18，不 push。

主要风险：

- 图片 provider 可能不支持某些尺寸、质量或 `response_format` 参数；失败时只记录脱敏错误，不伪造通过。
- 真实生成耗时和成本高于文本 smoke；本阶段只生成 1 张低成本 smoke 图。
- 本阶段不证明图片质量适合正式课件，只证明真实 API 和本地文件链路可用。
- 后续 artifact adapter 需要加入并发、重试、slot 补位和尺寸校验。

验证标准：

- `node --test tests\image-smoke-script.test.mjs` 通过。
- `node scripts\image-smoke.mjs` live smoke 通过，输出 `ok=true`、`channel=free` 和 `imageValid=true`。
- `.tmp\image-smoke\` 中存在本地图片文件。
- `npm test` 通过。
- `npm run build` 通过。
- `.tmp`、`.env`、真实图片、远程 URL 和 token 不进入提交。
