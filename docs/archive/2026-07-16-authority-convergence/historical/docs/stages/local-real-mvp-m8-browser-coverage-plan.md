# Local Real MVP M8 Browser Coverage Plan

日期：2026-07-07

## 1. 阶段目标

M8 目标是补齐本地真实 MVP 的浏览器覆盖证据：在 M1-M5 主链路已通过 Chromium desktop 后，继续验证窄屏视口和非 Chromium 浏览器下的关键工作流可用。

第一性原理判断：

- 本地真实 MVP 不是只在一个大屏桌面窗口跑通；教师可能用窄屏窗口、笔记本分屏或不同浏览器试用。
- M8 不扩写业务能力，只扩大同一条真实主链路的运行环境证据。
- 若本机缺少某个浏览器二进制，应记录为环境阻塞，不能把未执行的浏览器验证包装为通过。

## 2. 可复用方案调研

项目内可复用资产：

- `playwright.config.ts` 已集中定义 Playwright project、viewport、worker、webServer 和 baseURL。
- `tests\e2e\stage2-deterministic.spec.ts` 已覆盖 M1-M5 主链路，适合复用为浏览器覆盖基准。
- `scripts\run-stage2-e2e.mjs` 已提供独立 SQLite 测试库、schema 初始化和单 worker 运行方式。
- `tests\e2e\support\redline.ts` 已支持教师可见工程词扫描。

外部成熟方案：

- Playwright Test 官方 projects 支持同一测试以不同浏览器和设备配置运行。
- Playwright 官方 emulation/viewport 配置支持通过 project 或 test 配置设置 viewport。

## 3. 复用、适配与自研边界

复用：

- 复用 Stage 2 主链路，不复制业务断言。
- 复用独立 SQLite 测试库模式，避免污染 `dev.db`。
- 复用 Playwright project 机制，不自研浏览器启动器。

适配：

- 在 `playwright.config.ts` 增加 `chromium-narrow` 与 `firefox-desktop` projects。
- 新增 M8 runner，串行运行 Stage 2 spec 在窄屏 Chromium 和 Firefox desktop 上的验证。
- 新增 package script `npm run test:e2e:stage8`。

暂不自研：

- 不新增视觉截图比对系统。
- 不引入 WebKit，避免本轮覆盖面过大。
- 不修改业务代码，除非 M8 验收暴露真实响应式或浏览器兼容缺口。

## 4. 开发方案、风险和验证标准

执行顺序：

1. 写 M8 测试计划。
2. 增加 M8 runner 与 package script，先运行并确认因缺少目标 Playwright project 失败。
3. 在 `playwright.config.ts` 增加目标 projects。
4. 运行 M8 集中验收。
5. 若窄屏或 Firefox 暴露真实缺口，按 TDD 最小修复；若是本机浏览器二进制缺失，记录环境阻塞。
6. 重跑 `npm test`、`npm run build`、M1-M5 主链路、M7 隔离和 M8 覆盖。
7. 写 M8 报告并提交。

主要风险：

- 窄屏下三栏工作台可能出现文本溢出、按钮不可见或阅读侧栏遮挡。
- Firefox 未安装或二进制缺失时，M8 不能宣称 Firefox 通过。
- 同一 Stage 2 spec 路径较长，跨项目运行耗时增加；本轮保持 Playwright worker 为 1。
- M6 live OpenAI smoke 仍不在 M8 范围内，不能因 M8 通过而标记真实模型完成。

验证标准：

- `npm run test:e2e:stage8` 通过，且输出明确包含 `chromium-narrow` 与 `firefox-desktop` 执行结果。
- `npm run test:e2e:stage2` 仍通过，证明 desktop Chromium 主链路未回归。
- `npm run test:e2e:stage7` 仍通过，证明双上下文隔离未回归。
- `npm test` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- M8 变更不引入密钥、token 或私钥文件特征。
