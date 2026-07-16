# Local Real MVP M14 Ledger OpenAI Smoke Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M14 的核心需求不是再证明 deterministic 工作台能跑，而是把 ShanHaiEdu 的真实模型入口从“缺 key readiness”推进到“可由私有台账安装的固定 OpenAI-compatible 通道执行 live smoke”。

本阶段必须满足：

- 真实模型调用只能发生在服务端脚本或 Runtime Adapter 边界内。
- 允许复用私有 API 台账中的本地 env，但不能在代码、文档、日志、提交或回复中泄露真实 key、token、账号或私有端点。
- smoke 脚本必须能识别台账标准变量，并继续兼容既有 `OPENAI_*` 变量。
- 缺少凭据时仍必须失败，不能回落 deterministic 冒充真实模型。
- 成功证据只记录 `ok=true`、runtime 类型、生成模式、模型名和摘要长度，不记录响应全文、密钥或敏感端点。

## 2. 可复用方案调研

已参考项目内资料：

- `docs\mainlines\local-real-mvp.md`
- `docs\stages\local-real-mvp-m6-openai-smoke-plan.md`
- `docs\stages\local-real-mvp-m6-openai-smoke-report.md`
- `docs\private-api-ledger.md`

已参考私有 API 台账：

- `README.md`
- `runbooks\direct-use.md`
- `policies\secrets-and-env.md`
- `providers\agent-brain.md`
- `manifest.json`

行业与成熟方案判断：

- OpenAI-compatible provider 通过统一 SDK 或兼容 HTTP 接口接入，是文本模型 smoke 与后续 runtime adapter 的成熟做法。
- 环境变量别名映射比复制真实密钥进源码更安全，适合本地可信项目。
- smoke harness 应独立于教师 UI，避免把 provider 诊断、内部变量名或错误堆栈暴露给普通教师界面。

## 3. 复用、适配和必要自研

复用：

- 复用现有 `scripts\openai-smoke.mjs` 作为真实请求入口。
- 复用 OpenAI SDK，不把 SDK 放入 React。
- 复用 `tests\openai-smoke-script.test.mjs` 的缺 key 门禁。
- 复用 `.gitignore` 对 `.env` 和私有台账目录的忽略规则。

适配：

- 让 smoke 脚本按优先级读取：
  1. `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`
  2. 由 `AGENT_BRAIN_CHANNEL` 选择的台账通道：`primary`、`third` 或 `fallback`
- 输出中增加脱敏的 `credentialSource`，只允许 `openai_env`、`agent_brain_ledger_env`、`agent_brain_third_ledger_env` 或 `agent_brain_fallback_ledger_env`。
- 缺少 key 时输出 `missing_OPENAI_COMPATIBLE_CREDENTIAL`，并列出缺失变量名，不输出变量值。
- 有台账 `BASE_URL` 时把它作为 OpenAI-compatible `baseURL` 传给 SDK。
- 当前本机固定选择 `AGENT_BRAIN_CHANNEL=fallback`，因为脱敏矩阵显示 primary/third 均返回 403，fallback 的 Responses 和 Chat Completions 均可用。

必要自研：

- 增加脚本级测试，证明台账变量存在时脚本会选择 `agent_brain_ledger_env`，且不会把 key 或 base URL 打到 stdout/stderr。
- 增加 fallback 通道选择测试，证明 `AGENT_BRAIN_CHANNEL=fallback` 会选择 `agent_brain_fallback_ledger_env`。
- 增加缺少两组 key 的兼容测试，避免 M6 缺 key 门禁回归。
- 增加 M14 阶段报告，记录 live smoke 是否通过；若网络、凭据或 provider 失败，只记录脱敏失败状态。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M14 阶段规划和测试定义。
2. 写红灯测试：只设置 `AGENT_BRAIN_*` 时，smoke 脚本应使用台账变量源并脱敏输出。
3. 修改 `scripts\openai-smoke.mjs` 的 env 解析和 OpenAI client 初始化。
4. 安装或读取私有台账 env 到本地 `.env`，不提交 `.env`。
5. 运行 M14 集中验收。
6. 更新 M14 报告和当前状态审计。
7. 审查敏感信息、工程词暴露、OpenAI SDK 边界和 git diff。
8. 提交 M14，不 push。

主要风险：

- 私有台账 env 的目标路径与当前单体 Next.js 仓库不完全一致，可能需要本地 `.env` 映射。
- OpenAI-compatible provider 可能支持 Chat Completions 但不完整支持 Responses API；若发生，应记录为 provider compatibility blocker，不能伪造通过。
- 真实请求可能受代理、网络或 429 限制影响；失败时只记录脱敏错误分类。
- `.env` 和台账目录必须保持未跟踪状态。

验证标准：

- `node --test tests\openai-smoke-script.test.mjs` 通过。
- `node scripts\openai-smoke.mjs` 在无凭据时按预期失败且不泄密。
- 配置台账 env 后，`node scripts\openai-smoke.mjs` 若 provider 可用，应输出 `ok=true`、`runtimeKind=openai`、`generationMode=model_generated`。
- 若 live smoke 失败，报告必须说明失败类别，不把 M14 标记为真实模型通过。
- `npm test` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 敏感信息扫描未命中真实 key、token、私钥或 `.env` 内容。
