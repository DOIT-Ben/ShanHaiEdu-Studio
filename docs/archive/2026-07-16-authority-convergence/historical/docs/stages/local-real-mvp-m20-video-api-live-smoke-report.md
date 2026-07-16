# Local Real MVP M20 Video API Live Smoke Report

日期：2026-07-07

## 1. 阶段目标

M20 目标是把视频能力从私有台账 frozen 状态推进到服务端真实 smoke：脚本应使用固定视频通道完成 submit/query/download，并下载本地 MP4 做最小合法性校验。

本轮已完成脚本、测试、env 映射、真实 submit/query/download 和 MP4 `ftyp` 校验；因此 M20 可标记为“服务端视频真实 API smoke 已通过”。本阶段仍不代表视频 artifact adapter、教师 UI 入口、材料包视频集成或生产视频队列已完成。

## 2. 本轮实现

- 新增 `scripts\video-smoke.mjs`。
- 支持 `POST /v1/videos` submit。
- 支持 `GET /v1/videos/{task_id}` query。
- 支持从常见响应形态解析任务 id、任务状态和结果 URL。
- 支持下载结果 URL 并用 MP4 `ftyp` box 做最小校验。
- 支持 `VIDEO_SMOKE_TASK_ID` 或 `.tmp\video-smoke\last-task.json` 复查已有任务，避免每次排障都重复 submit。
- 支持脱敏任务状态摘要：`status`、`progress`、`hasResultUrl`。
- 将持续排队任务从泛化 timeout 收敛为 `video_task_stuck`，便于后续切换模型或 provider。
- 失败输出新增脱敏 `reason`，不打印 key、token、私有端点、任务 id、远程视频 URL 或完整 provider 响应。
- 新增 `tests\video-smoke-script.test.mjs` 覆盖脚本解析、endpoint 拼接、MP4 校验和脱敏失败输出。

## 3. 验收证据

### M20-1 脚本单元测试

命令：

```powershell
node --test tests\video-smoke-script.test.mjs
```

结果：通过，11 tests passed。

### M20-2 真实视频 live smoke

命令：

```powershell
node scripts\video-smoke.mjs
```

结果：通过。

脱敏输出摘要：

```json
{
  "ok": true,
  "provider": "video_generation",
  "channel": "octo",
  "model": "omni_flash-10s",
  "taskSource": "submit",
  "taskStatus": "completed",
  "fileName": "m20-<timestamp>-intro-video.mp4",
  "localOutput": ".tmp/video-smoke/m20-<timestamp>-intro-video.mp4",
  "bytes": 2511817,
  "sha256": "<sha256>",
  "videoValid": true,
  "mime": "video/mp4"
}
```

说明：真实任务 id、私有端点、远程结果 URL、token 和完整 provider 响应均未写入报告。

### M20-3 历史结构探针

上一轮失败时曾做一次性脱敏结构探针，只输出响应形态和状态，不输出任务 id、端点、URL 或响应全文。该证据解释了为什么本轮需要补可恢复查询和 stuck 分类。

历史结果：

```json
{
  "submitOk": true,
  "submitStatus": 200,
  "submitKeys": ["created_at", "id", "model", "object", "progress", "size", "status", "task_id"],
  "hasTaskId": true,
  "queryOk": true,
  "queryStatus": 200,
  "queryKeys": ["created_at", "id", "model", "object", "progress", "size", "status", "task_id"],
  "statusCandidates": {
    "status": "queued"
  },
  "resultUrlPaths": []
}
```

### M20-4 回归测试

命令：

```powershell
npm test
```

结果：通过，Node 37 tests passed；Vitest 18 files / 73 tests passed。

### M20-5 构建

命令：

```powershell
npm run build
```

结果：通过，Prisma Client、Next.js 编译、TypeScript 和静态页面生成均通过。

## 4. 结论

M20 当前已经证明：

- 固定视频通道 env 已可用于真实 submit。
- provider 接受任务并返回 task id。
- query endpoint 可访问。
- 视频 MP4 已生成。
- 视频 download 成功。
- MP4 `ftyp` 校验通过。
- 脚本具备可恢复查询与 stuck 分类能力，后续 provider 波动时可以复查已有任务而不是盲目重复提交。

M20 当前仍不能证明：

- 视频 artifact adapter、材料包视频资产或生产视频队列已完成。
- 视频质量已经适合课堂导入成片。
- 教师 UI 已暴露真实视频生成入口。

## 5. 风险与下一步

私有台账历史报告也显示 OTU/Omni 视频通道存在上游波动：曾多次生成有效 MP4，但单任务也可能失败或卡住；超过 8-10 分钟未完成应标记 stuck，不应让用户同步等待。

下一步建议：

1. M21 进入视频 artifact adapter 规划：只允许服务端 route 调 provider，保存本地 MP4 metadata，不把任务 id 或远程 URL 返回给前端。
2. 视频进入产品链路前必须设计后端异步队列、超时、取消、重试和人工重跑策略。
3. 后续若切换备用视频模型或 provider，必须重新做同等脱敏 smoke，不能复用本轮 `omni_flash-10s` 证据。
