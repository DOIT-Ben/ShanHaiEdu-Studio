# Local Real MVP M0 Baseline Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M0 的核心需求不是新增功能，而是确认 `mainline/local-real-mvp` 是否可以作为 ShanHaiEdu 本地真实可用 MVP 的唯一推进入口。后续 M1 浏览器真实闭环依赖一个可信基线：分支要明确、历史集成能力要仍然可验证、测试入口要能在当前工作区重新跑通。

M0 只回答三个问题：

- 当前工作区是否位于 `mainline/local-real-mvp`，且没有未解释的本地改动。
- 统一主线已有测试、构建和 Stage 2 preflight 是否仍能在当前本机通过。
- 是否可以把旧并行支线视为历史状态，并把本主线文档作为后续入口。

## 2. 可复用方案调研

本阶段优先复用项目既有门禁，不新增测试框架：

- `docs\mainlines\local-real-mvp.md` 已定义 M0 验收命令。
- `docs\stages\unified-mainline-integration-report.md` 已记录统一主线集成时的通过证据，但该证据只作为历史参考，不能替代本轮新鲜验证。
- `scripts\run-tests.mjs` 已统一编排 Prisma generate、SQLite schema 初始化、Node 测试和 Vitest，并把 Vitest worker 限制为 1。
- `vitest.config.ts` 支持通过 `VITEST_MAX_WORKERS` 控制 worker，符合 Windows 本机资源约束。
- `scripts\e2e-stage2-preflight.mjs` 是 M1 浏览器闭环前的只读能力门禁，可继续复用。

## 3. 复用、适配和必要自研

复用：

- 直接复用 `npm test`、`npm run build`、`npm run test:e2e:stage2:preflight` 作为 M0 集中验收命令。
- 直接复用现有 `docs\stages\` 阶段文档命名与报告风格。

适配：

- M0 报告需要明确区分历史集成证据与本轮重新运行证据。
- M0 报告需要记录分支状态、工作树状态、验证命令、结果和剩余风险。

必要自研：

- 新增 `docs\stages\local-real-mvp-m0-baseline-report.md`，作为本阶段收尾记录。
- 不新增业务代码、不新增测试框架、不修改运行时逻辑。

## 4. 开发方案、风险和验证标准

执行方案：

1. 完成 M0 阶段规划和测试定义。
2. 只读确认分支与工作树状态。
3. 运行 `npm test`。
4. 运行 `npm run build`。
5. 运行 `npm run test:e2e:stage2:preflight`。
6. 写入 M0 baseline report。
7. 执行审查：需求基线、规划符合度、测试证据、敏感信息、工程词风险和提交范围。
8. 若 M0 通过，提交 M0 文档与报告，再进入 M1 阶段规划。

主要风险：

- 本轮命令可能暴露依赖安装、Prisma、Next.js 版本或 SQLite 本机环境问题。
- Stage 2 preflight 通过不等于浏览器真实闭环通过，只能说明 M1 具备进入 browser E2E 的前置条件。
- `npm run build` 可能生成缓存或本地构建产物，提交前必须检查只纳入授权范围内的文档改动。

验证标准：

- `git status --short --branch` 显示当前分支为 `mainline/local-real-mvp`。
- `npm test` exit 0。
- `npm run build` exit 0。
- `npm run test:e2e:stage2:preflight` exit 0。
- M0 report 落到 `docs\stages\local-real-mvp-m0-baseline-report.md`。
- 提交前 `git diff --check` 通过，且不包含密钥、访问凭据或个人敏感信息。
