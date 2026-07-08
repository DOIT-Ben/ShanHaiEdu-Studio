# 本地真实 MVP M48 Chat-first 对话界面收尾报告

日期：2026-07-08

## 结论

M48 已完成。教师端工作台第一屏从流程/时间线感改为 chat-first 对话体验：

- 用户消息右侧气泡，AI 回复左侧气泡，正文保留换行。
- 聊天区移除了 `ConversationNavigator` 时间线。
- 桌面端不再常驻右侧窄产物 rail，产物改为顶部按钮和 drawer 按需打开。
- 发送后立即显示用户气泡，AI 回复期间发送按钮进入等待态，并用 ref 锁避免极快重复发送乱序。

## 改动范围

- `src/components/conversation/ChatTranscript.tsx`
  - 增加 `data-message-role` 和 `data-chat-bubble`。
  - 用户/AI 消息改为清晰左右对话气泡。
  - 消息正文使用 `whitespace-pre-wrap`。

- `src/components/conversation/ConversationWorkbench.tsx`
  - 移除聊天内时间线导航。
  - 调整对话内容宽度和空状态。
  - 接入 `sending` 与 `onOpenArtifacts`。

- `src/components/conversation/PromptComposer.tsx`
  - 接入 `sending`。
  - 发送期间按钮显示“等待回复”并禁用。

- `src/components/conversation/WorkbenchTopbar.tsx`
  - 增加桌面端“产物”按钮。

- `src/components/layout/MediaWorkbench.tsx`
  - 移除常驻桌面 `ArtifactRail`。
  - 保留 drawer、侧边详情和深度详情 sheet。

- `src/hooks/useWorkbenchController.ts`
  - 发送时乐观追加用户消息。
  - 增加 `sending` 状态和 `sendingRef` 发送锁。
  - 失败时恢复输入与引用，不丢用户内容。

## 验收记录

| 验收项 | 结果 |
| --- | --- |
| `node --test tests\m48-chat-first-ui.test.mjs` | 通过；4/4 |
| `node --test tests\m47-composer-api-wiring.test.mjs tests\workbench-api.test.mjs` | 通过；15/15 |
| `npm test` | 通过；Node 105/105，Vitest 25 files / 100 tests |
| `npm run build` | 通过；Next.js 编译、TypeScript、静态页面生成均通过 |
| 桌面 Playwright | 通过；两轮连续对话、等待态、产物 drawer、需求规格产物均通过 |
| 窄屏 Playwright | 通过；项目按钮、产物按钮、用户气泡、AI 气泡均可见 |

## 浏览器证据

- 桌面对话截图：`.tmp/m48-chat-first-ui-chat.png`
- 桌面产物 drawer 截图：`.tmp/m48-chat-first-ui-drawer.png`
- 最终桌面验收截图：`.tmp/m48-chat-first-ui-final.png`
- 窄屏截图：`.tmp/m48-chat-first-ui-mobile.png`

最终桌面验收断言：

```json
{
  "first user bubble appears immediately": true,
  "send button enters waiting state": true,
  "second user bubble appears immediately": true,
  "two user bubbles visible in transcript": true,
  "two assistant bubbles visible in transcript": true,
  "conversation navigator absent": true,
  "permanent desktop rail absent": true,
  "artifact drawer opens from button": true,
  "requirement artifact appears in drawer": true
}
```

## 风险与边界

- 本阶段只收口对话体验，不改变真实模型 provider、artifact 生成和权限合同。
- 产物发现从常驻 rail 改为按钮/drawer，后续若教师找不到产物入口，可加更明确但低噪声的状态提示。
- 当前仍保留顶部阶段条，因为产品不是纯聊天应用，而是对话驱动的线性交付工作台；但聊天区已经成为第一视觉层。
