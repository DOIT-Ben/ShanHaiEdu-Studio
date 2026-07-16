# Local Real MVP M26 Teacher Real Generation Entry Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M26 的核心需求是把 M17、M19、M21 已经完成的服务端真实生成能力，暴露为教师能理解、能点击、能失败恢复的前端入口。当前真实 PPTX、课堂视觉图和导入视频已经有后端 route，但教师界面还只能下载已有文件，不能从产物详情中主动触发真实生成。

本阶段必须满足：

- 入口只出现在对应产物详情中：PPT 大纲显示“生成真实 PPTX”，PPT 大纲显示“生成课堂视觉图”，导入视频方案显示“生成导入视频”。
- 前端只调用项目内 API route，不读取 `.env`，不接触 key、token、私有端点或 provider 响应。
- 成功后刷新项目 snapshot，让新保存的 artifact 出现在右侧产物区。
- 失败时使用教师可理解的失败文案，不暴露 `provider`、`API`、`storage`、`task id`、`local path` 等工程词。
- 本阶段不做长任务队列、进度轮询、真实视频在线播放、PPTX 内嵌图片、账号权限或生产存储迁移。

## 2. 可复用方案调研

项目内可复用资产：

- `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/coze-ppt`：真实 PPTX artifact adapter。
- `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/image`：课堂视觉图 artifact adapter。
- `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/video`：导入视频 artifact adapter。
- `src\lib\workbench-api.ts`：前端统一 API data source。
- `src\hooks\useWorkbenchController.ts`：确认、重做、复制和状态刷新已有模式。
- `src\components\artifacts\ArtifactDetailSheet.tsx`：产物详情操作按钮落点。

成熟做法判断：

- UI 入口应该是按产物能力显隐的 action，不应把后端 route 名、provider 名或存储字段展示给教师。
- 前端不做 provider adapter，不做本地文件读取，只通过后端 route 请求并刷新 snapshot。
- 真实生成可能耗时较长；M26 先做同步触发和失败反馈，后续再引入队列/轮询。

## 3. 复用、适配和必要自研

复用：

- 复用现有 `WorkbenchDataSource` 模式，把真实生成作为 data source 方法。
- 复用 controller 的 `applySnapshot` 和 notice 机制。
- 复用 `ArtifactDetailSheet` 操作区布局和 Button 组件。

适配：

- 新增纯函数 `getRealAssetGenerationAction(item)`，集中判断产物是否能触发真实生成以及按钮文案。
- `WorkbenchDataSource` 增加 `generateRealAsset(projectId, artifactId, assetKind)`。
- API client 根据 `assetKind` 调用 `coze-ppt`、`image` 或 `video`，成功后重新读取 snapshot。
- controller 增加 `generateRealAsset(item, assetKind)`，处理触发中、成功和失败提示。
- `ArtifactDetailSheet` 根据纯函数渲染一个或多个真实生成按钮。

必要自研：

- Node 测试覆盖 API client 调用路径和刷新 snapshot。
- Node 测试覆盖 UI action helper 的显隐、文案和工程词屏蔽。
- 前端组件只做薄连接，不在组件内复制 route 规则。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M26 阶段规划和测试定义。
2. 写红灯测试：API client 尚无 `generateRealAsset` 方法；action helper 尚不存在。
3. 实现类型、API client、development adapter 和 action helper。
4. 接入 controller 与详情抽屉按钮。
5. 跑目标测试绿灯。
6. 跑 `npm test`、`npm run build`。
7. 更新 M26 报告和当前状态审计。
8. 做工程词扫描、敏感扫描、空白检查和残留进程检查。
9. 提交 M26，不 push。

主要风险：

- 真实生成 route 可能耗时；本阶段按钮点击期间只显示“正在生成”，不承诺后台队列。
- 失败文案如果直接透传后端错误，可能泄露工程词；controller 必须使用稳定教师文案。
- `ArtifactDetailSheet` 已承担较多职责；本阶段只加薄连接，并把判断逻辑抽到独立 helper。

验证标准：

- `node --test tests\workbench-api.test.mjs` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- 教师可见文案不包含 `schema`、`manifest`、`provider`、`node_id`、`storage`、`API`、`debug`、`local path`。
- 前端新增代码不读取 `.env`，不包含真实 key、token、私有端点或远程签名 URL。
