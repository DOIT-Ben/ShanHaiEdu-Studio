# 主线：MVP Frontend API-backed Workbench

## 1. 主线目标

在不破坏当前 Codex 风格体验的前提下，把现有前端从本地 mock 状态改造成真实 API-backed 工作台。

## 2. 为什么单独成主线

当前前端已经具备正确产品形态。它的风险不是视觉，而是状态源仍在 `useWorkbenchController` 和 mock 数据中。前端主线要做的是“接真实状态”，不是重做 UI。

## 3. 可复用方案

- 保留现有 React 组件：`ProjectSidebar`、`ConversationWorkbench`、`ArtifactRail`、`ArtifactSidePanel`、`PromptComposer`。
- 复用 Radix UI、Tailwind、lucide。
- 新增 API client 和 view model adapter，而不是把 fetch 分散到组件里。

## 4. 职责边界

负责：

- 前端数据加载。
- API-backed controller。
- 发送消息。
- 展示真实节点和 artifact。
- 确认、重做、复制、作为输入。
- 浏览器视觉和交互验收。

不负责：

- 数据库 schema。
- Agent prompt。
- OpenAI 调用。
- provider secret。
- 后端业务状态真源。

## 5. 长期阶段

### 阶段 1：API-backed Controller 骨架

交付：

- workbench API client。
- `useWorkbenchController` 拆分。
- 项目列表从 API 读取。
- 项目 snapshot 从 API 读取。

验收：

- 刷新后能恢复同一个项目视图。
- mock 数据不再作为默认真源。

当前状态：

- 已完成 Stage 1 前端边界纵切，提交前收尾见 `docs\stages\frontend-api-backed-stage1-closeout.md`。
- 已建立 API client 与开发态 adapter，但真实后端 route 尚未在本主线落地。
- 下一步进入 Stage 2：对齐并接入 Backend Workflow Lite 的真实 snapshot 合同。

### 阶段 2：对话与节点接入

交付：

- 发送用户消息到 API。
- 接收 assistant message。
- 展示真实 workflow nodes。
- 展示真实 artifacts。

验收：

- 输入一句话后，中间对话和右侧节点同步更新。
- 失败时显示用户可理解恢复态。

当前状态：

- 已完成 Stage 2 raw contract 适配，收尾见 `docs\stages\frontend-api-backed-stage2-closeout.md`。
- 前端 API client 已能把 Backend Workflow Lite Stage 1 raw snapshot 映射为 UI view model。
- 已完成 Stage 3 产物动作标识边界，收尾见 `docs\stages\frontend-api-backed-stage3-closeout.md`。
- 下一步进入 Stage 4：集中回归复制、作为输入、详情、确认、重做、桌面和窄屏体验。

### 阶段 3：产物动作接入

交付：

- 查看详情。
- 复制关键内容。
- 作为下一步输入。
- 确认。
- 重做。

验收：

- 操作后刷新不丢状态。
- 右侧节点 hover 与详情侧栏不冲突。

当前状态：

- 已完成。前端确认动作优先使用 `artifactId`，动作后重新读取 snapshot。
- `workbench-api.ts` 已拆出 mapper，避免继续越过行数债务。
- 重做真实版本合同仍待后端主线明确，前端不伪装为生产闭环。

### 阶段 4：响应式与 polish 回归

交付：

- 桌面端检查。
- 窄屏检查。
- 关键交互回归。

验收：

- 纯白低噪声。
- 字号层级稳定。
- 普通用户界面无工程词。

当前状态：

- 已完成 Stage 4 响应式与关键交互回归，收尾见 `docs\stages\frontend-api-backed-stage4-closeout.md`。
- 桌面 `1440x900` 与窄屏 `390x844` 均无页面级横向溢出。
- 复制、作为输入、确认、详情、发送、Enter、Shift+Enter 和 hover 复制入口均已浏览器验证。
- `npm run lint` 仍为 Next 16 脚本债务，需后续单独修复或合并前接受为已知风险。

### 主线收尾结论

当前前端职责内已完成 API-backed workbench 迁移：项目列表、项目 snapshot、消息发送、节点/产物映射、产物动作边界、桌面和窄屏回归均已覆盖。后端真实 provider 和 regenerate 版本合同不属于本前端主线，本分支不伪装这些能力已完成。

本分支可作为前端 API-backed 边界合并候选；合并 `main` 前需用户明确确认，并处理或接受 `npm run lint` 脚本债务。

## 6. 测试策略

- API client mock tests。
- controller 状态测试。
- Playwright 交互测试。
- 桌面和窄屏截图检查。

## 7. 集成输入输出

输入：

- Backend project snapshot。
- messages。
- nodes。
- artifacts。

输出：

- user message。
- artifact action。
- project switch。
- use-as-input reference。

## 8. 阻塞条件

- 后端生产真源与真实 provider 调用不由本前端主线声明完成。
- API 错误格式未定，不做错误 UI 最终定稿。
- artifact regenerate 版本合同未定，不做重做生产闭环声明。
