# Local Real MVP M16 Coze PPT Live Smoke Test Plan

日期：2026-07-07

## 1. 测试目标

M16 测试目标是验证本项目可以用 M15 fixture 调用真实 Coze PPT `/run` 通道，下载 `.pptx`，并完成最小文件合法性校验，同时全程不泄露 token 或远程下载 URL。

## 2. 集中验收命令

### M16-1：脚本单元测试

命令：

```powershell
node --test tests\coze-ppt-smoke-script.test.mjs
```

通过标准：

- 能从纯 JSON 或 Markdown fenced JSON 中解析 `pptx_url`。
- 缺少 `COZE_API_TOKEN` 或 `COZE_PPT_RUN_URL` 时脚本 exit 非 0。
- 缺 env 输出不包含 token、远程 URL 或堆栈。
- PPTX 校验能识别 zip 头和 `ppt/presentation.xml`。

### M16-2：真实 Coze PPT live smoke

命令：

```powershell
node scripts\coze-ppt-smoke.mjs
```

通过标准：

- exit 0。
- 输出 JSON 包含 `ok=true`。
- 输出 `provider=coze_ppt`。
- 输出 `channel=run`。
- 输出 `pptxValid=true`。
- 输出本地文件大小，不输出远程 `pptx_url`、token、账号或完整响应体。
- `.tmp\coze-ppt-smoke\` 中存在本轮下载的 `.pptx`。

### M16-3：回归测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M16-4：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma Client、Next.js 编译、TypeScript 和静态页面生成均通过。

### M16-5：提交前审查

命令：

```powershell
git diff --check
git status --short
```

通过标准：

- 无空白错误。
- `.tmp`、`.env`、私有台账和真实下载 PPTX 不进入 git。
- 文档、脚本和测试不包含 token、私钥、远程签名 URL 或完整 provider 响应。

## 3. 失败处理

- 如果 Coze 返回 401/403，只记录脱敏状态，不打印 token。
- 如果返回没有 `pptx_url`，记录输出契约漂移，不把 smoke 标记通过。
- 如果下载不是 PPTX，记录 `invalid_pptx_download`，不把 HTTP 200 当成功。
- 如果 live smoke 超时，记录 timeout，并保留本地 deterministic MVP 状态不变。
