# Local Real MVP M14 Ledger OpenAI Smoke Test Plan

日期：2026-07-07

## 1. 测试目标

M14 测试目标是验证真实 OpenAI-compatible smoke 可以复用私有台账标准环境变量，同时继续保持 M6 的缺凭据门禁和脱敏输出。

## 2. 集中验收命令

### M14-1：脚本级 env 解析与脱敏测试

命令：

```powershell
node --test tests\openai-smoke-script.test.mjs
```

通过标准：

- 无 `OPENAI_API_KEY` 和 `AGENT_BRAIN_API_KEY` 时，脚本 exit 非 0。
- stdout 包含 `missing_OPENAI_COMPATIBLE_CREDENTIAL`。
- 只设置 `AGENT_BRAIN_*` 测试变量时，脚本应选择 `agent_brain_ledger_env`。
- 设置 `AGENT_BRAIN_CHANNEL=fallback` 和 fallback 测试变量时，脚本应选择 `agent_brain_fallback_ledger_env`。
- stdout/stderr 不包含测试 key、测试 base URL 或疑似真实 key。

### M14-2：无凭据 smoke 门禁

命令：

```powershell
powershell -NoProfile -Command "$env:SHANHAI_SMOKE_SKIP_DOTENV='1'; $env:OPENAI_API_KEY=$null; $env:AGENT_BRAIN_API_KEY=$null; $env:AGENT_BRAIN_FALLBACK_API_KEY=$null; node scripts\openai-smoke.mjs"
```

通过标准：

- exit 非 0。
- 输出 `ok=false`。
- 输出 `missing_OPENAI_COMPATIBLE_CREDENTIAL`。
- 不输出密钥、token、私有端点或堆栈。

### M14-3：台账 live smoke

命令：

```powershell
node scripts\openai-smoke.mjs
```

前置条件：

- 当前 shell、项目 `.env` 或本地可信 env 已按私有台账配置固定 OpenAI-compatible 通道。

通过标准：

- exit 0。
- 输出 `ok=true`。
- 输出 `runtimeKind=openai`。
- 输出 `generationMode=model_generated`。
- 输出 `credentialSource=openai_env`、`credentialSource=agent_brain_ledger_env`、`credentialSource=agent_brain_third_ledger_env` 或 `credentialSource=agent_brain_fallback_ledger_env`。
- 不打印 key、token、账号、私有端点或模型响应全文。

### M14-4：回归测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M14-5：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma Client、Next.js 编译、TypeScript 和静态页面生成均通过。

### M14-6：提交前审查

命令：

```powershell
git diff --check
git status --short
```

通过标准：

- 无空白错误。
- `.env`、私有台账目录、密钥、token 和私有端点没有进入 git diff。
- 本轮改动只包含 M14 文档、测试、smoke 脚本和必要审计文档。

## 3. 失败处理

- 如果脚本只认 `OPENAI_*`，说明台账变量未接入，不能进入 live smoke。
- 如果脚本输出真实 key、token、私有端点或堆栈，必须先修脱敏。
- 如果 provider 返回 401、403、429、5xx、模型不存在或 Responses API 不兼容，只能记录脱敏失败类别，不把真实模型标记为通过。
- 如果 `.env` 或私有台账目录出现在 `git status` 可提交范围，必须先确认被忽略或移出提交范围。
