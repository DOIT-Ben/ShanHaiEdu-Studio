# Local Real MVP M24 Image Download Route Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M24 的核心需求是把 M19 保存到 artifact metadata 的本地图片变成可由后端安全下载的文件能力：当 artifact 已包含 `structuredContent.storage.imageAsset.localOutput` 时，后端 `GET /image` route 能读取 ignored `.tmp` 内的 PNG/JPEG，返回对应图片附件下载。

本阶段必须满足：

- 只读取本项目 `.tmp` 下的图片文件，不读取任意本地路径。
- 只允许带 `storage.imageAsset` 的 artifact 下载图片。
- 下载 route 不返回远程图片 URL、私有端点、token 或完整 provider 响应。
- 继续保持 `POST /image` 生成能力不变。
- 本阶段不做教师 UI 按钮、材料包图片集成、PPTX 内嵌图片、对象存储或图片质量评分。

## 2. 可复用方案调研

项目内可复用资产：

- M19 `src\server\image-generation\image-generation-run.ts`：图片生成 runner 与 `imageAsset` metadata 合同。
- M22 `src\server\video-generation\artifact-video.ts`：`.tmp` 路径约束、二进制下载 headers 和文件校验模式。
- M22 `GET /video` route：同一 artifact 子 route 用 `GET` 返回附件下载。
- `.gitignore` 已保护 `.tmp`，避免真实图片进入提交。

成熟做法判断：

- 本地文件读取必须限制在 `.tmp` 下，防止 metadata 被污染后读取项目外文件。
- 图片下载只需要返回二进制附件和标准 headers，不需要在 JSON 中暴露本地路径。
- MVP 阶段先支持 PNG/JPEG；后续材料包图片资产和 PPTX 内嵌图片单独分阶段。

## 3. 复用、适配和必要自研

复用：

- 复用视频下载 helper 的路径约束模式。
- 复用图片 runner 的 PNG/JPEG 魔数校验逻辑。
- 复用 image route 的现有 `POST` 生成入口。

适配：

- 新增 `src\server\image-generation\artifact-image.ts`。
- 在 `src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\image\route.ts` 中新增 `GET`。
- 下载文件名优先使用 `imageAsset.fileName`，并做安全文件名清理。

必要自研：

- 新增图片下载 route 测试，覆盖 PNG 下载、缺少 imageAsset 拒绝、`.tmp` 外路径拒绝。
- 更新 M24 报告和当前审计。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M24 阶段规划和测试定义。
2. 写红灯测试：`GET /image` 尚未导出时失败。
3. 实现 `artifact-image.ts` 和 route `GET`。
4. 跑目标测试绿灯。
5. 跑 `npm test`、`npm run build`。
6. 更新 M24 报告和当前状态审计。
7. 做空白、ignore、敏感扫描和残留进程检查。
8. 提交 M24，不 push。

主要风险：

- 本地路径读取如果不约束会产生安全风险；必须限制在 `.tmp` 下。
- 当前 `.tmp` 不是生产存储；生产部署阶段必须替换为部署卷或对象存储。
- 下载能力不等于图片质量合格；正式使用前仍需人工核对。

验证标准：

- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/image-generation/__tests__/image-download-route.test.ts --maxWorkers=1` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- `.env`、`.tmp` 和真实图片不进入 git。
- 文档、测试和代码不包含真实 key、token、私有端点或远程签名 URL。
