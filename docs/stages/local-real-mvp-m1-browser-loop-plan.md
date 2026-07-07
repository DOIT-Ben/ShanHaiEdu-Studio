# Local Real MVP M1 Browser Loop Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M1 的核心需求是证明普通教师可以在本地浏览器里完成一条真实可保存的最小备课闭环，而不是只证明 API、组件或 preflight 存在。

本阶段最小闭环为：

```text
打开工作台
-> 新建项目
-> 输入一句话备课需求
-> 生成需求规格说明书
-> 右侧节点显示真实产物
-> 打开详情
-> 确认产物
-> 刷新页面
-> 状态恢复
```

M1 可以继续使用 deterministic runtime，但必须通过真实浏览器、真实 API-backed 状态源和真实 SQLite 测试库完成。不能把静态 mock、placeholder 或未保存的前端状态当作通过。

## 2. 可复用方案调研

本阶段优先复用当前主线已有资产：

- `npm run test:e2e:stage2` 已存在，入口为 `scripts\run-stage2-e2e.mjs`。
- `scripts\run-stage2-e2e.mjs` 会使用独立测试库 `test-results\stage2-e2e.db`，并设置 `NEXT_PUBLIC_WORKBENCH_DATA_SOURCE=api`。
- `tests\e2e\stage2-deterministic.spec.ts` 已覆盖 M1 目标路径：新建项目、发送需求、需求规格产物、详情、确认、刷新恢复和教师可见工程词红线扫描。
- `playwright.config.ts` 已配置 Chromium desktop、trace/screenshot/video on failure、webServer 和 worker 环境变量。
- `src\hooks\useWorkbenchController.ts` 已通过 `createDefaultWorkbenchDataSource()` 接入 API-backed data source。
- M0 preflight 已证明后端 API、deterministic runtime、snapshot contract 和 artifact approval contract 存在。

## 3. 复用、适配和必要自研

复用：

- 直接复用 `npm run test:e2e:stage2` 作为 M1 集中验收主命令。
- 继续复用 Stage 2 的红线扫描，确保普通教师界面不暴露工程词。
- 继续复用独立 SQLite 测试库，避免污染 `dev.db`。

适配：

- M1 报告需要把 Stage 2 E2E 命令明确提升为 Local Real MVP 的浏览器闭环证据。
- M1 报告需要记录截图路径、数据库隔离方式、浏览器项目和剩余风险。

必要自研：

- 若 `npm run test:e2e:stage2` 直接通过，本阶段只新增 M1 文档和验收报告，不修改产品代码。
- 若验收失败，先按失败点写最小复现，再用测试优先方式修复真实缺口。

## 4. 开发方案、风险和验证标准

执行方案：

1. 完成 M1 阶段规划和测试定义。
2. 运行 `npm run test:e2e:stage2`。
3. 若失败，定位真实失败点，优先补测试或修正现有 E2E，再做最小实现修复。
4. 若通过，检查 Playwright 输出、截图证据和工作树状态。
5. 写入 `docs\stages\local-real-mvp-m1-browser-loop-report.md`。
6. 执行审查：是否满足 M1 需求、是否误把 deterministic 当真实模型、是否泄露工程词、是否产生无关改动。
7. 提交 M1 文档、测试定义和报告。

主要风险：

- Playwright 可能因本机端口占用、浏览器依赖或 dev server 启动慢失败。
- 当前 E2E 只覆盖 Chromium desktop，不代表多浏览器或窄屏通过。
- 当前闭环只到需求规格说明书，不覆盖教案、PPT 大纲、导入视频方案或最终交付包。
- deterministic runtime 是开发态可验证运行时，不代表真实模型 provider 已接入。

验证标准：

- `npm run test:e2e:stage2` exit 0。
- Playwright 用例通过：创建项目、发送需求、生成需求规格、打开详情、确认、刷新恢复。
- 页面可见文本工程词红线扫描结果为空。
- 生成至少一张通过路径截图，路径由 Playwright test output 记录。
- 验收后无 Vitest/Jest/Playwright 残留 worker。
- 提交前 `git diff --check` 通过，提交范围只包含 M1 授权文档和必要修复。
