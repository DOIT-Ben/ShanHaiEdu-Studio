# Local Real MVP M44 API 默认运行与原型 UI 清理验收报告

日期：2026-07-08

## 1. 阶段目标

修复本地打开页面仍进入 mock 原型态的问题，让默认本地运行接入真实 API 状态源，并移除聊天区静态 `PPT 页面生成中` 原型卡。

## 2. 根因

- `createDefaultWorkbenchDataSource()` 默认返回 development adapter，只有设置 `NEXT_PUBLIC_WORKBENCH_DATA_SOURCE=api` 才走真实 API。
- `ConversationWorkbench` 在 `messages.length > 0` 时无条件渲染 `GenerationPanel`，而 `GenerationPanel` 内容是硬编码的 `PPT 页面生成中 8 / 12`。

## 3. 实现结果

- 默认 data source 改为 `createWorkbenchApiClient()`。
- 仅当 `NEXT_PUBLIC_WORKBENCH_DATA_SOURCE=mock` 时启用 development adapter。
- 聊天主区不再导入或渲染静态 `GenerationPanel`。
- 保留右侧产物轨和详情页作为真实产物操作入口。
- `tsconfig.json` 排除本地生成目录，避免 `desktop-bundle`、`dist-desktop` 等忽略产物参与 Next 类型检查。

## 4. 验收记录

已执行：

```powershell
node --test tests\workbench-api.test.mjs tests\m44-runtime-ui.test.mjs
```

结果：

- RED：修改前 2 项失败，分别命中默认 mock 与静态生成卡。
- GREEN：修改后 14/14 通过。

补充执行：

```powershell
node --test tests\password-auth.test.mjs
npm test
npm run build
```

结果：

- `node --test tests\password-auth.test.mjs`：通过，3/3。顺手修复固定测试时钟与真实 `Date.now()` 混用导致的日期边界失败。
- `npm test`：通过，Node 97/97，Vitest 24 files / 92 tests。
- `npm run build`：通过，Next.js 生产构建、TypeScript 与页面生成均成功。

浏览器复验：

- `http://127.0.0.1:3002/api/workbench/projects` 返回真实 API 项目列表。
- 默认页面未出现三条 mock 种子项目。
- 默认页面未出现 `PPT 页面生成中` 或 `8 / 12`。
- 新建项目后发送 `你好`，后端 `/messages` 返回 201，页面显示 AI 回复 `需求规格说明书已生成`。

截图证据：

- `test-results\m44-local-runtime-clean.png`
- `test-results\m44-local-send-hi.png`
