# Local Real MVP M25 Material Package Image Asset Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M25 的核心需求是把 M24 已可下载的本地图片纳入最终材料包：当项目内存在已生成的本地图片 artifact 时，最终材料包 ZIP 应包含该图片；当不存在图片 artifact 时，材料包仍按旧能力导出 Markdown、PPTX 和可选视频，不因图片缺失失败。

本阶段必须满足：

- 只打包已经由后端保存并通过 M24 下载 helper 读取的本地 PNG/JPEG。
- ZIP 内图片文件使用固定、安全、可理解的文件名。
- README 明确图片已包含但仍需教师核对视觉准确性、版权和课堂适配。
- 没有图片时不伪装图片完成，README 保持“图片仍待生成或完善”的边界。
- 本阶段不做教师 UI、PPTX 内嵌图片、对象存储、图片质量评分或多图素材管理。

## 2. 可复用方案调研

项目内可复用资产：

- M13 `src\server\package\artifact-package.ts`：最终材料包 ZIP 生成器。
- M23 视频材料包集成：可选资产进入 ZIP、README 按资产存在与否切换说明。
- M24 `src\server\image-generation\artifact-image.ts`：本地 PNG/JPEG 读取、`.tmp` 路径约束和图片魔数校验。
- M24 图片下载 route 测试：图片 fixture、安全文件名和 `.tmp` 路径保护模式。

成熟做法判断：

- 材料包应按“已有资产可包含、缺失资产明确提示”的方式渐进增强。
- ZIP 内部文件名应稳定，例如 `classroom-visual.png`，避免把本地路径、provider 文件名或临时文件名暴露给教师。
- 图片质量、版权和课堂适配仍需人工核对；材料包包含图片不等于视觉成稿已完成。

## 3. 复用、适配和必要自研

复用：

- 复用 `buildFinalMaterialPackageDownload` 的 ZIP 结构和 README 构建方式。
- 复用 M24 `buildStoredImageDownload` 作为唯一读取本地图片的入口。

适配：

- `buildFinalMaterialPackageDownload` 增加可选 `image` 参数。
- 有图片时 ZIP 增加 `classroom-visual.png` 或 `classroom-visual.jpg`。
- README 根据图片和视频是否存在组合说明“已包含”和“仍需核对”的边界。
- package route 增加 `getLatestImageDownload`，优先选择已批准图片 artifact，否则选择最新带 `imageAsset` 的 PPT artifact。

必要自研：

- Node ZIP 测试覆盖有图片时的 entries、图片魔数和 README。
- route 集成测试覆盖有图片 artifact 时材料包包含图片。
- 更新 M25 报告和当前审计。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M25 阶段规划和测试定义。
2. 写红灯测试：材料包生成器尚未支持 `image` 参数时失败。
3. 写 route 红灯测试：项目存在 `storage.imageAsset` 时 ZIP 尚未包含图片。
4. 实现可选图片 ZIP 集成和 package route 查找逻辑。
5. 跑目标测试绿灯。
6. 跑 `npm test`、`npm run build`。
7. 更新 M25 报告和当前状态审计。
8. 做空白、ignore、敏感扫描和残留进程检查。
9. 提交 M25，不 push。

主要风险：

- 误把缺失图片描述为已完成；README 必须随图片存在与否分支。
- 直接读本地路径有安全风险；必须只通过 M24 helper 读取 `.tmp` 内 PNG/JPEG。
- 当前 `.tmp` 本地存储不适合生产；部署准备阶段仍需迁移到部署卷或对象存储。
- 如果 ZIP 文件名直接沿用 provider 文件名，可能泄露内部命名；本阶段固定导出为课堂视觉图文件名。

验证标准：

- `node --test tests\artifact-package-download.test.mjs` 通过。
- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage13-material-package.test.ts --maxWorkers=1` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- ZIP 内有图片时包含 `classroom-visual.png` 或 `classroom-visual.jpg`；无图片时不包含且 README 不伪装图片完成。
