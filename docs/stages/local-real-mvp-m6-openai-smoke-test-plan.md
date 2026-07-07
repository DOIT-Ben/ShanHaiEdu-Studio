# Local Real MVP M6 OpenAI Smoke Test Plan

日期：2026-07-07

## 1. 测试目标

M6 测试目标是验证真实 OpenAI smoke 的执行门禁：有凭据时才能发起真实模型请求，缺凭据时必须清楚失败，不能静默使用 deterministic fallback 冒充真实 smoke。

## 2. 集中验收命令

### M6-1：缺钥匙 smoke 门禁

命令：

```powershell
node scripts\openai-smoke.mjs
```

当前本机通过标准：

- 因 `OPENAI_API_KEY` 缺失，exit 非 0。
- 输出 JSON 包含 `ok=false` 和 `missing_OPENAI_API_KEY`。
- 不输出任何密钥值。

### M6-2：单元与脚本测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- smoke 缺钥匙测试通过。
- 既有 M0-M5 合同仍通过。
- 失败数为 0。

### M6-3：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma Client、Next.js 编译、TypeScript 和静态页面生成均通过。

### M6-4：真实 OpenAI smoke

命令：

```powershell
# 先在当前 shell 设置 OPENAI_API_KEY，并按需设置 OPENAI_MODEL。
node scripts\openai-smoke.mjs
```

通过标准：

- exit 0。
- 输出 JSON 包含 `ok=true`。
- 输出 `runtimeKind=openai`。
- 输出 `generationMode=model_generated`。
- 不打印密钥。

当前状态：

- 本机缺少 `OPENAI_API_KEY`，M6-4 暂不能执行通过。

### M6-5：提交前检查

命令：

```powershell
git diff --check
git status --short
```

通过标准：

- 无空白错误。
- 只包含 M6 readiness 范围内的文档、测试和 smoke 脚本。

## 3. 失败处理

- 若无 key 时脚本 exit 0，必须修正为失败，避免 fake smoke。
- 若有 key 时返回 deterministic，必须修 runtime 创建逻辑或 smoke 判定。
- 若输出包含密钥或底层错误堆栈，必须脱敏。
- 若真实请求失败，记录 provider blocker，不将 M6 标记为通过。
