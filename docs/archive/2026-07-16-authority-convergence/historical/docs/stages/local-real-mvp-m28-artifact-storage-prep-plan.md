# Local Real MVP M28 Artifact Storage Prep Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M28 的核心需求是把 M16-M27 已经接入的真实 PPTX、图片和视频素材从“只能写入 `.tmp` 的本地临时实现”推进到“本地默认可用、部署时可切换到固定存储卷”的生产准备状态。

本阶段不是完整对象存储接入，也不是公网部署。当前最小成功标准是：

- 本地开发和现有 E2E 继续默认使用 `.tmp`，不破坏 M16-M27。
- 部署准备时可通过 `ARTIFACT_STORAGE_ROOT` 指向一个固定目录，例如部署卷。
- 新生成的 PPTX、图片、视频在配置存储根目录后写入该目录。
- 数据库 artifact metadata 不保存绝对路径，避免把机器路径写入持久化数据。
- 下载 route 可读取旧 `.tmp` metadata，也可读取新 `artifact-storage/...` metadata。
- 路径解析必须防止 `..`、绝对路径和越界读取。
- 教师可见界面继续不出现工程词或本地路径。

## 2. 可复用方案调研

项目内可复用资产：

- `src\server\coze-ppt\coze-ppt-run.ts`：真实 Coze PPTX 下载后保存本地文件。
- `src\server\image-generation\image-generation-run.ts`：真实图片生成后保存本地文件。
- `src\server\video-generation\video-generation-run.ts`：真实视频下载后保存本地文件。
- `src\server\pptx\artifact-pptx.ts`、`src\server\image-generation\artifact-image.ts`、`src\server\video-generation\artifact-video.ts`：本地文件读取、路径约束和文件头校验。
- 既有 M17/M19/M21/M22/M24/M27 测试覆盖保存、下载和浏览器联动。

成熟做法判断：

- 对本地 MVP，最小生产准备不是立刻引入对象存储 SDK，而是把存储根目录和路径解析集中化，避免每个 provider adapter 自己拼 `.tmp`。
- 持久化 metadata 应保存逻辑 key 或相对路径，而不是机器绝对路径。
- 下载时必须用单一解析函数校验路径边界，再交给各文件类型校验文件头。

## 3. 复用、适配和必要自研

复用：

- 继续使用 Node `fs` 和 `path`，不新增依赖。
- 保留 `.tmp` 默认行为，兼容已有测试和本地烟测产物。
- 保留各类型文件头校验：PPTX `PK`、PNG/JPEG 魔数、MP4 `ftyp`。

适配：

- 新增 `src\server\artifact-storage\local-artifact-storage.ts`。
- generation adapter 统一通过 `writeLocalArtifact` 保存文件。
- download helper 统一通过 `resolveLocalArtifactOutput` 解析 metadata。
- `ARTIFACT_STORAGE_ROOT` 存在时，新保存 metadata 使用 `artifact-storage/<category>/<filename>`。
- 未配置时，新保存 metadata 继续使用 `.tmp/<category>/<filename>`，保持本地兼容。

必要自研：

- 路径安全解析函数。
- 配置根目录和默认 `.tmp` 根目录的兼容规则。
- 覆盖新旧 metadata 的单元测试。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M28 阶段规划和测试定义。
2. 写红灯测试：配置 `ARTIFACT_STORAGE_ROOT` 后写入部署卷并返回 `artifact-storage/...` key；旧 `.tmp` 和新 key 都能解析；越界路径被拒绝。
3. 实现 `local-artifact-storage.ts`。
4. 改造 Coze PPT、图片、视频保存逻辑使用统一写入函数。
5. 改造 PPTX、图片、视频下载逻辑使用统一解析函数。
6. 跑 M28 目标测试、全量测试、构建和必要 E2E 回归。
7. 更新 M28 报告和当前状态审计。
8. 做空白、ignore、敏感扫描和残留进程检查。
9. 提交 M28，不 push。

主要风险：

- 误改 metadata 格式可能破坏已有 `.tmp` 下载；必须保留旧格式。
- 配置存储根目录如果保存绝对路径，会污染数据库；必须只保存逻辑 key。
- 路径解析如果过宽，可能允许读取项目外文件；必须拒绝绝对路径和 `..`。
- 本阶段只准备部署卷，不等于对象存储、CDN、Range 请求、清理策略或生命周期管理已完成。

验证标准：

- `node --test tests\artifact-storage.test.mjs` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- `node scripts\run-stage27-e2e.mjs` 通过，确认浏览器下载联动不回归。
- `.env`、`.tmp` 和测试存储目录不进入 git。
- 文档、测试和代码不包含真实 key、token、私有端点或 provider 响应。
