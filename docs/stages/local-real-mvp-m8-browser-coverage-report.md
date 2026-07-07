# Local Real MVP M8 Browser Coverage Report

日期：2026-07-07

## 1. 阶段目标

M8 目标是补齐本地真实 MVP 的浏览器覆盖证据：在既有 Chromium desktop 主链路通过的基础上，验证同一 M1-M5 文本主链路可在窄屏 Chromium 和 Firefox desktop 上运行。

本阶段不验证真实 OpenAI、PPTX、图片、视频、账号权限或生产部署。

## 2. 本轮实现

### 2.1 Playwright projects

更新 `playwright.config.ts`：

- 保留 `chromium-desktop`。
- 新增 `chromium-narrow`，viewport 为 `390 x 844`。
- 新增 `firefox-desktop`，复用 Playwright `Desktop Firefox` 设备配置。

项目配置依据 Playwright 官方 projects 机制：同一测试可通过不同 project 以不同浏览器和设备配置运行。

### 2.2 Stage 8 runner

新增 `scripts\run-stage8-e2e.mjs`：

- 使用独立 SQLite 测试库 `test-results/stage8-e2e.db`。
- 初始化 schema 后运行 `tests\e2e\stage2-deterministic.spec.ts`。
- 串行运行 `chromium-narrow` 与 `firefox-desktop`。
- 复用 API-backed 工作台路径，不污染 `dev.db`。

新增 package script：

- `npm run test:e2e:stage8`

同时更新 `playwright:install`，后续环境可一次安装 Chromium 与 Firefox。

### 2.3 窄屏项目抽屉修复

问题：

- 窄屏下“新建项目”在项目抽屉内。
- 创建项目后抽屉仍保持打开，遮挡对话输入区。

修复：

- `MediaWorkbench` 控制项目抽屉 open state。
- 窄屏从项目抽屉新建或选择项目后自动关闭抽屉。

### 2.4 窄屏产物抽屉修复

问题：

- 窄屏下右侧产物 rail 收进“产物”抽屉。
- 产物抽屉节点缺少完整可访问名称，E2E 无法按“标题 + 状态”定位。
- 点击产物后抽屉不关闭，容易遮挡后续详情操作。

修复：

- `ArtifactNodeCard` drawer variant 增加 `aria-label`，与 desktop rail 的“标题，状态”命名一致。
- `MediaWorkbench` 在窄屏产物抽屉打开详情时自动关闭产物抽屉。

### 2.5 Stage 2 E2E 适配

更新 `tests\e2e\stage2-deterministic.spec.ts`：

- 新增 `createProjectFromVisibleEntry`，桌面走直接“新建项目”，窄屏走“项目”抽屉。
- 新增 `openArtifactDetail`，桌面走右侧 rail + 预览 + 完整详情，窄屏走“产物”抽屉 + 详情。
- 新增 `expectArtifactEntryAvailable`，统一检查桌面 rail 或窄屏产物抽屉中的节点状态。
- 注入测试级 clipboard shim，避免 Firefox 权限差异影响“复制按钮反馈”验证。

## 3. TDD 与调试记录

红灯 1：

- 新增 M8 runner 后先运行 `npm run test:e2e:stage8`。
- 失败原因：缺少 `chromium-narrow` 与 `firefox-desktop` project。
- 结论：runner 能正确暴露缺失 project。

绿灯 1：

- 增加两个 Playwright projects 后，M8 进入真实浏览器执行。

红灯 2：

- `chromium-narrow` 找不到直接可见的“新建项目”。
- 截图显示窄屏入口为顶部“项目”抽屉。
- 修正测试走真实窄屏入口后，继续暴露项目抽屉遮挡输入区。

绿灯 2：

- 项目抽屉新建/选择后自动关闭。

红灯 3：

- 窄屏无法按“需求规格说明书，待确认”定位产物节点。
- 原因是 drawer variant 只显示标题文本，缺少与 desktop 一致的可访问名称。

绿灯 3：

- drawer 产物节点补 `aria-label`。
- 点击产物节点后自动关闭产物抽屉。

红灯 4：

- Firefox 启动后不支持当前 `context.grantPermissions(["clipboard-read", "clipboard-write"])`。
- 该权限差异不属于本阶段主链路目标。

绿灯 4：

- 改为测试级 clipboard shim。
- M8 双 project 主验收通过。

环境补齐：

- 本机最初缺少 Playwright Firefox 二进制。
- 已运行 `npx playwright install firefox` 安装到本机 Playwright 浏览器缓存。

## 4. 验收记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npm run test:e2e:stage8` | 红灯后绿灯 | 首次缺少 project 失败；修复后 `chromium-narrow` 与 `firefox-desktop` 2 passed |
| `npm test` | 通过 | Node 10 tests passed；Vitest 15 files / 68 tests passed |
| `npm run build` | 通过 | Prisma Client 生成成功；Next.js 编译、TypeScript、静态页面生成均通过 |
| `npm run test:e2e:stage2` | 通过 | Chromium desktop 1 passed；M1-M5 主链路未回归 |
| `npm run test:e2e:stage7` | 通过 | Chromium desktop 1 passed；双 browser context 隔离未回归 |
| worker 残留检查 | 通过 | 未发现属于本轮 Vitest/Jest/Playwright 测试的残留 worker；命中项为长期外部 Node 进程 |
| `git diff --check` | 通过 | 无空白错误；仅有工作区换行提示 |

## 5. 风险与边界

- M8 证明窄屏 Chromium 与 Firefox desktop 的 M1-M5 文本链路可跑通，不等于完整移动端 UX 已精修。
- M8 没有验证 WebKit、真实移动设备或触摸手势。
- clipboard shim 只用于稳定 E2E 复制按钮反馈，不代表 Firefox 系统剪贴板权限已作为产品能力验收。
- M6 live OpenAI smoke 仍缺真实凭据，不能因 M8 通过而标记真实模型可用。
- 当前仍不包含真实 PPTX、图片文件或视频成片生成。

## 6. 审查结论

M8 通过。当前主线在 M0-M5 文本主链路、M7 本地双上下文隔离之外，新增了窄屏 Chromium 和 Firefox desktop 的浏览器覆盖证据。

当前状态可以进一步表述为：

> ShanHaiEdu 本地 deterministic 文本 MVP 已在 Chromium desktop、Chromium narrow viewport 和 Firefox desktop 上完成 M1-M5 主链路验证。

仍不能表述为：

- 真实 OpenAI 模型已跑通。
- 真实 PPTX、图片或视频文件已生成。
- 已具备账号权限、生产级多人协作或公网生产部署。
