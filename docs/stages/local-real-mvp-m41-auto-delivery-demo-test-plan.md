# Local Real MVP M41 一键自动交付演示测试定义

日期：2026-07-08

## 1. 行为红线

M41 必须证明：

- 一条命令可以完成本地自动交付演示。
- 演示产物不是只看 UI 文案，而是下载并检查最终 ZIP 包。
- 报告能给下一位 agent 或用户直接判断本次交付是否成功。
- 本阶段不把 local substitute 冒充真实 provider live。

## 2. 红灯测试

### 2.1 `tests\stage41-delivery-demo-script.test.mjs`

覆盖：

- `package.json` 暴露 `demo:e2e:delivery`。
- `package.json` 暴露 `test:e2e:stage41`。
- `scripts\run-stage41-delivery-demo.mjs` 存在。
- 脚本文本包含：
  - `stage41-delivery-demo.db`
  - `stage41-delivery-demo-report.json`
  - `stage41-auto-delivery-demo.spec.ts`
  - `E2E_PORT`
  - `findAvailablePort`
- 脚本不会直接读取或打印 `.env` 内容。

红灯预期：

- 当前这些脚本与 package 命令不存在。

命令：

```powershell
node --test tests\stage41-delivery-demo-script.test.mjs
```

## 3. E2E 验收

### 3.1 `tests\e2e\stage41-auto-delivery-demo.spec.ts`

覆盖：

- 自动创建项目和发送固定需求。
- 自动确认核心节点。
- 自动触发本地真实素材 fixture 写入真实 artifact。
- 下载 PPTX/PNG/MP4 并做魔数校验。
- 下载最终 ZIP 并检查 entries。
- 生成 JSON/Markdown 报告。

命令：

```powershell
npm run demo:e2e:delivery
```

## 4. 集中验收命令

```powershell
node --test tests\stage41-delivery-demo-script.test.mjs
npm run demo:e2e:delivery
npm test
npm run build
git diff --check
```

## 5. 报告验收

检查：

- `test-results\stage41-delivery-demo-report.json` 存在。
- `test-results\stage41-delivery-demo-report.md` 存在。
- JSON 中：
  - `ok` 为 `true`。
  - `mode` 为 `local-substitute`。
  - `packageEntries` 包含 `README.md`、`final-delivery.md`、`ppt-outline.pptx`、`classroom-visual.png`、`intro-video.mp4`。
  - `checks` 全部通过。
