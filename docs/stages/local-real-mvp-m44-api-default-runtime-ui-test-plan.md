# Local Real MVP M44 API 默认运行与原型 UI 清理测试定义

日期：2026-07-08

## 1. 行为红线

本地默认运行不能进入 mock 原型页面；聊天主区不能显示与后端真实状态无关的静态生成进度。

## 2. 自动化测试

### 2.1 `tests\workbench-api.test.mjs`

新增覆盖：

- 未设置 `NEXT_PUBLIC_WORKBENCH_DATA_SOURCE` 时，`createDefaultWorkbenchDataSource()` 使用 API client。
- 设置 `NEXT_PUBLIC_WORKBENCH_DATA_SOURCE=mock` 时，才使用 development adapter。

### 2.2 `tests\m44-runtime-ui.test.mjs`

覆盖：

- `ConversationWorkbench.tsx` 不再导入 `GenerationPanel`。
- `ConversationWorkbench.tsx` 不再渲染 `PPT 页面生成中` 静态生成卡入口。

## 3. 浏览器复验

本地 dev server：

```powershell
npm run db:init
npm run dev -- --hostname 127.0.0.1 --port 3002
```

浏览器验收：

- 打开 `http://127.0.0.1:3002/`。
- 左侧不出现 mock 种子项目。
- 页面不出现 `PPT 页面生成中` 与 `8 / 12`。
- API `/api/workbench/projects` 返回的项目列表与页面一致。
