# Frontend API-backed Workbench Stage 1 Plan

日期：2026-07-07

## 1. 当前目标

Stage 1 的目标是建立前端真实数据边界：保留现有 Codex 风格工作台，不重写 UI；把项目列表、项目 snapshot、对话、节点和产物从组件内 mock 真源迁移到可替换的 workbench data source；在后端合同尚未完成时，只提供明确标注为开发态的本地 adapter，用于保持前端可运行和可验收。

成功标准：

- `MediaWorkbench` 不再直接导入 mock 项目或 mock 对话作为页面真源。
- `useWorkbenchController` 通过统一 data source 加载项目列表和项目 snapshot。
- 页面有加载态、空态和教师可理解错误态。
- 发送消息后由 data source 返回更新后的 snapshot，并同步中间对话与右侧节点。
- 复制、作为输入、确认、重做、详情查看继续可用。
- 开发态 adapter 在代码和文档中明确命名，不伪装成真实后端。
- 阶段验收包含 build、测试、桌面和窄屏检查。

## 2. 第一性原理

当前阶段真正要解决的不是视觉问题，而是状态真源问题。现有界面已经满足“左项目、中对话、右节点、详情侧栏”的产品形态；继续重写 UI 会增加风险。前端主线必须把 UI 事件和业务状态推进拆开：React 组件只展示 view model，controller 只协调交互，真实项目/对话/节点/产物来自 API client 或开发态 adapter。

本阶段不试图完成所有后端能力。后端合同未合入前，前端先稳定依赖一个最小合同：

- `listProjects()`：返回项目列表。
- `getProjectSnapshot(projectId)`：返回项目、消息、节点、当前节点和产物。
- `sendMessage(projectId, body, reference)`：返回更新后的 snapshot。
- `approveArtifact(projectId, artifactKey)`：返回更新后的 snapshot。
- `regenerateArtifact(projectId, artifactKey)`：返回更新后的 snapshot。

## 3. 调研与可复用方案

项目内可复用：

- 继续复用 `ProjectSidebar`、`ConversationWorkbench`、`ArtifactRail`、`ArtifactSidePanel`、`ArtifactDetailSheet`、`PromptComposer`。
- 继续复用 `src\lib\types.ts` 中的 `ProjectItem`、`ChatMessage`、`ArtifactItem`，新增前端 data source 合同类型，不替换现有 UI 类型。
- 继续复用 `src\lib\mock-data.ts` 作为开发态 adapter 的 seed 数据，但不能让组件直接引用它。

成熟方法与官方依据：

- Next.js Route Handlers 支持用标准 HTTP 方法暴露 API，GET route 默认不缓存，适合作为后续 BFF/API 合同落点：https://nextjs.org/docs/app/getting-started/route-handlers
- Next.js fetch 文档说明可用标准 `fetch` 进行数据请求，浏览器端 fetch 语义保持 Web 平台一致：https://nextjs.org/docs/app/api-reference/functions/fetch
- React 官方建议把可复用连接外部系统的逻辑封装成 custom hooks，而不是分散在组件中：https://react.dev/learn/reusing-logic-with-custom-hooks
- Node.js 内置 test runner 可用 `node --test` 做轻量测试，避免本阶段额外引入 Jest/Vitest 依赖：https://nodejs.org/api/test.html

## 4. 复用、适配与必要自研

复用：

- UI 组件和视觉样式全量保留。
- mock seed 数据只用于开发态 adapter，保持前端在后端未合入时可打开。

适配：

- `MediaWorkbench` 只消费 controller 返回的 `projects`、`messages`、`artifacts`、`activeProjectId` 和状态字段。
- `ConversationWorkbench` 增加加载/空态展示能力，但不出现工程词。
- `ProjectSidebar` 增加 `onCreateProject` 可选回调，使“新建项目”按钮不再是死按钮。

必要自研：

