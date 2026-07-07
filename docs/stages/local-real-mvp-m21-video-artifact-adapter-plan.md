# Local Real MVP M21 Video Artifact Adapter Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M21 的核心需求是把 M20 已通过的“服务端视频真实 API smoke”推进到后端 artifact 层：给已生成的导入视频方案 artifact 提供一个服务端 route，由后端调用视频 provider，下载本地 MP4，并把本地视频 metadata 保存为新的可审查 artifact。

本阶段必须满足：

- 真实 provider 调用只发生在服务端 runner 或 route，不进入 React。
- route 不返回 task id、远程视频 URL、私有端点、token 或完整 provider 响应。
- 生成文件落在 ignored `.tmp\video-artifacts\`，不提交真实视频。
- 只允许从 `intro_video_plan` artifact 生成真实导入视频，非视频方案 artifact 必须拒绝。
- 保存的新 artifact 必须能说明“本地视频文件已生成，但仍需人工核对质量”，不能伪装成生产视频链路完成。
- 本阶段不做教师 UI 入口、异步队列、取消、重试、材料包视频资产、在线播放或视频质量评分。

## 2. 可复用方案调研

项目内可复用资产：

- M20 `scripts\video-smoke.mjs`：submit/query/download、MP4 `ftyp` 校验、可恢复查询和 stuck 分类。
- M19 `src\server\image-generation\image-generation-run.ts`：服务端 provider runner、`.tmp` 本地文件保存、sha256 metadata。
- M19 `src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\image\route.ts`：artifact route 保存新版本产物。
- M17 Coze PPT adapter：真实文件 metadata 存入 `structuredContent.storage`，route 响应脱敏。

成熟做法判断：

- 视频生成是异步任务，不应把 submit 200 当成完成；runner 必须等待 completed 后再下载并校验 MP4。
- 本地 MVP 可以先同步等待一个短视频任务，但进入产品 UI 前需要异步队列、超时、取消、重试和人工重跑策略。
- artifact 只保存本地相对路径、文件名、bytes、sha256、mime、生成模式和源 artifact id；远程 URL 与 task id 不进入返回体。

## 3. 复用、适配和必要自研

复用：

- 复用 M20 的 video endpoint 拼接、状态归一、结果 URL 解析和 MP4 校验思路。
- 复用 M19 的 route 形态、测试 mock 方式和保存 artifact 合同。
- 复用 `.gitignore` 对 `.tmp` 和 `.env` 的保护。

适配：

- 新增 `src\server\video-generation\video-generation-run.ts`。
- 新增 `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/video`。
- 只接受 `intro_video_plan` artifact 作为输入。
- 成功后保存 `intro_video_plan` 新 artifact，内部 `structuredContent.storage.videoAsset` 记录本地 MP4 metadata。
- 失败时返回教师可理解文案，不暴露工程细节。

必要自研：

- 增加 M21 route 集成测试，验证保存视频 artifact 和拒绝非视频方案 artifact。
- 增加 provider runner 内部 MP4 校验和本地保存逻辑。
- 增加 M21 报告和当前审计更新，说明 M21 是 artifact adapter，不是 UI/队列/材料包完成。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M21 阶段规划和测试定义。
2. 写红灯测试：`video` route 尚不存在、runner 尚不存在时失败。
3. 实现 video runner 与 route。
4. 跑目标测试绿灯。
5. 跑 `npm test`、`npm run build`。
6. 更新 M21 报告和当前状态审计。
7. 做 `git diff --check`、ignore 检查、敏感扫描和测试残留进程检查。
8. 提交 M21，不 push。

主要风险：

- 同步 route 等待真实视频任务可能超过浏览器或部署网关超时；本阶段只作为后端 adapter 基线，UI 入口和队列留到后续。
- `.tmp` 本地存储不适合生产；生产准备阶段必须替换为部署卷或对象存储。
- 单次视频生成成功不代表视频质量满足课堂导入；质量验收需要后续人工或 VLM 评审。

验证标准：

- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/video-generation/__tests__/video-artifact-adapter.test.ts --maxWorkers=1` 通过。
- `node --test tests\video-smoke-script.test.mjs` 通过，确保 M20 smoke helper 未回归。
- `npm test` 通过。
- `npm run build` 通过。
- route 响应和文档不包含 key、token、私有端点、task id、远程视频 URL 或完整 provider 响应。
