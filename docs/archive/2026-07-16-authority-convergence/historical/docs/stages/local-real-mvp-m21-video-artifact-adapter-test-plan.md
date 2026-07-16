# Local Real MVP M21 Video Artifact Adapter Test Plan

日期：2026-07-07

## 1. 测试目标

M21 测试目标是验证后端可以从已生成的导入视频方案 artifact 触发真实视频生成 adapter，保存一个带本地 MP4 metadata 的新 artifact，同时拒绝非视频方案 artifact，并保持 route 输出脱敏。

## 2. 集中验收命令

### M21-1：视频 artifact adapter 目标测试

命令：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/video-generation/__tests__/video-artifact-adapter.test.ts --maxWorkers=1
```

通过标准：

- 对 `intro_video_plan` artifact 调用 `/video` route 返回 200。
- route 调用 `generateVideoFromArtifact`。
- 新 artifact 标题包含“真实导入视频”。
- `structuredContent.storage.videoAsset.localOutput` 指向 `.tmp/video-artifacts/...`。
- `videoAsset` 包含 `fileName`、`bytes`、`sha256`、`mime`、`generationMode`、`sourceArtifactId`。
- route 响应不包含 `Bearer`、task id、远程视频 URL、私有端点或完整 provider 响应。
- 非 `intro_video_plan` artifact 返回 400，并且不调用 provider runner。

### M21-2：M20 smoke helper 回归

命令：

```powershell
node --test tests\video-smoke-script.test.mjs
```

通过标准：

- 视频 submit/query/download 辅助解析、MP4 校验、resume task、stuck 分类和脱敏失败输出仍通过。

### M21-3：全量回归测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M21-4：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma Client、Next.js 编译、TypeScript 和静态页面生成均通过。

### M21-5：提交前审查

命令：

```powershell
git diff --check
git check-ignore -v .env .tmp .tmp\video-artifacts
```

通过标准：

- `.env`、`.tmp` 和真实 MP4 文件不进入 git。
- 文档、测试、runner 和 route 不包含真实 key、token、私有端点、task id、远程签名 URL 或完整 provider 响应。

## 3. 失败处理

- 如果目标测试红灯不是因为 route/runner 缺失，而是测试夹具错误，先修正测试再实现。
- 如果 provider runner 单测需要真实 API，改为 route 层 mock runner；真实 live smoke 已由 M20 证明，本阶段不重复消耗视频任务。
- 如果全量测试或构建失败，先定位首个失败点，不提交半完成 adapter。
