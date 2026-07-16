# 本地真实 MVP M49 对话滚动与观赏性测试计划

日期：2026-07-08

## 红测

- `tests/m49-chat-scroll-and-delight.test.mjs`
  - `ConversationWorkbench.tsx` 必须在 `messages/sending` 变化时滚动到底部锚点。
  - `ConversationWorkbench.tsx` 必须向 `ChatTranscript` 传入 `sending`。
  - `ChatTranscript.tsx` 必须包含 `ShanHaiMark`、`data-assistant-logo`、`data-ai-thinking`、typing dots 和等待文案。
  - `globals.css` 必须包含对应 typing 动效 keyframes。

## 集中验收命令

```powershell
node --test tests\m49-chat-scroll-and-delight.test.mjs
node --test tests\m48-chat-first-ui.test.mjs
npm test
npm run build
```

## 浏览器验收

服务：`http://127.0.0.1:3002/`

桌面：

1. 打开工作台并清空 active project。
2. 连续发送两轮对话。
3. 断言发送后用户消息可见，AI 等待动效可见。
4. 断言 AI 回复完成后最新 AI 回复可见。
5. 截图确认 AI logo、typing 状态和对话布局无遮挡。

窄屏：

1. 390px 视口打开页面。
2. 发送一条长一点的备课需求。
3. 断言自动滚到底部、AI logo 和等待动效不挤压文本。
