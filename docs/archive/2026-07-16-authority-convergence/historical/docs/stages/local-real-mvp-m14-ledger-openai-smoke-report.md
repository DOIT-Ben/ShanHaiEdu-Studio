# Local Real MVP M14 Ledger OpenAI Smoke Report

日期：2026-07-07

## 1. 阶段目标

M14 目标是把 M6 的 OpenAI smoke readiness 推进为可由私有台账驱动的真实 OpenAI-compatible live smoke，并选定一个本机固定通道，供后续真实 provider 接入阶段复用。

## 2. 台账与固定通道

本阶段已参考私有 API 台账，但未摘录、提交或打印真实 key、token、账号、私有端点或 `.env` 内容。

本机脱敏矩阵结果：

| 通道 | Responses | Chat Completions | 决策 |
| --- | --- | --- | --- |
| primary | HTTP 403 | HTTP 403 | 不作为 M14 固定通道 |
| third | HTTP 403 | HTTP 403 | 不作为 M14 固定通道 |
| fallback | ok | ok | 选为 M14 固定通道 |

本项目根 `.env` 已配置为固定使用台账 fallback 通道：

- `AGENT_BRAIN_CHANNEL=fallback`
- `AGENT_BRAIN_FALLBACK_API_KEY`：present
- `AGENT_BRAIN_FALLBACK_BASE_URL`：present
- `AGENT_BRAIN_FALLBACK_MODEL`：present

`.env` 已由 `.gitignore` 忽略，不纳入提交。

## 3. 本轮实现

### 3.1 Smoke 脚本

更新 `scripts\openai-smoke.mjs`：

- 保留 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 兼容入口。
- 新增台账通道选择器 `AGENT_BRAIN_CHANNEL`，支持 `primary`、`third`、`fallback`。
- 当前固定通道为 `fallback`，输出 `credentialSource=agent_brain_fallback_ledger_env`。
- 新增 `SHANHAI_SMOKE_SKIP_DOTENV=1`，用于测试无凭据门禁时隔离本地 `.env`。
- OpenAI client 设置 `maxRetries=0` 和 smoke timeout，避免测试长时间卡住。
- 成功输出只包含 `ok`、runtime、生成模式、来源标签、模型名和摘要长度。
- 失败输出只包含脱敏错误码、来源标签和模型名，不输出底层 message、URL、响应体或堆栈。

### 3.2 测试

更新 `tests\openai-smoke-script.test.mjs`：

- 覆盖无凭据时必须失败，不能加载本地 `.env` 干扰测试。
- 覆盖只设置 `AGENT_BRAIN_*` 时可选择台账主通道标签，并且不泄露测试 key/base URL。
- 覆盖 `AGENT_BRAIN_CHANNEL=fallback` 时会选择 fallback 通道标签，并且不泄露测试 key/base URL。

## 4. 验收记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `node --test tests\openai-smoke-script.test.mjs` | 通过 | 3 tests passed |
| `node scripts\openai-smoke.mjs` | 通过 | `ok=true`、`runtimeKind=openai`、`generationMode=model_generated`、`credentialSource=agent_brain_fallback_ledger_env` |
| 无凭据门禁命令 | 按预期失败 | exit 2，输出 `missing_OPENAI_COMPATIBLE_CREDENTIAL` |
| `npm test` | 通过 | Node 17 tests passed；Vitest 16 files / 69 tests passed |
| `npm run build` | 通过 | Prisma Client 生成成功；Next.js 编译、TypeScript、静态页面生成均通过 |
| worker 残留检查 | 通过 | 未发现 Vitest、Jest 或 Playwright 残留 Node 进程 |
| `git diff --check` | 通过 | 无空白错误；仅有 Windows 换行提示 |

## 5. 风险与边界

- M14 只证明一个 OpenAI-compatible 文本模型 smoke 通道可用，不代表图片、视频、Coze PPT 或账号权限已完成。
- primary/third 当前返回 403，后续如要恢复为主备策略，必须先单独修复凭据或权限。
- 当前只是脚本级 live smoke；业务 runtime 仍需后续阶段把真实 provider 接入工作流节点。
- `.env` 是本机私有配置，不应进入 git、文档、日志、截图或聊天输出。

## 6. 审查结论

M14 通过：本项目已能从私有台账选择固定 fallback OpenAI-compatible 通道，并完成真实 live smoke。后续可以在此基础上进入 M15：PPT 样本资产 intake 与 Coze PPT API readiness。
