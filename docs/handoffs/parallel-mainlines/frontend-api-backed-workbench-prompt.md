# 目标模式 Hand off：Frontend API-backed Workbench

你现在接手 `ShanHaiEdu-Studio` 的 Frontend API-backed Workbench 主线。请进入目标模式，而不是只做一次性回复。

## 目标模式

如果当前环境支持 goal / 目标工具，第一步请创建目标：

```text
完成 ShanHaiEdu-Studio Frontend API-backed Workbench 主线的 MVP 可合并版本：保留当前 Codex 风格工作台，把项目、对话、节点、产物和确认状态从 mock 数据迁移到真实 API-backed controller，并通过桌面与窄屏验收。
```

如果当前环境没有 goal 工具，也要在回复开头明确这个目标，并持续推进到目标完成。不要写完规划就停；规划只是第一步。只有满足以下任一条件才允许结束：

- 本主线目标完成，测试和构建通过，变更已提交，且给出可合并说明。
- 出现同一个外部阻塞连续三轮无法绕过，已写清已知事实、阻塞点、已尝试动作、下一步最小动作。

## 工作目录

```powershell
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\frontend-api-backed-workbench
```

进入该 worktree 后先执行：

```powershell
git status --short --branch
```

## 必读材料

1. `AGENTS.md`
2. `REQUIREMENTS_DECISION_V1.md`
3. `docs\mainlines\README.md`
4. `docs\mainlines\frontend-api-backed-workbench.md`
5. `src\components\layout\MediaWorkbench.tsx`
6. `src\hooks\useWorkbenchController.ts`
7. `src\lib\types.ts`

## 主线目标

保留现有 Codex 风格 UI，把前端从 mock 数据源迁移到真实 API-backed controller：

- 项目列表真实加载。
- 当前项目 snapshot 可恢复。
- 发送消息后同步真实对话和节点状态。
- artifact 详情来自后端。
- 复制、作为输入、确认、重做交互不回退。

## 执行协议

严格按项目准则执行：

```text
调研现有组件和状态边界
-> 写阶段规划文档
-> 写测试文档或 Playwright 验收计划
-> 按规划开发
-> 按测试文档集中验收
-> 视觉审查与修正
-> 收尾记录
-> 提交本主线变更
```

第一阶段必须先产出：

- `docs\stages\frontend-api-backed-stage1-plan.md`
- `docs\stages\frontend-api-backed-stage1-test-plan.md`

写完规划和测试文档后继续推进。若后端合同尚未完成，先实现 API client 边界、加载态、错误态、adapter seam 和可替换 mock server，不要把 mock 伪装成真实状态。

## 边界

- 不重写 UI。
- 不破坏纯白极简风格。
- 不直接在 React 组件里接 OpenAI SDK。
- 不让 mock 数据继续充当真实状态。
- 用户界面不出现工程词。

## 阶段验收

阶段完成前必须证明：

- 项目列表可从 API 或明确标注的开发 adapter 加载。
- 项目 snapshot 可恢复。
- 发送消息后对话和节点同步更新。
- 复制、作为输入、确认、重做不回退。
- 桌面和窄屏浏览器检查通过。
- `npm run build` 通过。
- 用户可见界面无工程词。

## 收尾要求

完成后提交本 worktree 的变更，提交信息使用中文格式：

```text
类型: 简要描述 | 版本号 | YYYY-MM-DD HH:MM
```

最终回复要说明：完成了什么、关键文件、验证命令和结果、剩余风险、是否可以合并到 `main`。
