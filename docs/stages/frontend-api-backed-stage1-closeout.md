# Frontend API-backed Workbench Stage 1 Closeout

日期：2026-07-07

## 1. 阶段结论

Stage 1 已完成，可提交本阶段变更。

本阶段完成的是前端 API-backed 边界和开发态 adapter 纵切，不代表真实后端已合入，也不代表项目、对话、节点和产物已经由生产数据库持久化。真实后端接入属于 Stage 2 与 Backend Workflow Lite 主线集成范围。

## 2. 完成内容

- 新增 `src\lib\workbench-api.ts`：
  - `WorkbenchDataSource` 统一合同。
  - fetch API client。
  - `WorkbenchApiError` 教师可理解错误归一化。
  - `createDevelopmentWorkbenchAdapter` 开发态本地 adapter。
  - `artifactText` 复用序列化。
- 重构 `src\hooks\useWorkbenchController.ts`：
  - 项目列表和 snapshot 通过 data source 加载。
  - 发送消息后同步消息与节点状态。
  - 确认、重做通过 data source 返回 snapshot。
  - 复制、作为输入、详情查看保留。
- 修改 `MediaWorkbench`：
  - 不再直接导入 mock 项目和 mock 对话作为页面真源。
  - 项目、消息、节点和状态均从 controller 进入组件。
- 修改 `ConversationWorkbench`：
  - 增加加载态、空态和错误重试入口。
  - 文案保持教师可理解，不暴露工程词。
- 修改 `ProjectSidebar`：
  - 新建项目按钮接入 controller。
- 新增 `tests\workbench-api.test.mjs` 和 `npm test` 脚本。
- 新增阶段规划与测试文档：
  - `docs\stages\frontend-api-backed-stage1-plan.md`
  - `docs\stages\frontend-api-backed-stage1-test-plan.md`

## 3. 验证证据

自动化：

- `npm test`：通过，3 个测试全部通过。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过，Next.js 16.2.10 production build exit 0。
- `rg -n "schema|manifest|provider|node_id|storage|API|debug|local path" src`：无命中。

浏览器：

- 桌面 `1280x720`：
  - 项目列表、对话、节点可见。
  - 发送消息后用户消息和系统回复追加。
  - 输入框发送后清空。
  - 右侧节点状态同步为待确认。
  - 节点详情、作为输入、重做、确认均验证。
- 窄屏 `390x844`：
  - 项目入口和产物入口可见。
  - 左侧项目栏折叠为抽屉。
  - 产物抽屉可打开。
  - 窄屏详情可打开。
  - 无横向溢出。

本地截图证据未纳入提交，保存在：

- `output\playwright\stage1-desktop.png`
- `output\playwright\stage1-mobile.png`

## 4. 已知问题

- `npm run lint` 未通过。原因是现有脚本为 `next lint`，在当前 Next.js 16 环境下被解析为目录 `lint`，报错：

```text
Invalid project directory provided, no such directory: ...\frontend-api-backed-workbench\lint
```

处理结论：本阶段记录为工具脚本债务，不伪装为通过。后续应引入项目明确的 ESLint 命令或移除失效脚本。

## 5. 风险与边界

- 当前默认数据源仍是 `createDevelopmentWorkbenchAdapter`，只用于后端合同未合入前的前端开发态验收。
- `NEXT_PUBLIC_WORKBENCH_DATA_SOURCE=api` 时会切到 fetch API client，但本分支未新增真实后端 route。
- 真实刷新持久化、双项目数据库隔离、真实 runtime 生成仍需等待 Backend Workflow Lite 与 Agent Runtime Adapter 主线。

## 6. 下一阶段入口

Stage 2 推荐目标：

- 对齐 Backend Workflow Lite 的真实 `project snapshot`、`messages`、`nodes`、`artifacts` 合同。
- 将 `createWorkbenchApiClient` 接到真实 route。
- 增加失败恢复 UI 的真实错误格式映射。
- 验证刷新恢复和两个项目不串数据。