- 新增 `src\lib\workbench-api.ts`：定义 `WorkbenchDataSource`、API client、开发态 adapter、错误归一化和 artifact 文本序列化。
- 重构 `src\hooks\useWorkbenchController.ts`：负责加载、切换项目、发送消息、确认、重做和恢复错误，不再直接把 mock 数据作为状态真源。

## 5. 全主线阶段拆分

原则上不超过 20 个阶段，当前主线拆为 5 个阶段：

1. Stage 1：API-backed controller 骨架、开发态 adapter、加载/错误态、发送消息后同步 snapshot。
2. Stage 2：对话与节点合同深化，接入后端真实 project snapshot、messages、nodes、artifacts。
3. Stage 3：产物动作接入，确认、重做、作为输入和详情查看刷新后不丢。
4. Stage 4：响应式与视觉回归，桌面/窄屏、hover 预览与详情侧栏冲突检查、工程词扫描。
5. Stage 5：跨主线集成收口，配合 backend/runtime/e2e 主线完成完整 MVP 合并判断。

## 6. Stage 1 开发方案

### 6.1 文件变更

- 新增 `src\lib\workbench-api.ts`：data source 合同、fetch client、开发态 adapter、snapshot helper。
- 新增 `tests\workbench-api.test.mjs`：用 Node 内置 test runner 验证 fetch client 路径、错误归一化、开发态 adapter snapshot 更新。
- 修改 `src\lib\types.ts`：增加 snapshot、controller 状态和 data source 相关类型。
- 修改 `src\hooks\useWorkbenchController.ts`：从 data source 加载和更新状态。
- 修改 `src\components\layout\MediaWorkbench.tsx`：改为 controller 数据源，不再直接使用 mock imports。
- 修改 `src\components\conversation\ConversationWorkbench.tsx`：展示加载、空态和错误提示。
- 修改 `src\components\layout\ProjectSidebar.tsx`：绑定新建项目回调。
- 修改 `package.json`：增加轻量 `test` 脚本。

### 6.2 行数与重构判断

当前目标文件未超过 500 行，`useWorkbenchController.ts` 约 120 行，适合定向重构，不需要大拆。若后续 controller 超过 180 行或开始混入复杂映射逻辑，Stage 2 前应拆出 `useWorkbenchDataSource` 或 view model adapter。

### 6.3 交互与状态

- 初始进入页面：显示项目和 snapshot 加载态。
- 加载成功：左侧显示项目列表，中间显示该项目消息，右侧显示该项目产物。
- 加载失败：保留纯白界面，用教师可理解语言提示“项目内容暂时没有取回”，提供重试动作。
- 发送消息：输入为空时沿用现有提示；输入有效时进入发送态，成功后清空输入并刷新 snapshot。
- 确认/重做：调用 data source，成功后刷新 snapshot；失败时显示恢复提示。
- 复制/作为输入/详情：保留本地交互，不依赖后端。

## 7. 风险与回退

风险：

- 后端合同可能变化：通过 `WorkbenchDataSource` 隔离，Stage 2 只换 adapter。
- 开发态 adapter 被误认为真实后端：文档、文件命名、代码注释均使用 `development`，不在完成结论中把它说成真实保存。
- 加载态破坏极简视觉：只使用低噪声文本和现有按钮，不新增大色块。
- `npm run lint` 在 Next 16 项目中可能因 `next lint` 退役失败：阶段验收以实际输出记录，必要时只作为已知工具债务，不冒充通过。

回退：

- 若 controller 重构导致页面不可用，可回退 `MediaWorkbench` 和 `useWorkbenchController` 本阶段改动；新增 API client 不影响旧 UI。

## 8. 验证标准

Stage 1 完成前必须集中执行：

- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- 浏览器桌面检查：项目列表、发送消息、节点详情、复制、作为输入、确认、重做。
- 浏览器窄屏检查：项目抽屉、产物抽屉、发送消息、详情 sheet。
- 搜索用户可见工程词风险：`schema`、`manifest`、`provider`、`node_id`、`storage`、`API`、`debug`、`local path`。

