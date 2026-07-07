# Local Real MVP M20 Video API Live Smoke Test Plan

日期：2026-07-07

## 1. 测试目标

M20 测试目标是验证本项目可以通过私有台账固定视频通道调用真实异步视频生成 API，完成 submit/query/download，保存一个本地 MP4，并完成最小合法性校验，同时不泄露 key、token、私有端点、任务结果 URL 或完整 provider 响应。

## 2. 集中验收命令

### M20-1：脚本单元测试

命令：

```powershell
node --test tests\video-smoke-script.test.mjs
```

通过标准：

- 能从 `id`、`task_id`、`data.id`、`data.task_id` 中解析任务 id。
- 能兼容成功、处理中和失败状态。
- 能从台账列出的 URL 字段中解析结果 URL，但不打印 URL。
- 能识别 MP4 `ftyp` box。
- 缺少所选通道需要的 API key 或 base URL 时脚本 exit 非 0。
- 缺 env 输出不包含 key、Bearer、远程 URL 或堆栈。
- 根地址、`/v1` 地址和完整 `/v1/videos` endpoint 都能被规范为正确提交 endpoint。

### M20-2：真实视频 live smoke

命令：

```powershell
node scripts\video-smoke.mjs
```

通过标准：

- exit 0。
- 输出 JSON 包含 `ok=true`。
- 输出 `provider=video_generation`。
- 输出 `videoValid=true`。
- 输出本地文件大小、sha256 和 mime。
- 不输出 key、token、私有端点、远程视频 URL、任务原始响应或完整 provider 响应。

### M20-3：回归测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M20-4：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma Client、Next.js 编译、TypeScript 和静态页面生成均通过。

### M20-5：提交前审查

命令：

```powershell
git diff --check
git check-ignore -v .env .tmp
```

通过标准：

- `.env`、`.tmp`、真实视频文件、token、远程视频 URL 不进入 git。
- 文档、脚本和测试不包含真实 key、私钥、远程签名 URL 或完整 provider 响应。

## 3. 失败处理

- 如果 submit 返回 401/403，只记录脱敏状态，不打印 key。
- 如果 query 超时或任务失败，记录 `video_task_timeout` 或 `video_task_failed`，不把 submit 成功当完成。
- 如果下载/解码不是 MP4，记录 `invalid_video_output`，不把任务成功当完成。
- 如果 live smoke 超时，记录 timeout，并保留现有 MVP 状态不变。
