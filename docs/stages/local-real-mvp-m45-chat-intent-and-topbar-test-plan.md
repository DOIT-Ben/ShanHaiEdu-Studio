# Local Real MVP M45 对话意图门禁与顶部真实项目信息测试定义

日期：2026-07-08

## 1. 行为红线

- 问候语不能被当成备课目标。
- 页面顶部不能显示固定原型课题和固定保存时间。

## 2. 自动化测试

### 2.1 后端合同测试

文件：`src\server\workbench\__tests__\stage7-mainline-contract.test.ts`

新增覆盖：

- 新建项目后发送 `你好`。
- 返回 201。
- snapshot 中存在教师消息和澄清 assistant 消息。
- snapshot artifacts 为空。
- assistant 消息不包含 `需求规格说明书已生成`。

### 2.2 UI 源码测试

文件：`tests\m44-runtime-ui.test.mjs`

扩展覆盖：

- `WorkbenchTopbar.tsx` 不包含 `表内乘法（一）`。
- `WorkbenchTopbar.tsx` 不包含 `已保存 10:24`。
- `ConversationWorkbench.tsx` 将 project 传给 `WorkbenchTopbar`。

## 3. 浏览器复验

本地页面：

```powershell
http://127.0.0.1:3002/
```

验收：

- 新建项目后发送 `你好`。
- 页面回复要求补充年级、课题、教材版本或期望材料。
- 页面不出现 `需求规格说明书已生成`。
- 右侧不新增需求规格草稿。
- 顶部标题与左侧当前项目一致。
