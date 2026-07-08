# 本地真实 MVP M47 输入框与附件 API 接线修复规划

日期：2026-07-08

## 目标

修复教师工作台输入框“看起来能用但实际没发出去”的断链：

- 未选择项目时，首条消息应自动新建项目并发送。
- 回车与发送按钮都走同一条真实后端消息 API。
- 引用内容必须通过 `reference` 字段进入后端消息正文。
- 纸夹按钮不能是假入口，至少支持文本类资料读取并作为本轮引用发送。

## 根因

- `useWorkbenchController.sendPrompt()` 在 `activeProjectId` 为空时直接 return，只给短暂 composer notice。
- `PromptComposer` 仍允许输入，顶部显示“未选择项目”，导致用户认为发送无反应。
- `createWorkbenchApiClient.sendMessage()` 只发送 `artifactRefs`，但后端 `messages` route 实际读取 `body.reference`。
- `PromptComposer` 的纸夹按钮没有 `onClick`、没有 file input、没有反馈。

## 范围

- 修改 `useWorkbenchController.ts`：无项目首发时自动创建项目，再发送消息。
- 修改 `workbench-api.ts`：发送消息时同时传 `reference` 和 `artifactRefs`。
- 修改 `PromptComposer.tsx`：接入隐藏 file input，读取文本类文件，作为引用进入发送链路。
- 保留不可读取文件的教师可见提示，不把上传说成已经进入后端存储。

## 非目标

- 本阶段不做二进制文件持久化。
- 不做 PDF/OCR/Word 解析。
- 不新增数据库表。
- 不把本地读取的附件伪装成正式教材证据包。

## 验收标准

- 在“未选择项目”状态直接输入并发送，会自动创建项目并落库消息。
- `Enter` 与点击发送行为一致。
- 引用/附件文本随消息进入后端，可在 snapshot 消息内容看到“引用：...”。
- 纸夹按钮可选择 `.txt/.md/.csv/.json` 等文本文件，并显示已附加。
- 不可读取文件给出明确提示。
