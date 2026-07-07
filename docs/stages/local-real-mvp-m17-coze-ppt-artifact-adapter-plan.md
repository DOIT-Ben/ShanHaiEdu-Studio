# Local Real MVP M17 Coze PPT Artifact Adapter Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M17 的核心需求是把 M16 的“脚本级 Coze PPT 真实 smoke”推进为“项目内 artifact 能力”：教师已有的 PPT 大纲 artifact 可以触发真实 Coze PPT 生成，后端把下载后的 `.pptx` 保存到本地 artifact 存储，并通过现有 PPTX 下载入口返回真实 Coze 文件。

本阶段必须满足：

- Coze token、远程 PPTX URL、账号、私有端点不进入前端、日志、文档、提交或教师可见内容。
- 真实 PPTX 文件只通过后端读取本地文件返回，不把远程下载链接透传给浏览器。
- 现有最小 PPTX 下载能力保留为 fallback；没有 Coze 文件时仍能下载 M11 的最小 PPTX。
- 新增能力只作用于 `ppt_draft` artifact，不影响最终交付、教案、视频等节点。
- 生成后的 Coze artifact 必须持久化到后端 artifact 表，状态为待确认，后续可被材料包选择。

## 2. 可复用方案调研

已参考项目内资料：

- `docs\stages\local-real-mvp-m16-coze-ppt-live-smoke-report.md`
- `scripts\coze-ppt-smoke.mjs`
- `src\server\pptx\artifact-pptx.ts`
- `src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\pptx\route.ts`
- `src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\package\route.ts`
- `src\server\workbench\service.ts`
- `src\lib\workbench-mappers.ts`

复用结论：

- 现有 `Artifact.structuredContentJson` 可作为本地 MVP 的 artifact metadata 存储，不需要新增数据库表。
- 现有前端 mapper 已过滤 `provider`、`storage`、`local path`、`API`、`debug` 等内部字段。
- 现有 PPTX 下载 route 可扩展为“优先返回 Coze 本地文件，否则回退最小 PPTX”。

## 3. 复用、适配和必要自研

复用：

- 复用 M16 的 Coze `/run` 调用、JSON 解析和 PPTX 校验策略。
- 复用 `createWorkbenchService().saveArtifact` 保存新版本 artifact。
- 复用现有 `/pptx` 下载按钮和下载 hook。
- 复用 `.tmp` 本地产物目录，不提交真实生成文件。

适配：

- 新增 `src\server\coze-ppt\coze-ppt-run.ts`，封装 Coze `/run` 请求、PPTX 下载、校验和本地保存。
- 新增 `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/coze-ppt` 路由。
- 更新 `src\server\pptx\artifact-pptx.ts`，优先返回 artifact 内记录的本地 Coze PPTX。
- 更新最终材料包 route，让材料包优先打包真实 Coze PPTX。
- 新增后端测试，确保 route 保存新 artifact，下载 route 返回真实 buffer，非 PPT artifact 被拒绝。

必要自研：

- 增加本地 artifact metadata 结构：
  - `storage.cozePptx.localOutput`
  - `storage.cozePptx.fileName`
  - `storage.cozePptx.bytes`
  - `storage.cozePptx.sha256`
  - `storage.cozePptx.generationMode`
- 增加路径安全校验，确保只读取 `.tmp` 下的本地文件。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M17 阶段规划和测试定义。
2. 写红灯测试：后端 Coze route、PPTX 下载优先使用本地 Coze 文件、非 PPT artifact 拒绝。
3. 抽出 Coze PPT 服务端模块。
4. 实现 `coze-ppt` route，支持测试注入 fake generator，真实环境使用 Coze `/run`。
5. 更新 PPTX 下载和最终材料包 route。
6. 运行集中验收和敏感信息扫描。
7. 更新 M17 报告和当前状态审计。
8. 提交 M17，不 push。

主要风险：

- `.tmp` 不是生产持久存储；本阶段只用于本地 MVP，生产准备阶段必须替换为对象存储或部署卷。
- `/run` 仍不是后端 OpenAPI 主链路；后续需补官方 OpenAPI adapter 和轮询。
- route 触发真实 Coze 可能耗时；本阶段先做后端 route 能力，前端按钮可后续再显式暴露。
- 如果本地文件丢失，下载 route 必须失败或回退，不允许返回远程 URL。

验证标准：

- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/coze-ppt/__tests__/coze-ppt-artifact-adapter.test.ts --maxWorkers=1` 通过。
- `node --test tests\artifact-pptx-download.test.mjs` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- `.tmp`、`.env`、远程 URL、token 不进入提交。
