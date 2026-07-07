# Local Real MVP M21 Video Artifact Adapter Report

日期：2026-07-07

## 1. 阶段目标

M21 目标是把 M20 已通过的服务端视频真实 API smoke 推进到后端 artifact 层：给导入视频方案 artifact 增加服务端 `/video` route，由后端调用视频 provider，下载本地 MP4，并把本地视频 metadata 保存为新的可审查 artifact。

本阶段不做教师 UI 入口、异步队列、取消、重试、材料包视频资产、在线播放或视频质量评分。

## 2. 本轮实现

- 新增 `src\server\video-generation\video-generation-run.ts`。
- 新增 `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/video`。
- 新增 `src\server\video-generation\__tests__\video-artifact-adapter.test.ts`。
- route 只允许 `intro_video_plan` artifact 触发。
- 成功后保存新的 `intro_video_plan` artifact，标题为“真实导入视频”。
- `structuredContent.storage.videoAsset` 记录本地 MP4 metadata：`localOutput`、`fileName`、`bytes`、`sha256`、`mime`、`generationMode`、`sourceArtifactId`。
- route 响应不包含 key、token、私有端点、task id、远程视频 URL 或完整 provider 响应。

## 3. 红灯记录

新增目标测试后，首次运行：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/video-generation/__tests__/video-artifact-adapter.test.ts --maxWorkers=1
```

结果：失败，原因是 `/video` route 尚不存在。

该红灯符合预期，证明测试能捕捉“视频 artifact adapter 未实现”的缺口。

## 4. 验收证据

### M21-1 视频 artifact adapter 目标测试

命令：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/video-generation/__tests__/video-artifact-adapter.test.ts --maxWorkers=1
```

结果：通过，1 test file / 2 tests passed。

### M21-2 M20 smoke helper 回归

命令：

```powershell
node --test tests\video-smoke-script.test.mjs
```

结果：通过，11 tests passed。

### M21-3 全量回归测试

命令：

```powershell
npm test
```

结果：通过，Node 37 tests passed；Vitest 19 files / 75 tests passed。

### M21-4 构建

命令：

```powershell
npm run build
```

结果：通过，Next.js route 表新增：

```text
/api/workbench/projects/[projectId]/artifacts/[artifactId]/video
```

## 5. 结论

M21 已完成视频后端 artifact adapter：

- 后端可以从导入视频方案 artifact 触发真实视频生成 runner。
- 后端可以把本地 MP4 metadata 保存到新的可审查 artifact。
- 非视频方案 artifact 会被拒绝。
- route 输出保持脱敏。

M21 仍不能证明：

- 教师 UI 已暴露真实视频生成入口。
- 视频已进入最终材料包。
- 视频可在线播放或下载 route 已完成。
- 视频生成已具备生产级队列、取消、重试、超时恢复或质量评分。

## 6. 下一步

推荐下一阶段优先做视频文件后续能力拆分：

1. 视频下载 route：只允许读取 `.tmp` 内本地 MP4，不透传远程 URL。
2. 最终材料包视频资产集成：材料包包含已生成的视频文件和 README 边界说明。
3. 教师 UI 入口：只在导入视频方案详情中显示真实生成动作，并提供长任务状态边界。
