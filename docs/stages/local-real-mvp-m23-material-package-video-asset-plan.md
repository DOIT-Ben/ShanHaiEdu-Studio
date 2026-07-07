# Local Real MVP M23 Material Package Video Asset Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M23 的核心需求是把 M22 已可下载的本地 MP4 纳入最终材料包：当项目内存在已生成的真实导入视频 artifact 时，最终材料包 ZIP 应包含该 MP4；当不存在视频 artifact 时，材料包仍按旧能力导出 Markdown 和 PPTX，不因视频缺失失败。

本阶段必须满足：

- 只打包已经由后端保存并通过 M22 下载 helper 读取的本地 MP4。
- ZIP 内视频文件使用固定、安全、可理解的文件名。
- README 明确视频已包含但仍需教师核对质量、节奏和课堂锚点。
- 没有视频时不伪装视频成片完成，README 保持“视频仍待生成或完善”的边界。
- 本阶段不做教师 UI、在线播放、Range 请求、对象存储、视频质量评分或自动把视频嵌入 PPTX。

## 2. 可复用方案调研

项目内可复用资产：

- M13 `src\server\package\artifact-package.ts`：最终材料包 ZIP 生成器。
- M22 `src\server\video-generation\artifact-video.ts`：本地 MP4 读取、`.tmp` 路径约束和 MP4 校验。
- M13 package route：查找同项目 PPT artifact 并组装 ZIP。
- M22 下载 route 测试：本地 MP4 fixture 与 `.tmp` 路径保护。

成熟做法判断：

- 材料包应该按“已有资产可包含、缺失资产明确提示”的方式渐进增强，不应因为可选视频缺失破坏已有交付。
- ZIP 内部文件名应稳定，例如 `intro-video.mp4`，避免把本地路径或 provider 文件名暴露给教师。
- 视频质量仍需人工核对；材料包包含 MP4 不等于课堂成片质量已验收。

## 3. 复用、适配和必要自研

复用：

- 复用 `buildFinalMaterialPackageDownload` 的 ZIP 结构和 README 构建方式。
- 复用 M22 `buildStoredVideoDownload` 作为唯一读取本地 MP4 的入口。

适配：

- `buildFinalMaterialPackageDownload` 增加可选 `video` 参数。
- 有视频时 ZIP 增加 `intro-video.mp4`。
- README 根据是否有视频切换“已包含”和“仍需核对”文案。
- package route 增加 `getLatestVideoArtifact`，优先选择已批准视频 artifact，否则选择最新带 `videoAsset` 的导入视频 artifact。

必要自研：

- Node ZIP 测试覆盖有视频时的 entries 和 README。
- route 或服务端测试覆盖有视频 artifact 时材料包包含 MP4。
- 更新 M23 报告和当前审计。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M23 阶段规划和测试定义。
2. 写红灯测试：材料包生成器尚未支持 `video` 参数时失败。
3. 实现可选视频 ZIP 集成和 package route 查找逻辑。
4. 跑目标测试绿灯。
5. 跑 `npm test`、`npm run build`。
6. 更新 M23 报告和当前状态审计。
7. 做空白、ignore、敏感扫描和残留进程检查。
8. 提交 M23，不 push。

主要风险：

- 误把缺失视频描述为已完成；README 必须随视频存在与否分支。
- 直接读本地路径有安全风险；必须只通过 M22 helper 读取 `.tmp` 内 MP4。
- 当前 `.tmp` 本地存储不适合生产；部署准备阶段仍需迁移到部署卷或对象存储。

验证标准：

- `node --test tests\artifact-package-download.test.mjs` 通过。
- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage13-material-package.test.ts --maxWorkers=1` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- ZIP 内有视频时包含 `intro-video.mp4`；无视频时不包含且 README 不伪装视频完成。
