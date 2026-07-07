# Local Real MVP M8 Browser Coverage Test Plan

日期：2026-07-07

## 1. 测试目标

M8 测试目标是确认 M1-M5 文本主链路不仅能在 Chromium desktop 运行，也能在窄屏 Chromium 和 Firefox desktop 运行。

本阶段不验证真实 OpenAI、PPTX、图片、视频、账号权限或生产部署。

## 2. 集中验收命令

### M8-1：目标 project 红灯验证

```powershell
npm run test:e2e:stage8
```

首次红灯通过标准：

- 在新增 M8 runner 但尚未配置目标 Playwright project 时，命令失败。
- 失败原因指向缺少 `chromium-narrow` 或 `firefox-desktop` project。
- 失败不是 TypeScript 语法错误、路径错误或数据库初始化错误。

### M8-2：浏览器覆盖主验收

```powershell
npm run test:e2e:stage8
```

通过标准：

- `chromium-narrow` 通过。
- `firefox-desktop` 通过。
- 两个 project 都复用 `tests\e2e\stage2-deterministic.spec.ts`。
- 窄屏和 Firefox 下教师可见工程词扫描仍为空命中。
- 窄屏和 Firefox 下刷新恢复仍通过。

若失败：

- 如果是浏览器二进制缺失，记录环境阻塞和安装命令，不标记该浏览器通过。
- 如果是 UI 或兼容性缺口，按失败点新增或收窄测试后最小修复。

### M8-3：既有主链路回归

```powershell
npm run test:e2e:stage2
```

通过标准：

- Chromium desktop 通过。
- M1-M5 单项目主链路未回归。

### M8-4：本地隔离回归

```powershell
npm run test:e2e:stage7
```

通过标准：

- 双 browser context 隔离仍通过。
- 两个上下文刷新后仍保持各自项目。

### M8-5：全量单元与构建

```powershell
npm test
npm run build
```

通过标准：

- `npm test` exit 0，失败数为 0。
- `npm run build` exit 0。

### M8-6：收尾审查

```powershell
git diff --check
git status --short --branch
```

通过标准：

- 无空白错误。
- 工作树只包含 M8 授权范围内变更。
- 未提交密钥、token、私钥或真实凭据。
