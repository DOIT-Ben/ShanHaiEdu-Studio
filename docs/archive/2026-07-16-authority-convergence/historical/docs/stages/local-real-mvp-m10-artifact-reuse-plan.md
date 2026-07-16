# Local Real MVP M10 产物复用输入闭环规划

日期：2026-07-07

## 1. 第一性原理判断

本地真实 MVP 的连续生产能力，不只取决于系统能生成一组节点产物，也取决于教师能把上一步确认或待调整的材料自然带入下一轮对话。

M10 的核心需求是：

```text
打开产物详情
-> 点击作为输入
-> 回到对话输入区
-> 输入区带入可读引用和可编辑内容
-> 发送后后端消息保存引用
-> 教师可移除引用再继续输入
```

成功标准：

- 教师不需要手动复制粘贴产物摘要。
- 从详情页点击“作为输入”后，不被详情抽屉继续遮挡输入区。
- composer 明确显示“引用：产物标题：摘要”。
- textarea 插入“请基于：...”内容，教师可继续编辑。
- 发送后新消息包含引用，后端 `artifactRefs` 保存该引用。
- “移除引用”只移除引用 chip，不清空教师已编辑的输入内容。

## 2. 可复用方案调研

项目内已有可复用能力：

- `src\hooks\useWorkbenchController.ts` 已维护 `reference`、`input`、`useAsInput()` 和 `sendPrompt()`。
- `src\components\conversation\PromptComposer.tsx` 已展示“引用：...”并提供“移除引用”按钮。
- `src\lib\workbench-api.ts` 已把 `reference` 转成后端 `artifactRefs`。
- `src\app\api\workbench\projects\[projectId]\messages\route.ts` 已接受并保存 `artifactRefs`。
- `tests\e2e\stage2-deterministic.spec.ts` 已覆盖真实浏览器 M1-M5 主链路，并有 `openArtifactDetail()` 与 `expectArtifactEntryAvailable()` 辅助函数。
- `tests\workbench-api.test.mjs` 已验证 API client 会发送 `{ role, content, artifactRefs }`。

成熟方法论：

- 继续复用 Playwright 的用户可见行为断言，而不是只测 hook 状态。
- 继续复用现有 Stage 2 独立 SQLite 测试库与 dev server runner，避免污染 `dev.db`。
- 对行为变更执行 TDD：先补 E2E 红灯，再做最小实现。

## 3. 复用、适配与必要自研

复用：

- 复用 `useAsInput()` 的引用构造、输入插入和消息提示逻辑。
- 复用现有 `artifactText()` 序列化格式，M10 不改产物文本合同。
- 复用 `PromptComposer` 的引用 chip 和清除按钮，不新增新 UI。
- 复用 Stage 2 浏览器主链路，避免另开平行测试入口。

适配：

- 在从详情页执行“作为输入”时关闭详情抽屉，让输入区可见可操作。
- E2E 需要覆盖从完整详情页触发，而不是只从侧栏预览触发。
- E2E 需要在发送后验证教师消息带有“引用：...”，证明引用进入真实请求和后端 snapshot。

必要自研：

- 只补一处交互状态收口：详情页复用后关闭 `detailOpen`。
- 后端 snapshot 映射到聊天消息时，把已保存引用追加成教师可见文本。
- 不新增复杂测试框架。

## 4. 开发方案、风险与验证标准

开发方案：

1. 在 `tests\e2e\stage2-deterministic.spec.ts` 增加 M10 场景。
2. 场景先创建项目并生成需求规格产物。
3. 打开需求规格说明书完整详情，点击“作为输入”。
4. 断言详情抽屉关闭，composer 可见，引用 chip 和 textarea 内容正确。
5. 发送“请继续细化课堂活动”，断言教师消息包含正文和引用，并通过消息接口确认 `artifactRefs` 保存。
6. 再次使用产物作为输入，点击“移除引用”，断言引用 chip 消失但 textarea 内容仍保留。
7. 实现最小代码：`useAsInput()` 关闭 `detailOpen`；`mapBackendMessage()` 对 `artifactRefs` 做教师可见回显。

风险：

- Stage 2 主链路已经较长，新增断言可能增加 E2E 时长；先控制在一个产物复用场景内。
- `getByText("引用：...")` 可能因 chip 内分段文本导致选择器不稳，应优先使用可见文本和 textarea value 的组合断言。
- 详情抽屉关闭动画可能需要断言按钮隐藏，而不是直接依赖瞬时 DOM 移除。
- 不能把 deterministic 产物描述成真实模型生成。

验证标准：

- 红灯：修改实现前，新增 E2E 应因详情抽屉仍可见而失败；关闭详情后应继续暴露消息引用未回显。
- 绿灯：实现后 `npm run test:e2e:stage2` 通过。
- 集中验收：
  - `node --test tests/artifact-markdown-download.test.mjs`
  - `npm test`
  - `npm run build`
  - `npm run test:e2e:stage2`
  - `npm run test:e2e:stage8`
  - `npm run test:e2e:stage7`
  - `git diff --check`
  - 测试 worker 残留检查

