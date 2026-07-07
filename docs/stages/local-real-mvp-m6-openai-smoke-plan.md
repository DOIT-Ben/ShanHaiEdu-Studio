# Local Real MVP M6 OpenAI Smoke Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M6 的核心需求是证明 ShanHaiEdu 可以通过服务端 Runtime Adapter 触发真实 OpenAI 模型，并且在缺少凭据时给出可理解、无敏感信息泄露的失败结果。M6 不能把 deterministic fallback 当成真实模型 smoke。

当前本机检查结果：

- `OPENAI_API_KEY`：未设置。
- `OPENAI_MODEL`：未设置。
- `OPENAI_BASE_URL`：未设置。
- 仓库根目录无 `.env*` 文件。

因此本阶段可以完成 smoke harness、缺钥匙门禁和文档化验收；真实 OpenAI 请求必须等凭据存在后再执行，不能标记为已通过。

## 2. 可复用方案调研

官方依据：

- OpenAI Responses API 是当前统一模型响应接口，适合本项目的结构化文本生成 smoke：`https://developers.openai.com/api/docs/api-reference/responses/create`
- OpenAI 最新模型指南当前推荐 `gpt-5.5` 作为默认高能力模型：`https://developers.openai.com/api/docs/guides/latest-model`

当前主线已有可复用能力：

- `src\server\agent-runtime\OpenAIRuntime` 已通过 Responses API client 适配 runtime contract。
- `src\server\agent-runtime\runtime-factory.ts` 已在存在 `OPENAI_API_KEY` 时创建 `OpenAIRuntime`，否则回落 `DeterministicRuntime`。
- `tests\agent-runtime\openai-runtime.test.ts` 已覆盖 request payload、结构化解析、缺 key fallback 和失败脱敏。

## 3. 复用、适配和必要自研

复用：

- 复用 `createAgentRuntimeFromEnv` 和 `OpenAIRuntime`，不在 React 中引入 OpenAI SDK。
- 复用 `requirement_spec` 作为 smoke task，避免真实请求消耗过多上下文。
- 复用现有 JSON schema 输出合同。

适配：

- 新增 `scripts\openai-smoke.mjs`。
- 缺少 `OPENAI_API_KEY` 时脚本输出 JSON 状态并以非 0 退出码结束，不打印密钥。
- 有 key 时脚本调用真实 runtime，要求返回 `model_generated`，否则失败。
- 模型默认使用 `OPENAI_MODEL`，未设置时使用 `gpt-5.5`。

必要自研：

- 增加脚本级缺钥匙测试，确保 smoke 不会静默 fallback 到 deterministic。
- 增加 M6 readiness 报告，明确真实请求尚未通过的原因和后续执行命令。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M6 阶段规划和测试定义。
2. 写失败测试：无 `OPENAI_API_KEY` 时 smoke 脚本应非 0 退出，并输出缺少 key 的 JSON 状态。
3. 实现 `scripts\openai-smoke.mjs`。
4. 运行缺钥匙测试和现有测试。
5. 若凭据仍缺失，记录 live smoke blocker，不标记真实请求通过。
6. 提交 M6 readiness，不 push。

主要风险：

- 默认 runtime factory 会在缺 key 时 fallback 到 deterministic；smoke 脚本必须显式拒绝这种情况。
- 真实 provider 错误不能把底层 stack、provider、local path 或密钥提示暴露给教师界面。
- 没有 key 时不能伪造通过截图或测试结果。

验证标准：

- 无 `OPENAI_API_KEY` 时，`node scripts/openai-smoke.mjs` exit 非 0，输出 `missing_OPENAI_API_KEY`，不输出密钥值。
- `npm test` 覆盖 smoke 缺钥匙测试。
- `npm run build` 通过。
- 真实 OpenAI 请求只有在 `OPENAI_API_KEY` 存在且 smoke 返回 `generationMode=model_generated` 时才可标记通过。
