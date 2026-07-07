# Local Real MVP M19 Image Artifact Adapter Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M18 已证明固定 `free` 图片通道可以真实生成本地 PNG 文件。M19 的核心需求是把这条能力从脚本 smoke 推进到后端 artifact 层：后端能够基于当前 PPT 大纲产物触发图片生成，保存一个新版本产物，并把本地图片 metadata 放入 `structuredContent.storage.imageAsset`。

本阶段必须满足：

- 只在服务端 route/module 中读取图片 provider env，不把 key、token、私有端点或远程图片 URL 传给 React。
- 复用 M18 的图片响应解析、PNG/JPEG 魔数校验、endpoint 拼接和脱敏原则。
- 复用 M17 的后端 artifact adapter 模式：读取项目与源 artifact、调用 provider adapter、保存新版本 artifact、返回后端 snapshot 里的普通 artifact 数据。
- 本地真实图片仍放在 `.tmp\image-artifacts\`，不提交真实图片。
- 暂不新增教师 UI 按钮，避免把后端能力误包装成完整图片工作流。

## 2. 可复用方案调研

已参考项目内资料：

- `docs\stages\local-real-mvp-m17-coze-ppt-artifact-adapter-report.md`
- `docs\stages\local-real-mvp-m18-image-api-live-smoke-report.md`
- `src\server\coze-ppt\coze-ppt-run.ts`
- `src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\coze-ppt\route.ts`
- `src\server\workbench\service.ts`
- `src\server\workbench\types.ts`

成熟做法判断：

- 图片文件属于生成型二进制产物，不应塞进 markdown 正文或前端 state；后端只保存 metadata 和受限本地路径。
- M17 的 `structuredContent.storage.cozePptx` 已经形成本地真实文件 metadata 模式；M19 可用 `structuredContent.storage.imageAsset` 平行承载图片 metadata。
- 当前 `WorkflowNodeKey` 已包含 `image_prompts`，但本阶段最小闭环优先从 `ppt_draft` 触发，因为图片服务于 PPT 视觉资产增强；独立图片节点和材料包集成留到后续。
- `.tmp` 可用于本地 MVP 试用，生产部署前必须替换为部署卷或对象存储。

## 3. 复用、适配和必要自研

复用：

- 复用 M18 的 `extractImageResult`、`validateImageBuffer` 和 `buildImageGenerationsUrl` 思路。
- 复用 M17 的 route 流程和测试结构。
- 复用 `createWorkbenchService().saveArtifact()` 生成新版本 artifact。

适配：

- 新增 `src\server\image-generation\image-generation-run.ts`。
- 新增 `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/image`。
- route 只允许 `ppt_draft` artifact 触发；非 PPT artifact 返回教师可理解错误。
- 成功后保存新版本 `ppt_draft` artifact，标题使用“真实课堂视觉图”，摘要说明已生成本地图片资产。
- `structuredContent.storage.imageAsset` 保存 `localOutput`、`fileName`、`bytes`、`sha256`、`mime`、`generationMode`、`sourceArtifactId`。
- route 响应不得包含 key、Bearer、私有端点、远程 URL 或完整 provider 响应。

必要自研：

- 从项目与 PPT artifact 组装图片 prompt，约束为“小学六年级百分数公开课导入页主视觉、纯白背景、不要品牌/二维码/复杂文字”。
- 增加本地文件名清洗和 `.tmp\image-artifacts\` 输出。
- 增加后端 route 测试，mock provider adapter 验证 artifact 保存合同。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M19 阶段规划和测试定义。
2. 写红灯测试：缺少 image route/module 时，`ppt_draft` 触发图片生成保存 artifact 的测试失败。
3. 实现 `src\server\image-generation\image-generation-run.ts`。
4. 实现 `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/image`。
5. 运行 M19 定向测试。
6. 运行 M18 smoke 单测，确保底层图片脚本契约不回归。
7. 运行 `npm test`、`npm run build`、敏感扫描、`.env/.tmp` ignore 检查和 `git diff --check`。
8. 写 M19 报告，更新当前状态审计。
9. 提交 M19，不 push。

主要风险：

- 图片真实生成成本和耗时高；M19 route 单元测试应 mock provider，live smoke 继续由 M18 脚本证明。
- `structuredContent.storage` 是内部字段，教师 UI 不得直接显示 `storage`、`provider`、`local path` 等工程词。
- `.tmp` 不是生产存储；生产部署阶段必须替换为部署卷或对象存储。
- M19 不解决图片质量、尺寸解码、材料包集成或 PPTX 内嵌图片。

验证标准：

- `npx vitest run src/server/image-generation/__tests__/image-artifact-adapter.test.ts --maxWorkers=1` 红灯后绿灯。
- `node --test tests\image-smoke-script.test.mjs` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- `.env`、`.tmp`、真实图片、远程 URL 和 token 不进入提交。
