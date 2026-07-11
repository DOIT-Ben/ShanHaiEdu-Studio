# Local Real MVP M75 登录后欢迎首页计划

更新时间：2026-07-11

## 1. 目标

把认证后的默认入口从“自动恢复旧项目对话”改为“先看欢迎首页、再主动进入项目”，让教师每次登录或刷新后明确选择本次备课任务。

## 2. 范围与边界

- 修改 RQ-018、M75 plan/test-plan、`useWorkbenchController`、`MediaWorkbench`、独立欢迎组件、直接相关 CSS 与测试。
- 启动时只调用 active 项目列表；不读取 active 项目本地记录、不抓 snapshot、不选择首个项目。
- 用户主动 select/create 后沿用现有 snapshot、消息、产物、轮询和本地记录行为。
- 归档/回收站只切换列表，不自动进入项目；返回 active 列表也停留欢迎首页。
- 不修改认证 API、项目后端、对话数据、历史数据、反馈和产物业务逻辑，不新增依赖。

## 3. 实施设计

1. Controller 初始化保持 `activeProjectId`、messages、artifacts、turnJobs 为空，加载 `listProjects("active")` 后直接进入 `ready`。
2. `openProjectView` 仅加载目标生命周期列表并清空 active project，不从 localStorage 或列表首项恢复项目。
3. 新增 `AuthenticatedWelcome`：显示教师称呼、核心问题、真实能力说明、新建入口，以及 active 项目列表前 4 项；项目行展示标题、meta/currentStep 和更新时间。
4. `MediaWorkbench` 在 active project 为空时只渲染欢迎首页；存在 active project 时才渲染 `ConversationWorkbench`、`ArtifactSidePanel`、桌面 rail 和移动产物入口。
5. 桌面和移动项目侧栏继续使用 select/create wrapper。移动新建 wrapper 等待真实 create 结果后再关闭 sheet，失败时保持 controller 的欢迎状态。
6. 欢迎页使用一次性低幅度 opacity/translate 动画；reduced motion 下禁用。

## 4. 风险与回退

- 风险：旧源码合同测试假设工作台始终渲染对话或产物入口。控制：只更新与新入口条件冲突的断言，保留项目进入后的原合同。
- 风险：create 是异步函数但旧 wrapper 未等待。控制：明确返回 Promise，并仅在成功后关闭移动 sheet。
- 风险：项目列表错误时误展示历史对话。控制：初始化不加载 snapshot，错误态仍保持 active project 和对话数据为空。
- 回退：可独立回退 M75 文档、欢迎组件、controller 启动分支、MediaWorkbench 条件渲染、CSS 和测试；不涉及数据迁移或删除。

## 5. 成功标准

- 登录和刷新后先看到欢迎页，没有自动旧对话和产物 rail。
- 教师主动选择或成功新建项目后进入真实对话；失败不误进入。
- 定向测试、`tsc --noEmit`、单 worker 全量测试、生产构建和 `git diff --check` 通过。
- 浏览器验证由主代理执行，本执行代理不代报通过。
