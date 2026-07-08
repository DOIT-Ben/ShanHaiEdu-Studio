# 本地真实 MVP M49 对话滚动与观赏性收口规划

日期：2026-07-08

## 目标

修复教师对话体验里的两个明显断点：

- 回车发送和 AI 回复后，页面自动滚动到最近对话。
- AI 回复期间给出明确等待动效，不让用户觉得页面卡住。
- 增加 ShanHaiEdu AI 的克制品牌标识和消息 avatar，让界面简约但不空。

## 当前问题

- `ConversationWorkbench` 注册了消息节点，但没有在 `messages` 或 `sending` 变化时滚动到底部。
- `PromptComposer` 只有“等待回复”按钮文案，聊天区没有 AI 正在思考的反馈。
- `ChatTranscript` 只有文字标签 `ShanHaiEdu AI`，缺少头像/Logo，页面识别度弱。

## 设计方向

- 自动滚动：在 transcript 底部放 `data-chat-scroll-anchor` 锚点，消息变化和发送等待态变化时滚动到该锚点。
- 等待态：在最后一条用户消息后展示 AI thinking bubble，包含 avatar、三点动效和“正在整理回复”短文案。
- 标识：新增内联 `ShanHaiMark`，用书页、山峰和一点青绿色光标感构成，不引入图片资产，不暴露工程词。
- 视觉美化：让 AI 气泡顶部有小 avatar，assistant 气泡使用轻微青绿色边线和局部强调，避免一整页灰白。

## 范围

- 修改 `ConversationWorkbench.tsx`：增加自动滚动锚点，给 `ChatTranscript` 传入 `sending`。
- 修改 `ChatTranscript.tsx`：增加 AI avatar/logo、等待态、动效标记和更细致的 assistant bubble。
- 如需要，修改 `globals.css` 添加轻量 keyframes。
- 新增 M49 静态测试。

## 非目标

- 不改后端对话编排器。
- 不改消息 API、artifact API 或 provider 接入。
- 不新增外部图片、字体或图标资源。
- 不做营销页或大面积装饰。

## 验收标准

- 回车发送后，最近的用户消息在视口中可见。
- AI 回复完成后，最新 AI 回复在视口中可见。
- AI 回复期间聊天区显示等待动效。
- AI 消息带有 ShanHaiEdu AI 标识，不只是一行文字。
- 桌面和窄屏均无明显遮挡或文本溢出。
