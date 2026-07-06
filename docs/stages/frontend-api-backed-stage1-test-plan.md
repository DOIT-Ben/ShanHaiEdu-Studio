# Frontend API-backed Workbench Stage 1 Test Plan

日期：2026-07-07

## 1. 测试目标

验证 Stage 1 是否把前端状态入口迁移到统一 data source，并在不重写 UI 的前提下保留现有关键交互。测试先于开发落地，开发完成后集中执行验收。

## 2. 自动化测试

### 2.1 API client 与 adapter 单元测试

命令：

```powershell
npm test
```

覆盖：

- `createWorkbenchApiClient().listProjects()` 请求 `GET /api/workbench/projects`。
- `getProjectSnapshot(projectId)` 请求 `GET /api/workbench/projects/:projectId/snapshot`。
- `sendMessage(projectId, body, reference)` 请求 `POST /api/workbench/projects/:projectId/messages`，body 包含用户输入和引用。
- API 返回非 2xx 时归一化为教师可理解错误。
- development adapter 能返回项目列表和 snapshot。
- development adapter 发送消息后追加 teacher/assistant 消息，并更新产物状态。
- approve/regenerate 返回更新后的 snapshot，而不是只改本地按钮状态。

### 2.2 类型检查

命令：

```powershell
npx tsc --noEmit
```

通过标准：

- exit code 0。
- 无 TypeScript 错误。

### 2.3 构建检查

命令：

```powershell
npm run build
```

通过标准：

- exit code 0。
- 页面可静态编译或按 Next.js 当前配置完成构建。

### 2.4 Lint 现状记录

命令：

```powershell
npm run lint
```

通过标准：

- 若命令可运行，exit code 0。
- 若 Next 16 下 `next lint` 不可用，记录为工具脚本债务，不把 lint 伪装为已通过。

## 3. 手工浏览器验收

### 3.1 桌面宽屏

视口建议：1440x900。

检查项：

- 页面仍是纯白、极简、Codex 风格工作台。
- 左侧项目列表来自 controller 数据。
- 当前项目切换后，中间对话和右侧节点同步变化。
- 首次加载期间有低噪声加载态。
- 输入一句需求后发送，输入框清空，对话追加用户消息和系统回复。
- 右侧节点状态随发送结果更新。
- 点击节点打开右侧阅读侧栏，再次点击同节点可关闭。
- hover 预览与详情侧栏不冲突。
- 复制按钮可用；剪贴板失败时显示可理解提示。
- 作为输入会把产物摘要插入输入框。
- 确认、重做可触发状态更新和提示。

### 3.2 窄屏

视口建议：390x844。

检查项：

- 左侧项目入口折叠到抽屉。
- 产物入口在顶部按钮打开抽屉。
- 对话仍是第一视觉，不被节点内容挤压。
- 输入框不溢出，按钮文字不重叠。
- 产物详情 sheet 可打开、复制、作为输入、确认和重做。

## 4. 用户可见文案红线

命令：

```powershell
rg -n "schema|manifest|provider|node_id|storage|API|debug|local path" src
```

判断：

- 命中的代码标识符允许存在。
- 用户可见 JSX 文案中不得出现这些工程词。
- 若命中用户可见文案，必须改成教师可理解表达。

## 5. 阶段收尾检查

- `git status --short` 只包含本阶段授权文件。
- 文档、测试、实现属于同一阶段目标。
- 不修改 `main`。
- 不 push。
- 提交信息使用中文格式：`feat: 前端工作台接入数据源骨架 | v0.4.6 | 2026-07-07 HH:MM`。

