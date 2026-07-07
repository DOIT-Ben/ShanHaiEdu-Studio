# Local Real MVP M23 Material Package Video Asset Report

日期：2026-07-07

## 1. 阶段目标

M23 目标是把 M22 已可下载的本地 MP4 纳入最终材料包：当项目内存在已生成的真实导入视频 artifact 时，最终材料包 ZIP 包含该 MP4；当不存在视频 artifact 时，材料包仍按旧能力导出 Markdown 和 PPTX，不因视频缺失失败。

本阶段不做教师 UI、在线播放、Range 请求、对象存储、视频质量评分或自动把视频嵌入 PPTX。

## 2. 本轮实现

- `buildFinalMaterialPackageDownload` 增加可选 `video` 参数。
- 有视频时 ZIP 增加 `intro-video.mp4`。
- README 根据是否存在视频资产切换说明：
  - 无视频时保持“视频仍待生成或完善”的边界。
  - 有视频时说明“已包含导入视频文件”，并提醒核对视频质量、节奏和课堂锚点。
- package route 增加最新视频 artifact 查找逻辑：
  - 只从同项目 `intro_video_plan` artifacts 中选择带 `storage.videoAsset` 的产物。
  - 优先 approved，否则选择最新版本。
  - 通过 M22 `buildStoredVideoDownload` 读取本地 MP4，继续复用 `.tmp` 路径约束和 MP4 校验。

## 3. 红灯记录

新增 Node 测试后，首次运行：

```powershell
node --test tests\artifact-package-download.test.mjs
```

结果：失败，新增“包含导入视频资产”的用例未找到 `intro-video.mp4`。

该红灯符合预期，证明测试能捕捉“最终材料包尚未集成视频资产”的缺口。

## 4. 验收证据

### M23-1 材料包生成器 Node 测试

命令：

```powershell
node --test tests\artifact-package-download.test.mjs
```

结果：通过，3 tests passed。

### M23-2 材料包 route 集成测试

命令：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage13-material-package.test.ts --maxWorkers=1
```

结果：通过，1 test file / 1 test passed。

### M23-3 全量回归测试

命令：

```powershell
npm test
```

结果：通过，Node 38 tests passed；Vitest 20 files / 78 tests passed。

### M23-4 构建

命令：

```powershell
npm run build
```

结果：通过，Next.js 编译、TypeScript 和静态页面生成均通过。

构建仍提示 1 条 Turbopack output tracing warning，指向 M22 的运行时本地视频文件读取。当前判断仍为生产准备风险，不影响本地 MVP 材料包能力；进入部署准备阶段时应随存储方案一并处理。

## 5. 结论

M23 已完成最终材料包视频资产集成：

- 无视频时，材料包保持旧能力，不伪装视频完成。
- 有已生成本地视频时，材料包包含 `intro-video.mp4`。
- 视频读取继续复用 M22 的 `.tmp` 路径约束和 MP4 校验。
- README 会提示教师核对视频质量、节奏和课堂锚点。

M23 仍不能证明：

- 教师 UI 已暴露视频生成/下载/打包按钮。
- 视频可在线播放或支持 Range 请求。
- 视频质量已完成自动评分。
- 视频存储已具备生产对象存储或部署卷方案。

## 6. 下一步

推荐下一阶段转向图片后续文件能力：图片下载 route、材料包图片资产集成或 PPTX 内嵌图片；也可以先补教师 UI 入口，把已完成的真实 PPTX、图片、视频后端能力暴露为受控操作。
