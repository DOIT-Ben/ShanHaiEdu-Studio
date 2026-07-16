# Local Real MVP M44 API 默认运行与原型 UI 清理规划

日期：2026-07-08

## 1. 第一性原理

本地真实 MVP 的第一屏必须接入真实本地状态源，而不是默认展示 mock 项目。用户打开本地页面后，应看到 SQLite/API 中的真实项目列表；如果没有项目，应显示空列表并引导新建项目。

当前截图暴露两个问题：

- 本地 dev 默认走 development adapter，显示 `mock-projects` 的三条种子项目。
- 聊天区只要存在消息就无条件显示静态 `PPT 页面生成中 8 / 12` 卡片，容易把原型任务误认为真实执行进度。

## 2. 可复用方案调研

项目内已经具备可复用能力：

- `createWorkbenchApiClient()`：真实 API data source。
- `scripts\run-stage2-e2e.mjs`：已通过设置 API data source 验证真实浏览器链路。
- `useWorkbenchController()`：已通过 data source 抽象加载项目、消息和产物。
- 后端 `/api/workbench/projects` 与 snapshot API：真实 SQLite 状态源。

不需要引入新库或重写 UI。

## 3. 复用与适配方式

- 默认 data source 改为 API。
- development adapter 仅在 `NEXT_PUBLIC_WORKBENCH_DATA_SOURCE=mock` 时启用。
- 聊天区移除静态 `GenerationPanel`，避免展示与后端 snapshot 无关的假进度。
- 保留右侧产物轨与详情页作为真实产物入口。

## 4. 开发方案

- 修改 `src\lib\workbench-api.ts` 的默认 data source 选择。
- 修改 `src\components\conversation\ConversationWorkbench.tsx`，不再导入和渲染 `GenerationPanel`。
- 新增回归测试：
  - 默认 data source 走 API。
  - 显式 mock 时才走 development adapter。
  - 聊天工作台不再挂载静态生成卡。

## 5. 风险与回退

- 风险：某些旧测试依赖默认 mock。回退：测试中显式设置 `NEXT_PUBLIC_WORKBENCH_DATA_SOURCE=mock`。
- 风险：真实 API 为空时页面显得空。回退：使用已有“还没有对话”和“新建项目”入口，不塞假项目。
- 风险：移除静态生成卡后主区更简洁，但少了一个视觉进度块。回退：后续用真实 generation job 状态重建动态进度，不再使用硬编码文案。

## 6. 验收标准

- 新增 M44 回归测试先红后绿。
- `node --test tests\workbench-api.test.mjs tests\m44-runtime-ui.test.mjs` 通过。
- `npm test` 通过。
- 本地页面默认不再显示三条 mock 项目。
- 本地页面不再显示 `PPT 页面生成中` / `8 / 12` 静态假任务。
