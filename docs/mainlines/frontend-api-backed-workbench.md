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

### 阶段 4：响应式与 polish 回归

交付：

- 桌面端检查。
- 窄屏检查。
- 关键交互回归。

验收：

- 纯白低噪声。
- 字号层级稳定。
- 普通用户界面无工程词。

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

- 后端 snapshot contract 未定，不做真实接入。
- API 错误格式未定，不做错误 UI 定稿。
- artifact action contract 未定，不做确认/重做最终实现。
