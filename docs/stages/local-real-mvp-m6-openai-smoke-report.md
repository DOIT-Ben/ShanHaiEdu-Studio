# Local Real MVP M6 OpenAI Smoke Report

日期：2026-07-07

## 1. 阶段目标

M6 目标是建立真实 OpenAI smoke 的执行门禁：有凭据时才运行真实模型请求，缺少凭据时必须清楚失败，并且不能把 deterministic fallback 伪装为真实 OpenAI 结果。

## 2. 当前环境

本机当前检查结果：

- `OPENAI_API_KEY`：未设置。
- `OPENAI_MODEL`：未设置。
- `OPENAI_BASE_URL`：未设置。
- 仓库根目录无 `.env*` 文件。

因此本轮只完成 M6 readiness，真实 OpenAI live smoke 尚未通过。

## 3. 本轮实现

### 3.1 Smoke 脚本

新增 `scripts\openai-smoke.mjs`：

- 缺少 `OPENAI_API_KEY` 时输出 JSON：`ok=false`、`code=missing_OPENAI_API_KEY`。
- 缺少 key 时以非 0 退出，不静默回落 deterministic。
- 有 key 时使用 OpenAI SDK 调用 Responses API。
- 默认模型使用 `OPENAI_MODEL`，未设置时使用 `gpt-5.5`。
- 成功时要求输出 `runtimeKind=openai` 和 `generationMode=model_generated`。
- 不打印密钥值。

### 3.2 测试

新增 `tests\openai-smoke-script.test.mjs`：

- 清空进程内 OpenAI 相关环境变量。
- 执行 `scripts\openai-smoke.mjs`。
- 断言 exit 非 0。
- 断言 stdout 包含 `missing_OPENAI_API_KEY`。
- 断言 stdout/stderr 不包含密钥形态字符串。

## 4. 验收记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `node --test tests/openai-smoke-script.test.mjs` | 红灯后绿灯 | 脚本缺失时没有 `missing_OPENAI_API_KEY`；实现脚本后通过 |
| `node scripts/openai-smoke.mjs` | 按预期失败 | 当前环境缺少 `OPENAI_API_KEY`，输出 `missing_OPENAI_API_KEY`，未回落 deterministic |
| `npm test` | 通过 | Node 10 tests passed；Vitest 15 files / 68 tests passed |
| `npm run build` | 通过 | Prisma Client 生成成功；Next.js 编译、TypeScript、静态页面生成均通过 |
| worker 残留检查 | 通过 | 未发现 Vitest、Jest 或 Playwright 残留 Node 进程 |
| `git diff --check` | 通过 | 无空白错误 |
| M6 变更敏感信息扫描 | 通过 | 未命中密钥、token 或私钥文件特征 |

## 5. Live Smoke 状态

M6 live smoke 尚未通过，原因是本机缺少 `OPENAI_API_KEY`。后续配置凭据后运行：

```powershell
# 先在当前 shell 设置 OPENAI_API_KEY，并按需设置 OPENAI_MODEL。
node scripts\openai-smoke.mjs
```

通过标准：

- exit 0。
- 输出 `ok=true`。
- 输出 `runtimeKind=openai`。
- 输出 `generationMode=model_generated`。
- 不打印密钥。

## 6. 风险与边界

- 当前未执行真实 OpenAI 请求。
- 当前未修改 React 组件，OpenAI SDK 仍只在服务端/脚本上下文使用。
- `createAgentRuntimeFromEnv` 保留缺 key 时 deterministic fallback；M6 smoke 脚本单独禁止 fallback 冒充真实 smoke。

## 7. 审查结论

M6 readiness 通过；M6 live smoke 未通过且不得标记为完成。下一步需要配置 `OPENAI_API_KEY` 后运行 `node scripts\openai-smoke.mjs`，再决定是否进入 M7。
