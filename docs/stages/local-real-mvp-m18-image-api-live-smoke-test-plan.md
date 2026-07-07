# Local Real MVP M18 Image API Live Smoke Test Plan

日期：2026-07-07

## 1. 测试目标

M18 测试目标是验证本项目可以通过私有台账固定 `free` 图片通道调用真实 OpenAI-compatible 图片生成 API，保存一张本地图片，并完成最小合法性校验，同时不泄露 key、token、私有端点或远程图片 URL。

## 2. 集中验收命令

### M18-1：脚本单元测试

命令：

```powershell
node --test tests\image-smoke-script.test.mjs
```

通过标准：

- 能解析 `b64_json` 图片响应。
- 能解析 URL 图片响应但不打印 URL。
- PNG/JPEG 魔数校验正确。
- 缺少所选通道需要的 API key 或 base URL 时脚本 exit 非 0。
- 缺 env 输出不包含 key、Bearer、远程 URL 或堆栈。
- `IMAGE_PROVIDER_CHANNEL=free` 时读取 `IMAGEGEN_FREE_API_KEY` 和 `IMAGEGEN_FREE_BASE_URL`，失败输出包含 `channel=free` 但不泄露变量值。
- 根地址、`/v1` 地址和完整 generation endpoint 都能被规范为正确的图片生成 endpoint。

### M18-2：真实图片 live smoke

命令：

```powershell
node scripts\image-smoke.mjs
```

通过标准：

- exit 0。
- 输出 JSON 包含 `ok=true`。
- 输出 `provider=image_generation`。
- 输出 `channel=free`。
- 输出 `imageValid=true`。
- 输出本地文件大小、sha256 和 mime。
- 不输出 key、token、私有端点、远程图片 URL 或完整 provider 响应。

### M18-3：回归测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M18-4：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma Client、Next.js 编译、TypeScript 和静态页面生成均通过。

### M18-5：提交前审查

命令：

```powershell
git diff --check
git status --short
```

通过标准：

- `.env`、`.tmp`、真实图片文件、token、远程图片 URL 不进入 git。
- 文档、脚本和测试不包含真实 key、私钥、远程签名 URL 或完整 provider 响应。

## 3. 失败处理

- 如果 provider 返回 401/403，只记录脱敏状态，不打印 key。
- 如果返回没有 `b64_json` 或 URL，记录输出契约漂移，不把 smoke 标记通过。
- 如果下载/解码不是 PNG/JPEG，记录 `invalid_image_output`，不把 HTTP 200 当成功。
- 如果 live smoke 超时，记录 timeout，并保留现有 MVP 状态不变。
