# Local Real MVP M16 Coze PPT Live Smoke Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M16 的核心需求是把 M15 的“PPT 样本和 Coze 环境已准备”推进到“真实 Coze PPT 服务能返回可下载 `.pptx`，并且本项目能下载到本地并校验文件合法性”。

本阶段必须满足：

- 使用 M15 固定提示词和百分数教材样本作为真实生成输入依据。
- 调用真实 Coze PPT 通道，不用本地 `pptxgenjs` 冒充 Coze 生成。
- 不把 Coze token、远程 PPTX URL、账号、私有端点或完整响应体写入日志、文档、提交或回复。
- 下载后的 PPTX 只落到本地 `.tmp`，不提交生成产物。
- 成功证据必须至少包含：真实请求成功、下载文件存在、zip 头合法、PPTX 内部核心文件存在、文件大小合理。
- 本阶段是 provider smoke，不直接暴露给教师 UI；后续再进入后端 adapter 与工作流节点接入。

## 2. 可复用方案调研

已参考项目内资料：

- `docs\stages\local-real-mvp-m15-ppt-sample-coze-readiness-report.md`
- `fixtures\ppt-sample-manifest.json`
- `tests\fixture-assets.test.mjs`

已参考私有 API 台账：

- `providers\coze-ppt.md`
- `docs\coze-ppt-api.md`
- `capabilities\ppt-generation.md`

可复用结论：

- 台账明确 Coze 官方 OpenAPI 是后端主链路，但已发布 `/run` 通道具备 20 并发证据。
- `/run` 通道能以单次 POST 返回结构化 PPTX 链接，适合作为 M16 live smoke。
- 后续生产接入仍应补 Coze OpenAPI adapter、轮询、下载转存、失败恢复和工作流节点合同。

## 3. 复用、适配和必要自研

复用：

- 复用 M15 fixture 和 manifest。
- 复用台账中 `/run` 请求形态与返回解析规则。
- 复用 `jszip` 校验 PPTX 内部结构。
- 复用 `.tmp` 作为本地生成物目录，避免提交真实生成文件。

适配：

- 新增 `scripts\coze-ppt-smoke.mjs`。
- 脚本读取 `COZE_PPT_RUN_URL` 和 `COZE_API_TOKEN`，缺失时明确失败。
- 脚本从 fixture 组装 1 页百分数主题 PPT 请求，要求返回 JSON 结构和 `.pptx` 下载链接。
- 脚本下载远程 PPTX 到 `.tmp\coze-ppt-smoke\`。
- 脚本输出脱敏 JSON，只包含 ok、通道、文件名、文件大小、校验结果，不输出远程 URL 或 token。

必要自研：

- 增加 Coze smoke 脚本的解析和校验单元测试。
- 增加缺少 env 时不能发请求的门禁测试。
- 增加 M16 报告，记录 live smoke 是否通过和产物路径边界。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M16 阶段规划和测试定义。
2. 写红灯测试：解析 fenced JSON、校验 PPTX zip、缺 env 门禁。
3. 实现 `scripts\coze-ppt-smoke.mjs`。
4. 运行脚本测试。
5. 运行真实 Coze `/run` smoke，下载 PPTX 到 `.tmp` 并校验。
6. 运行 `npm test` 和必要构建。
7. 更新 M16 报告和当前状态审计。
8. 做敏感信息扫描和 `git diff --check`。
9. 提交 M16，不 push。

主要风险：

- `/run` 是已发布通道，不等于最终后端 OpenAPI 主链路；本阶段不能宣称后端主链路已完成。
- Coze 生成耗时可能较长，脚本必须设置 deadline 和 timeout。
- Coze 返回可能是 Markdown fenced JSON、纯 JSON 或结构漂移；解析必须保守失败。
- 下载 URL 可能是签名 URL，严禁写入文档、日志或提交。
- 1 页 smoke 只证明最小真实生成，不证明完整课堂 PPT 质量。

验证标准：

- `node --test tests\coze-ppt-smoke-script.test.mjs` 通过。
- 缺 `COZE_API_TOKEN` 或 `COZE_PPT_RUN_URL` 时脚本 exit 非 0，且不泄密。
- `node scripts\coze-ppt-smoke.mjs` live smoke 通过，输出 `ok=true`。
- 下载 PPTX 文件头为 `PK`，`ppt/presentation.xml` 存在。
- `npm test` 通过。
- `npm run build` 通过。
- `.tmp` 产物、`.env` 和私有台账不进入 git。
