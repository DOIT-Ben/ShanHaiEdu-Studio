# Local Real MVP M20 Video API Live Smoke Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M20 的核心需求是把“视频需要接入真实 API”从台账 frozen 状态推进到服务端真实 smoke：后端脚本能够使用私有台账固定视频通道提交一个低成本导入视频任务，轮询任务状态，下载 MP4 到本地，并完成最小文件合法性校验。

本阶段必须满足：

- 使用私有台账中的固定视频通道变量，不把 key、token、私有端点、任务结果 URL 或完整 provider 响应写入文档、日志、提交或回复。
- 只做服务端脚本级 smoke，不把未接入 workflow 的能力暴露给教师 UI。
- 生成文件落在 `.tmp\video-smoke\`，不提交真实视频。
- 验收至少证明：真实 submit 成功、query 可完成、download 得到本地 MP4、文件非空、MP4 头或 box 可识别、输出脱敏。
- 本阶段不做 10 并发 SLA、队列、取消、重试、视频 artifact adapter 或最终材料包集成。

## 2. 可复用方案调研

已参考项目内资料：

- `docs\stages\local-real-mvp-m18-image-api-live-smoke-report.md`
- `docs\stages\local-real-mvp-m19-image-artifact-adapter-report.md`
- `scripts\image-smoke.mjs`
- `src\server\image-generation\image-generation-run.ts`

已参考私有 API 台账：

- `providers\video-generation.md`
- `capabilities\video-models.md`
- `capabilities\endpoint-catalog.md`
- `capabilities\parameter-reference.md`
- `policies\storage-and-artifacts.md`

成熟做法判断：

- 视频 provider 是异步任务形态，必须拆成 submit、query、download 三段，不能把 submit 200 当成视频生成成功。
- 任务 id 字段需要兼容 `id`、`task_id`、`data.id`、`data.task_id`。
- 状态值需要兼容 `queued`、`processing`、`in_progress`、`completed`、`failed`、`SUBMITTED`、`IN_PROGRESS`、`SUCCESS`、`FAILURE`。
- 结果 URL 字段需要按台账顺序读取，但输出不能打印远程 URL。
- 最小 MP4 校验先使用非空大小和 `ftyp` box 识别；后续可补 `ffprobe` 时长、分辨率、编码校验。

## 3. 复用、适配和必要自研

复用：

- 复用 M18 的 provider smoke 结构：env 门禁、真实请求、保存到 `.tmp`、脱敏 JSON。
- 复用 M18 的 endpoint 拼接模式，兼容根地址、`/v1` 地址或完整 `/v1/videos`。
- 复用 `.gitignore` 对 `.tmp` 和 `.env` 的保护。

适配：

- 新增 `scripts\video-smoke.mjs`。
- 脚本读取 `OCTO_API_KEY`、`OCTO_BASE_URL`、`VIDEO_MODEL` 或 `OMNI_DEFAULT_MODEL`。
- 默认模型固定为 `omni_flash-10s`，默认尺寸为 `1280x720`。
- prompt 使用“六年级百分数课堂导入短片”，强调独立创意和课程锚点，不提前讲知识点。
- 输出只记录 `ok`、provider、channel、model、taskStatus、fileName、bytes、sha256、videoValid 和 mime，不记录任务 URL 或完整响应。

必要自研：

- 增加视频 submit/query 响应解析测试。
- 增加 MP4 `ftyp` box 校验测试。
- 增加缺 env 门禁和脱敏失败输出测试。
- 增加 M20 报告，记录 live smoke 成功或脱敏失败类别。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M20 阶段规划和测试定义。
2. 写红灯测试：缺脚本、响应解析、endpoint 拼接和 MP4 校验尚未实现时失败。
3. 实现 `scripts\video-smoke.mjs`。
4. 把私有台账固定视频通道变量映射到项目根 `.env`，不提交 `.env`。
5. 运行真实视频 live smoke。
6. 运行 `npm test` 和 `npm run build`。
7. 更新 M20 报告和当前状态审计。
8. 做敏感信息扫描、`.tmp/.env` 忽略检查和 `git diff --check`。
9. 提交 M20，不 push。

主要风险：

- 视频生成耗时和成本高；本阶段只提交 1 个低成本短视频任务。
- provider 可能长时间排队或返回任务失败；失败时只记录脱敏状态，不伪造通过。
- 结果 URL 可能有有效期或下载策略限制；下载失败需和任务生成失败区分。
- 本阶段不证明视频质量适合课堂导入，只证明真实 API submit/query/download 和本地文件链路可用。

验证标准：

- `node --test tests\video-smoke-script.test.mjs` 通过。
- `node scripts\video-smoke.mjs` live smoke 通过，输出 `ok=true`、`videoValid=true`。
- `.tmp\video-smoke\` 中存在本地 MP4 文件。
- `npm test` 通过。
- `npm run build` 通过。
- `.tmp`、`.env`、真实视频、远程 URL 和 token 不进入提交。
