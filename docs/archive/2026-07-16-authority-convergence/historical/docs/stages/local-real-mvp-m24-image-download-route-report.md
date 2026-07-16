# Local Real MVP M24 Image Download Route Report

日期：2026-07-07

## 1. 阶段目标

M24 目标是把 M19 保存到 artifact metadata 的本地图片变成后端可下载文件能力：当 artifact 已包含 `structuredContent.storage.imageAsset.localOutput` 时，后端 `GET /image` route 能读取 ignored `.tmp` 内的 PNG/JPEG，返回对应图片附件下载。

本阶段不做教师 UI 按钮、材料包图片集成、PPTX 内嵌图片、对象存储或图片质量评分。

## 2. 本轮实现

- 新增 `src\server\image-generation\artifact-image.ts`。
- 在 `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/image` 同一路由中新增 `GET` 下载能力。
- 新增 `src\server\image-generation\__tests__\image-download-route.test.ts`。
- 下载 helper 只允许读取 `.tmp` 下的本地 PNG/JPEG。
- 下载前校验 PNG/JPEG 魔数。
- 下载响应使用图片 mime 和附件文件名，不返回本地路径、远程 URL 或 provider 响应。

## 3. 红灯记录

新增目标测试后，首次运行：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/image-generation/__tests__/image-download-route.test.ts --maxWorkers=1
```

结果：失败，3 个用例均报 `GET is not a function`。

该红灯符合预期，证明测试能捕捉“图片下载 route 尚未实现”的缺口。

## 4. 验收证据

### M24-1 图片下载 route 目标测试

命令：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/image-generation/__tests__/image-download-route.test.ts --maxWorkers=1
```

结果：通过，1 test file / 3 tests passed。

### M24-2 全量回归测试

命令：

```powershell
npm test
```

结果：通过，Node 38 tests passed；Vitest 21 files / 81 tests passed。

### M24-3 构建

命令：

```powershell
npm run build
```

结果：通过，Next.js 编译、TypeScript 和静态页面生成均通过。

构建仍提示 1 条 Turbopack output tracing warning，仍指向 M22 的运行时本地视频文件读取；本轮未新增图片下载相关 warning。

## 5. 结论

M24 已完成图片后端下载 route：

- 带 `imageAsset.localOutput` 的 artifact 可以下载本地 PNG/JPEG。
- 缺少图片资产的 artifact 会被拒绝。
- 指向 `.tmp` 外的路径会被拒绝。
- 下载 route 不返回远程 URL、token 或私有端点。

M24 仍不能证明：

- 教师 UI 已暴露图片下载按钮。
- 图片已进入最终材料包。
- 图片已嵌入 PPTX。
- 图片存储已具备生产对象存储或部署卷方案。

## 6. 下一步

推荐下一阶段做材料包图片资产集成：最终材料包在存在已生成本地图片时包含图片文件，并在 README 中继续说明图片需人工核对画面内容。
