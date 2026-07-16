# Local Real MVP M22 Video Download Route Report

日期：2026-07-07

## 1. 阶段目标

M22 目标是把 M21 保存到 artifact metadata 的本地 MP4 变成后端可下载文件能力：当 artifact 已包含 `structuredContent.storage.videoAsset.localOutput` 时，后端 `GET /video` route 能读取 ignored `.tmp` 内的本地 MP4，返回 `video/mp4` 附件下载。

本阶段不做教师 UI 按钮、材料包视频集成、在线播放、Range 请求、生产对象存储或视频质量评分。

## 2. 本轮实现

- 新增 `src\server\video-generation\artifact-video.ts`。
- 在 `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/video` 同一路由中新增 `GET` 下载能力。
- 新增 `src\server\video-generation\__tests__\video-download-route.test.ts`。
- 下载 helper 只允许读取 `.tmp` 下的本地 MP4。
- 下载前校验 MP4 `ftyp` box。
- 下载响应使用 `video/mp4` 和附件文件名，不返回本地路径、远程 URL、task id 或 provider 响应。

## 3. 红灯记录

新增目标测试后，首次运行：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/video-generation/__tests__/video-download-route.test.ts --maxWorkers=1
```

结果：失败，3 个用例均报 `GET is not a function`。

该红灯符合预期，证明测试能捕捉“视频下载 route 尚未实现”的缺口。

## 4. 验收证据

### M22-1 视频下载 route 目标测试

命令：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/video-generation/__tests__/video-download-route.test.ts --maxWorkers=1
```

结果：通过，1 test file / 3 tests passed。

### M22-2 全量回归测试

命令：

```powershell
npm test
```

结果：通过，Node 37 tests passed；Vitest 20 files / 78 tests passed。

### M22-3 构建

命令：

```powershell
npm run build
```

结果：通过，Next.js 编译、TypeScript 和静态页面生成均通过，route 表包含：

```text
/api/workbench/projects/[projectId]/artifacts/[artifactId]/video
```

构建仍提示 1 条 Turbopack output tracing warning，指向 `artifact-video.ts` 的运行时本地文件读取。当前判断为生产准备风险，不影响本地 MVP route 可用性；进入部署准备阶段时应改为部署卷或对象存储，并复查 output tracing 配置。

## 5. 结论

M22 已完成视频后端下载 route：

- 带 `videoAsset.localOutput` 的 artifact 可以下载本地 MP4。
- 缺少视频资产的 artifact 会被拒绝。
- 指向 `.tmp` 外的路径会被拒绝。
- 下载 route 不返回 task id、远程 URL、token 或私有端点。

M22 仍不能证明：

- 教师 UI 已暴露下载按钮。
- 视频已进入最终材料包。
- 视频可在线播放或支持 Range 请求。
- 视频存储已具备生产对象存储或部署卷方案。

## 6. 下一步

推荐下一阶段做材料包视频资产集成：最终材料包在存在已生成本地视频时包含 MP4，并在 README 中继续写明视频需人工核对质量。
