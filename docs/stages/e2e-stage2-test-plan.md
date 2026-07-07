# E2E Verification Stage 2 Test Plan

日期：2026-07-07

## 1. 测试目标

Stage 2 目标是验证 deterministic 基础用户路径。测试必须证明本地 MVP 通过真实状态源完成最小闭环，而不是证明静态 mock 页面可点击。

## 2. 前置检测

命令：

```powershell
npm run test:e2e:stage2:preflight
```

通过标准：

- 存在 `src\app\api\workbench`。
- 存在服务端 `DeterministicRuntime` 边界。
- 工作台前端不再默认从 `@/lib/mock-data` 读取项目、消息和产物。
- 存在项目 snapshot contract。
- 存在 artifact approval route 或 API-backed client contract。

任一条件不满足时，Stage 2 不运行 browser E2E，并输出阻塞报告。

## 3. Browser E2E 用例（preflight 通过后执行）

| 用例 | 目的 | 通过标准 |
| --- | --- | --- |
| 新建项目 | 验证项目真实创建 | 左侧项目栏出现新项目，刷新后仍存在 |
| 输入需求 | 验证消息真实保存 | 用户消息和系统回复来自 API 状态，刷新后仍存在 |
| 生成需求规格 | 验证 deterministic artifact | 右侧出现需求规格节点，详情可打开 |
| 用户确认 | 验证确认状态保存 | 节点显示已确认，刷新后仍为已确认 |
| 作为输入 | 验证上游复用入口 | 输入框插入上游摘要，不泄露工程字段 |
| 红线扫描 | 验证教师界面纯净 | 可见文本不命中工程词 |

## 4. 集中验收命令

preflight 通过后新增并执行：

```powershell
npm run build
npm run test:e2e:stage2
```

资源约束：

- 首轮仅 Chromium desktop。
- worker 仍限制为 2。
- 不把 OpenAI Runtime 纳入 Stage 2。

## 5. 阻塞归因规则

- 缺 API route 或 snapshot：Backend Workflow Lite。
- 前端仍从 `mock-data` 取状态：Frontend API-backed Workbench。
- 缺 DeterministicRuntime：Agent Runtime Adapter。
- 缺 artifact approve 合同：Backend Workflow Lite / Frontend API-backed Workbench。
- Playwright 配置或选择器问题：E2E Verification。
