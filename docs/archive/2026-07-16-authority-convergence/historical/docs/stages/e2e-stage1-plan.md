# E2E Verification Stage 1 Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

E2E Verification 主线的第一阶段不证明 ShanHaiEdu MVP 已经真实闭环，而是建立后续可以持续证明真实闭环的验收体系。当前仓库仍是 Next.js 前端原型，项目、对话、节点和产物来自 `src\lib\mock-data.ts`，输入发送只清空本地状态；因此本阶段成功标准必须落在“测试基础设施可运行、证据可定位、边界可阻塞”，不能把现有 mock 交互说成真实 MVP 验收通过。

本阶段目标：

- 将整条 E2E 主线拆成不超过 20 个可持续阶段。
- 调研并落地本仓库可运行的 Playwright 骨架。
- 提供稳定测试数据、用户界面工程词红线扫描、阶段报告模板。
- 让后续阶段能用同一套命令产出截图、trace、JSON/HTML 报告和失败归因。

## 2. 可复用方案调研

已核对项目既有约束：

- `AGENTS.md` 要求阶段规划、测试定义、集中验收、资源受控测试和新鲜证据。
- `REQUIREMENTS_DECISION_V1.md` 要求覆盖新建项目、输入需求、节点查看、复制、作为输入、确认、重做、刷新恢复、双项目隔离、无工程词。
- `docs\mainlines\e2e-verification.md` 已指定 Playwright、API smoke、DeterministicRuntime、`npm run build` 为主线可复用方案。
- 当前 `package.json` 尚无测试工具，仅有 `dev`、`build`、`start`、`lint`。

已调研官方 Playwright 文档，Stage 1 复用以下能力：

- Playwright Test 配置：`webServer` 启动本地 Next.js 服务，`workers` 限制并发。
- Reporter：同时保留终端摘要、JSON 机器报告、HTML 人工排查报告。
- Trace / screenshot / video：失败时保留可定位证据，成功用截图覆盖关键视口。
- Test projects：先以 Chromium 桌面为 Stage 1 集中验收目标，后续阶段再增加窄屏和多会话矩阵。

参考来源：

- Playwright Test configuration: https://playwright.dev/docs/test-configuration
- Playwright reporters: https://playwright.dev/docs/test-reporters
- Playwright trace viewer: https://playwright.dev/docs/trace-viewer
- Playwright screenshots: https://playwright.dev/docs/screenshots

## 3. 复用、适配和必要自研

复用：

- 使用 Playwright 作为唯一浏览器 E2E 框架，不另起 Cypress、Puppeteer 或自研浏览器驱动。
- 使用项目现有 Next.js `npm run dev` 作为 Stage 1 web server。
- 使用用户可见文本和无障碍名称作为测试入口，减少对 Tailwind class 的绑定。

适配：

- `playwright.config.ts` 固定 `workers: 2`，符合本地 Windows 资源受控要求。
- 测试输出写入 `test-results\e2e`、`playwright-report`、`test-results\e2e-stage1-results.json`，并在 `.gitignore` 忽略运行产物。
- Stage 1 只验证测试基础设施和当前前端可见红线，不验证真实保存、真实生成或刷新恢复完成。

必要自研：

- `tests\e2e\support\redline.ts`：维护用户界面禁止暴露的工程词清单，并从页面可见文本扫描。
- `tests\e2e\support\stage1-fixtures.ts`：维护后续阶段复用的教师输入、项目名和视口数据。
- `tests\e2e\stage1-foundation.spec.ts`：验证页面可打开、核心壳层可交互、节点详情可打开、红线词扫描可运行、截图证据可保存。
- `docs\stages\e2e-stage1-report-template.md`：阶段验收报告模板，明确成功、阻塞和跨主线归因格式。

## 4. 开发方案、风险和验证标准

开发步骤：

1. 新增 `@playwright/test` 开发依赖。
2. 新增 `playwright.config.ts`，配置 `webServer`、报告、证据、桌面项目和 worker 限制。
3. 新增 Stage 1 测试数据、红线扫描 helper 和基础 E2E spec。
4. 新增 Stage 1 报告模板。
5. 更新 `.gitignore` 和 `package.json` 测试脚本。
6. 集中执行 Stage 1 验收命令并修复测试代码问题。
7. 提交本阶段文档、配置和测试资产。

不做：

- 不实现新建项目、后端 API、真实 runtime 或持久化。
- 不修改业务组件来让测试通过，除非发现测试可访问性入口缺失且属于测试基础设施所需的低风险标记。
- 不把现有 mock 交互记为真实 MVP 通过。

风险：

- Playwright 浏览器未安装：通过 `npx playwright install chromium` 修复，若网络失败则记录阻塞。
- Next.js 16 本地启动慢：配置 web server timeout，并优先复用已有服务。
- 红线扫描误报文档或源码词：扫描范围只取浏览器当前页面可见文本，不扫源码。
- 后续主线未合入真实 API：Stage 1 只输出阻塞边界，等待后续阶段输入。

集中验收标准：

- `npm run build` exit 0。
- `npm run test:e2e:stage1` exit 0。
- `test-results\e2e-stage1-results.json` 生成。
- `playwright-report` 可生成 HTML 报告。
- 失败时 `test-results\e2e` 有 trace 或 screenshot。
- 文档明确本阶段不代表真实 MVP E2E 完成。
