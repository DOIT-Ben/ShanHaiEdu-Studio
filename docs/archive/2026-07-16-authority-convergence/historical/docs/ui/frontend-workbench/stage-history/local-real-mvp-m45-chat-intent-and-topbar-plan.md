# Local Real MVP M45 对话意图门禁与顶部真实项目信息规划

日期：2026-07-08

## 1. 第一性原理

教师输入 `你好` 时，系统不应直接生成需求规格。真实可用的备课工作台必须先判断输入是否足够构成备课目标；信息不足时应继续追问年级、课题、教材版本和期望产物。

同时，页面顶部不能继续显示原型时代的固定课题和固定保存时间。当前项目为空或新建项目时，顶部应反映当前项目真实状态。

## 2. 可复用方案调研

项目内可复用能力：

- `/api/workbench/projects/[projectId]/messages` 已经是真实消息写入入口。
- `DeterministicRuntime` 可继续承担明确备课需求的本地草稿生成。
- `WorkbenchSnapshot.project` 已包含 `title`、`currentStep`、`updatedAt`。
- `useWorkbenchController` 已集中持有当前项目列表和 active project id。

不需要引入真实大模型或新意图识别库；M45 先用保守关键词门禁阻止明显误触发。

## 3. 复用与适配方式

- 消息 route 在调用 runtime 前判断教师输入是否像备课目标。
- 非备课目标输入只保存教师消息，并新增一条澄清型 assistant 回复，不生成 artifact。
- 明确备课目标继续走 deterministic runtime。
- 前端顶部从 active project 派生标题、阶段和更新时间。

## 4. 开发方案

- 修改 `messages\route.ts`：增加 `isActionableLessonRequest()` 与澄清回复。
- 修改 `useWorkbenchController.ts`：返回 `activeProject`。
- 修改 `ConversationWorkbench.tsx`、`MediaWorkbench.tsx`、`WorkbenchTopbar.tsx`：传入并显示真实项目信息。
- 新增/扩展测试：
  - 后端合同测试验证 `你好` 不生成需求规格 artifact。
  - UI 源码测试验证顶部不再硬编码 `表内乘法（一）` 和 `已保存 10:24`。

## 5. 风险与回退

- 风险：关键词门禁过于保守，短句真实需求可能被追问。回退：教师补充“年级/课题/PPT/教案/公开课”等信息即可触发生成。
- 风险：仍不是自由大模型对话。说明：M45 仍是本地 deterministic 工作流，不冒充真实 LLM。
- 风险：顶部项目信息依赖当前 snapshot。回退：无 active project 时显示 `未选择项目`。

## 6. 验收标准

- `你好` 只触发澄清回复，不生成 requirement artifact。
- 明确备课需求仍生成 `需求规格说明书已生成`。
- 页面顶部不再硬编码旧课题和旧保存时间。
- `npm test` 与 `npm run build` 通过。
