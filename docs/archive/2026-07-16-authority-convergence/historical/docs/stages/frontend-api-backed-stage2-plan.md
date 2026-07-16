# Frontend API-backed Workbench Stage 2 Plan

日期：2026-07-07

## 1. 当前目标

Stage 2 的目标是把前端 data source 从“只吃 UI 形态 snapshot”推进到“可接 Backend Workflow Lite 原始合同”。本阶段不复制后端 route，不在 React 里写业务状态，也不伪造 runtime 生成结果；只做前端合同适配、view model 映射和真实后端响应兼容。

成功标准：

- `createWorkbenchApiClient` 能处理 `GET /api/workbench/projects` 返回 `{ projects }`。
- `getProjectSnapshot(projectId)` 能把后端 `ProjectSnapshot` 中的 `project/messages/nodes/artifacts` 映射为前端 `WorkbenchSnapshot`。
- workflow nodes 即使没有 artifact，也能在右侧节点串显示为未开始或当前状态。
- artifact record 能映射为可查看、可复制、可作为输入、可确认、可重做的 `ArtifactItem`。
- `sendMessage` 请求 body 改为后端合同：`{ role: "teacher", content, artifactRefs }`，成功后重新读取 snapshot。
- `createProject` 能处理后端 `{ project }` 响应，并继续读取 snapshot。
- UI 仍无工程词，仍保留 Stage 1 交互。

## 2. 第一性原理

前端主线的职责不是定义数据库，也不是替后端实现工作流。当前真正需要的是稳定“边界转换”：

```text
Backend Workflow Lite records
-> frontend workbench view model
-> existing Codex-style UI
```

如果没有这个转换层，前端要么继续依赖开发态 seed，要么把后端字段直接暴露到 UI。两者都不符合主线目标。因此 Stage 2 的核心是把 raw contract 封在 `workbench-api.ts` 内部，组件和 controller 继续只认识 `ProjectItem`、`ChatMessage`、`ArtifactItem`。

## 3. 调研与可复用方案

项目内已核验：

- Backend Workflow Lite Stage 1 已有 route：
  - `GET/POST /api/workbench/projects`
  - `GET /api/workbench/projects/[projectId]`
  - `GET/POST /api/workbench/projects/[projectId]/messages`
  - `GET/POST /api/workbench/projects/[projectId]/artifacts`
  - `GET /api/workbench/projects/[projectId]/snapshot`
- 后端 `ProjectSnapshot` 形态为：
  - `project: ProjectRecord`
  - `messages: ConversationMessageRecord[]`
  - `nodes: WorkflowNodeRecord[]`
  - `artifacts: ArtifactRecord[]`
  - `agentRuns: AgentRunRecord[]`
- Backend Stage 2 规划中会新增：
  - `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/approve`
  - `GET /api/workbench/projects/[projectId]/approved-inputs?nodeKey=...`

官方依据沿用 Stage 1：

- Next.js Route Handlers：https://nextjs.org/docs/app/getting-started/route-handlers
- React custom hooks：https://react.dev/learn/reusing-logic-with-custom-hooks
- Node.js test runner：https://nodejs.org/api/test.html

## 4. 复用、适配与必要自研

复用：

- Stage 1 的 `WorkbenchDataSource` 和 controller 不大改。
- UI 组件继续只吃前端 view model。
- Node 内置测试继续覆盖合同映射。

适配：

- `ArtifactKind` 增加 `requirement_spec`，对齐后端首节点。
- `ArtifactItem` 增加可选 `artifactId`、`nodeKey`、`version`，UI 不展示这些工程字段，只用于 action endpoint。
- API client 内部增加 raw response normalizer：
  - `normalizeProjectList`
  - `normalizeProjectSnapshot`
  - `mapBackendProject`
  - `mapBackendMessage`
  - `mapBackendNodeToArtifactItem`

必要自研：

- 节点无 artifact 时生成教师可理解占位摘要，如“还没有生成内容”。
- raw artifact 的 `markdownContent` 和 `structuredContent` 映射为 `content`。
- `failed` 状态映射为前端可理解的 `blocked`，避免扩散新 UI 状态。

## 5. Stage 2 开发方案

### 5.1 文件变更

- 修改 `src\lib\types.ts`
  - 增加 `requirement_spec`。
  - 增加 `ArtifactItem.artifactId?`、`nodeKey?`、`version?`。
- 修改 `src\lib\workbench-api.ts`
  - 增加后端 raw types。
  - 增加 response normalization。
  - 调整 API client 的 list/create/snapshot/send/approve。
- 修改 `tests\workbench-api.test.mjs`
  - 增加后端 raw project list 映射测试。
  - 增加 raw snapshot 映射测试。
  - 增加 sendMessage 后重新读取 snapshot 的测试。
  - 保留 development adapter 测试。
- 新增 `docs\stages\frontend-api-backed-stage2-test-plan.md`。

### 5.2 不做范围

- 不新增后端 route。
- 不把 Backend Stage 2 未完成的 approve/regenerate 宣称为真实可用。
- 不在 UI 中显示 artifact id、node key、API、schema 等工程词。
- 不做真实 runtime 生成，也不伪造 assistant message。

## 6. 风险与回退

风险：

- 后端 raw shape 后续变化：normalizer 集中在 `workbench-api.ts`，后续只改一处。
- artifact action 需要 artifact id，而老 UI 用 node key：通过可选 `artifactId` 保存 action id，展示仍用 title。
- 后端当前 `sendMessage` 只保存 teacher message，不生成 assistant：前端必须真实显示 snapshot，不补假回复。

回退：

- 若 raw normalizer 影响现有 UI seed，可回退 `workbench-api.ts` 的 API client 映射，development adapter 和 controller 可继续工作。

## 7. 验证标准

- 新增测试先失败，修复后 `npm test` 通过。
- `npx tsc --noEmit` 通过。
- `npm run build` 通过。
- `rg -n "schema|manifest|provider|node_id|storage|API|debug|local path" src` 无用户可见文案命中。
- 最小浏览器检查确认 Stage 1 UI 未回退。

