# Local Real MVP M0 Baseline Report

日期：2026-07-07

## 1. 阶段目标

M0 目标是确认 `mainline/local-real-mvp` 可以作为 ShanHaiEdu 本地真实可用 MVP 的继续推进基线。当前阶段不新增产品能力，不验证浏览器真实闭环，只验证分支、测试、构建和 M1 前置门禁是否可信。

## 2. 基线确认

| 项目 | 结果 |
| --- | --- |
| 工作目录 | `E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\local-real-mvp-mainline` |
| 当前分支 | `mainline/local-real-mvp` |
| 跟踪分支 | `origin/mainline/local-real-mvp` |
| 本轮新增文档 | M0 plan、M0 test plan、M0 baseline report |
| 旧并行支线状态 | 本阶段不修改、不删除；仅以 `docs\mainlines\local-real-mvp.md` 作为后续入口 |

## 3. 验收记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `git status --short --branch` | 通过 | 当前分支为 `mainline/local-real-mvp`，验收前仅有本轮 M0 文档未跟踪 |
| `npm test` | 通过 | Node 9 tests passed；Vitest 11 files / 63 tests passed |
| `npm run build` | 通过 | Prisma Client 生成成功；Next.js 编译成功；TypeScript 成功；静态页面 4/4 生成成功 |
| `npm run test:e2e:stage2:preflight` | 通过 | 5 项检查全部 `ok=true`，`blockers=[]` |
| 测试 worker 残留检查 | 通过 | 未发现匹配 Vitest/Jest/Playwright 的残留 Node 进程 |

## 4. 排障记录

首次运行 `npm test` 失败，错误为 `Cannot find module 'dotenv/config'`。排查结果：

- `package.json` 和 `package-lock.json` 均已有 `dotenv` 声明。
- 当前 worktree 没有 `node_modules`，`node_modules\dotenv` 与 `node_modules\.bin\prisma.cmd` 均不存在。
- 执行 `npm ci` 后依赖按 lockfile 恢复，随后 `npm test` 通过。

`npm ci` 额外提示 5 个 moderate severity vulnerabilities。本阶段不执行 `npm audit fix --force`，因为这会引入依赖升级和潜在破坏性变更，超出 M0 基线确认范围。

## 5. 风险与边界

- Stage 2 preflight 通过只说明 M1 浏览器真实闭环具备前置条件，不等价于浏览器流程已通过。
- 本阶段没有运行真实 OpenAI、PPTX、图片或视频 provider。
- 本阶段没有部署、push、删除旧 worktree 或归档旧分支。
- Next.js build 使用自身 worker 策略完成静态页面生成；未发现验收后测试 worker 残留。

## 6. 审查结论

M0 基线通过。当前主线可以进入 M1：浏览器真实 MVP 闭环。

进入 M1 前应先写 M1 阶段规划和测试定义，重点验证：

- 本地浏览器打开工作台。
- 新建项目。
- 输入一句话需求。
- 生成需求规格 artifact。
- 右侧节点显示真实产物。
- 确认产物。
- 刷新后状态恢复。
- 普通教师界面不暴露工程词。
