# Local Real MVP M20 Video API Live Smoke Report

日期：2026-07-07

## 1. 阶段目标

M20 目标是把视频能力从私有台账 frozen 状态推进到服务端真实 smoke：脚本应使用固定视频通道完成 submit/query/download，并下载本地 MP4 做最小合法性校验。

本轮已完成脚本、测试、env 映射和真实 submit/query 探针；但 live smoke 尚未通过 download 和 MP4 校验，因此本阶段不能标记为“视频真实生成已完成”。

## 2. 本轮实现

- 新增 `scripts\video-smoke.mjs`。
- 支持 `POST /v1/videos` submit。
- 支持 `GET /v1/videos/{task_id}` query。
- 支持从常见响应形态解析任务 id、任务状态和结果 URL。
- 支持下载结果 URL 并用 MP4 `ftyp` box 做最小校验。
- 失败输出新增脱敏 `reason`，不打印 key、token、私有端点、任务 id、远程视频 URL 或完整 provider 响应。
- 新增 `tests\video-smoke-script.test.mjs` 覆盖脚本解析、endpoint 拼接、MP4 校验和脱敏失败输出。

## 3. 验收证据

### M20-1 脚本单元测试

命令：

```powershell
node --test tests\video-smoke-script.test.mjs
```

结果：通过，7 tests passed。

### M20-2 真实视频 live smoke

命令：

```powershell
node scripts\video-smoke.mjs
```

结果：未通过。

脱敏输出摘要：

```json
{
  "ok": false,
  "code": "video_smoke_failed",
  "provider": "video_generation",
  "reason": "video_task_timeout"
}
```

### M20-3 结构探针

命令：一次性脱敏结构探针，只输出响应形态和状态，不输出任务 id、端点、URL 或响应全文。

结果：

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

## 4. 结论

M20 当前只能证明：

- 固定视频通道 env 已可用于真实 submit。
- provider 接受任务并返回 task id。
- query endpoint 可访问。
- 当前任务停留在 `queued`，未在本轮窗口内返回结果 URL。

M20 当前不能证明：

- 视频 MP4 已生成。
- 视频 download 成功。
- MP4 `ftyp` 校验通过。
- 视频 artifact adapter、材料包视频资产或生产视频队列已完成。

## 5. 风险与下一步

私有台账历史报告也显示 OTU/Omni 视频通道存在上游波动：曾多次生成有效 MP4，但单任务也可能失败或卡住；超过 8-10 分钟未完成应标记 stuck，不应让用户同步等待。

下一步建议：

1. M20 继续：补 retry/stuck 状态记录，择机重跑单任务 live smoke。
2. 若单任务仍持续 queued，切换备用视频模型或 provider 做同等脱敏 smoke。
3. 视频进入产品链路前必须设计后端异步队列、超时、取消、重试和人工重跑策略。
