# Local Real MVP M41 一键自动交付演示验收报告

日期：2026-07-08

## 1. 阶段目标

M41 目标是把 M1-M40 已有能力串成一条本地可复跑的自动交付演示命令：

```text
npm run demo:e2e:delivery
```

该命令必须自动初始化干净 SQLite 数据库、启动浏览器工作台、创建项目、输入公开课需求、确认核心节点、触发 PPTX/图片/视频本地替身产物、下载最终 ZIP，并输出机器可读 JSON 与人工可读 Markdown 验收报告。

## 2. 实现结果

- 新增 `demo:e2e:delivery` 与 `test:e2e:stage41` 两个 package 命令。
- 新增 `scripts\run-stage41-delivery-demo.mjs`，负责清理 M41 专用数据库和报告、初始化 schema、选择可用 E2E 端口并运行 Playwright。
- 新增 `tests\e2e\stage41-auto-delivery-demo.spec.ts`，覆盖自动创建项目、发送公开课需求、确认核心文本产物、生成并下载 PPTX/PNG/MP4、下载 ZIP、检查 ZIP entries 与教师界面工程词红线。
- 新增 `tests\stage41-delivery-demo-script.test.mjs`，固定一键命令、报告文件、端口回退和脱敏约束。
- 新增 M41 规划与测试定义文档。

## 3. 本次演示证据

`npm run demo:e2e:delivery` 本次生成：

- `test-results\stage41-delivery-demo-report.json`
- `test-results\stage41-delivery-demo-report.md`

报告关键结果：

- `ok=true`
- `mode=local-substitute`
- `packageEntries` 包含：
  - `README.md`
  - `final-delivery.md`
  - `ppt-outline.pptx`
  - `classroom-visual.png`
  - `intro-video.mp4`

## 4. 边界说明

- M41 证明的是本地一键自动交付演示闭环，不证明真实外部 provider 已稳定生产。
- PPTX、图片、视频在本阶段使用本地 substitute fixture，经真实 artifact 保存、下载 route 和 ZIP 打包 route 流转。
- 报告中保留 `mode=local-substitute`，防止把替身能力误标为 live provider。
- 若默认端口被本机代理或历史服务占用，脚本会自动在 `3127-3199` 内选择可用端口；用户显式设置 `E2E_PORT` 时优先尊重显式配置。

## 5. 验收命令

已执行：

```powershell
node --test tests\stage41-delivery-demo-script.test.mjs
npm run demo:e2e:delivery
npm test
npm run build
git diff --check
```

结果：

- `node --test tests\stage41-delivery-demo-script.test.mjs`：通过，1/1。
- `npm run demo:e2e:delivery`：通过，Chromium desktop 1/1；输出 `ok=true`，本次自动选择端口 `3127`。
- `npm test`：通过，Node 92/92，Vitest 24 files / 92 tests。
- `npm run build`：通过，Next.js 生产构建、TypeScript 与页面生成均成功。
- `git diff --check`：通过，无空白错误。
- 残留进程检查：未发现本项目 Playwright/Vitest/Jest/Next dev 残留 Node 进程。
- 敏感形态扫描：M41 相关新增文件未命中密钥、凭据、私钥或授权头形态。
