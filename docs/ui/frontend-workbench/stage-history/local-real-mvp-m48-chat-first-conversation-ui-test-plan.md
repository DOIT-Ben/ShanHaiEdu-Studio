# 本地真实 MVP M48 Chat-first 对话界面测试计划

日期：2026-07-08

## 红测

- `tests/m48-chat-first-ui.test.mjs`
  - `ConversationWorkbench.tsx` 不再 import 或渲染 `ConversationNavigator`。
  - `ChatTranscript.tsx` 必须包含 `data-message-role`、assistant/user 气泡标识和 `whitespace-pre-wrap`。
  - `MediaWorkbench.tsx` 不再桌面端常驻 `ArtifactRail` rail 容器，桌面和移动都通过“产物”按钮打开 drawer。
  - `useWorkbenchController.ts` 必须在等待后端回复时乐观追加用户气泡，并暴露 `sending` 状态。
  - `PromptComposer.tsx` 必须根据 `sending` 禁用发送按钮，避免连续发送乱序。

## 集中验收命令

```powershell
node --test tests/m48-chat-first-ui.test.mjs
node --test tests/m47-composer-api-wiring.test.mjs tests/workbench-api.test.mjs
npm test
npm run build
```

## 浏览器验收

服务：`http://127.0.0.1:3002/`

步骤：

1. 打开本地工作台。
2. 清空或忽略旧项目，直接输入“你好”并按 Enter。
3. 断言首条用户消息出现在右侧气泡，AI 回复出现在左侧气泡。
4. AI 回复前发送按钮进入等待态，不允许重复提交。
5. 继续输入明确备课需求，断言仍能生成需求规格产物。
6. 点击“产物”按钮，断言产物 drawer 可打开并查看节点。
7. 选择文本附件，断言引用仍显示并随下一条消息发送。
8. 截图桌面视口，确认聊天主视觉清晰，无聊天内时间线、无常驻右侧产物 rail。

## 不通过条件

- 回车无反应或消息没有落入对话区。
- 页面仍主要像流程时间线或节点看板。
- 右侧产物 rail 默认常驻。
- UI 出现 `provider`、`schema`、`storage`、`API`、`debug`、`node_id` 等工程词。
