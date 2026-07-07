# Local Real MVP M22 Video Download Route Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M22 的核心需求是把 M21 保存到 artifact metadata 的本地 MP4 变成可由后端安全下载的文件能力：当 artifact 已包含 `structuredContent.storage.videoAsset.localOutput` 时，后端 `GET /video` route 能读取 ignored `.tmp` 内的本地 MP4，返回 `video/mp4` 附件下载。

本阶段必须满足：

- 只读取本项目 `.tmp` 下的视频文件，不读取任意本地路径。
- 只允许带 `storage.videoAsset` 的 artifact 下载视频。
- 下载 route 不返回 task id、远程视频 URL、私有端点、token 或完整 provider 响应。
- 继续保持 `POST /video` 生成能力不变。
- 本阶段不做教师 UI 按钮、材料包视频集成、在线播放、Range 请求、生产对象存储或质量评分。

## 2. 可复用方案调研

项目内可复用资产：

- M11 `pptx` route：同一 artifact 子 route 用 `GET` 返回附件下载。
- M17 Coze PPT 下载逻辑：优先读取 `structuredContent.storage.cozePptx.localOutput` 的本地文件。
- M21 video artifact adapter：`structuredContent.storage.videoAsset` 已记录 `localOutput`、`fileName`、`bytes`、`sha256` 和 `mime`。
- `.gitignore` 已保护 `.tmp`，避免真实 MP4 进入提交。

成熟做法判断：

- 本地文件读取必须做目录约束，避免 metadata 被污染后读取项目外文件。
- 下载响应只需返回二进制附件和标准 headers，不需要把本地路径暴露到 JSON。
- MVP 阶段可先做完整文件下载；在线播放、分片 Range 和 CDN/object storage 留到生产准备阶段。

## 3. 复用、适配和必要自研

复用：

- 复用 PPTX route 的 `GET` route 结构和 `toArrayBuffer`。
- 复用 M21 `videoAsset` metadata 合同。

适配：

- 新增 `src\server\video-generation\artifact-video.ts`，封装本地 MP4 下载构建与 headers。
- 在 `src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\video\route.ts` 中新增 `GET`。
- 下载文件名优先使用 `videoAsset.fileName`，并做安全文件名清理。

必要自研：

- 增加 route 测试：带 `videoAsset` 的 artifact 可下载真实 MP4 buffer。
- 增加拒绝测试：非视频 asset 或 `.tmp` 外路径不能下载。
- 更新 M22 报告和当前审计。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M22 阶段规划和测试定义。
2. 写红灯测试：`GET /video` 尚未导出时失败。
3. 实现 `artifact-video.ts` 和 route `GET`。
4. 跑目标测试绿灯。
5. 跑 `npm test`、`npm run build`。
6. 更新 M22 报告和当前状态审计。
7. 做空白、ignore、敏感扫描和残留进程检查。
8. 提交 M22，不 push。

主要风险：

- 本地路径读取如果不约束会产生安全风险；必须限制在 `.tmp` 下。
- 当前 `.tmp` 不是生产存储；生产部署阶段必须替换为部署卷或对象存储。
- 下载能力不等于视频质量合格；正式使用前仍需人工核对。

验证标准：

- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/video-generation/__tests__/video-download-route.test.ts --maxWorkers=1` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- `.env`、`.tmp` 和真实 MP4 不进入 git。
- 文档、测试和代码不包含真实 key、token、私有端点、task id 或远程签名 URL。
