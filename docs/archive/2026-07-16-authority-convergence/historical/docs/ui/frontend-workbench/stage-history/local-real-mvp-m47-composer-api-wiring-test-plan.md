# 本地真实 MVP M47 输入框与附件 API 接线测试计划

日期：2026-07-08

## 红测

- `tests/workbench-api.test.mjs`
  - `sendMessage(projectId, body, reference)` 请求 body 必须包含 `reference`。

- `tests/m47-composer-api-wiring.test.mjs`
  - `PromptComposer` 必须包含 file input、`onAttachFile`、并把纸夹按钮接到选择文件。
  - `useWorkbenchController.sendPrompt()` 不得在 `!activeProjectId` 时直接 return，必须先 `createProject()` 或等价新建项目流程。

## 验收命令

```powershell
node --test tests/workbench-api.test.mjs tests/m47-composer-api-wiring.test.mjs
npm test
npm run build
```

## 本地运行验收

服务：`http://127.0.0.1:3002/`

步骤：

1. 清空浏览器 `localStorage.shanhai.activeProjectId`。
2. 不手动选择/新建项目，直接输入“你好”并按 Enter。
3. 断言自动新建项目，消息出现在对话区。
4. 选择文本资料文件，断言 composer 显示引用。
5. 输入明确备课需求并发送，断言 snapshot 中教师消息包含引用文本。
