# Local Real MVP M41 一键自动交付演示规划

日期：2026-07-08

## 1. 第一性原理

用户现在要的不是“某个链路单独能跑”，而是一个生产上线前可反复执行的端到端演示：

```text
一条命令
-> 初始化干净本地数据库
-> 启动本地浏览器工作台
-> 自动创建项目
-> 输入公开课需求
-> 自动推进并确认核心节点
-> 触发 PPTX、图片、视频产物生成
-> 下载最终材料包 ZIP
-> 检查包内 Markdown、PPTX、图片、视频
-> 生成验收报告
```

本阶段核心不是重新发明工作流，而是把 M1-M40 已经通过的能力串成一个“可复跑、可诊断、可交接”的本地演示命令。

## 2. 可复用方案调研

项目内已验证资产：

- `tests\e2e\stage2-deterministic.spec.ts`：完整文本主链路、PPTX 下载、材料包 ZIP 下载、刷新恢复。
- `tests\e2e\stage27-real-generation-linkage.spec.ts`：真实素材 UI 入口、PPTX/图片/视频下载和最终材料包包含素材。
- `scripts\run-stage2-e2e.mjs`、`scripts\run-stage27-e2e.mjs`：临时 SQLite + Playwright 启动模式。
- `JSZip` 与现有 ZIP 解析工具：可检查材料包 entries 与文件内容。
- M40-D 的 password/session/CSRF 闭环：可作为后续登录态自动交付扩展。

成熟方法论：

- 端到端演示命令应隔离数据库、输出报告、保留失败 trace，并把 provider 不稳定与产品逻辑失败分开。
- 浏览器自动化继续复用 Playwright；项目已有稳定配置和多阶段脚本，不引入新框架。

## 3. 复用与适配方式

M41 第一版采用“稳定本地一键完整交付”：

- 复用 stage2 的文本生产与节点确认路径。
- 复用 stage27 的真实素材本地 fixture route substitute，走真实 workbench artifact 保存、下载 route 和材料包打包 route。
- 新增一条命令：

```powershell
npm run demo:e2e:delivery
```

- 命令输出：
  - `test-results\stage41-delivery-demo-report.json`
  - `test-results\stage41-delivery-demo-report.md`
  - Playwright trace/screenshot/video 仍按现有失败策略保留。
- 命令自动探测 `3127-3199` 之间的可用端口并写入 `E2E_PORT`，避免固定 `3117` 被本机代理或历史服务占用时阻断演示。

不在 M41 第一版做：

- 不直接调用真实 Coze/图片/视频 provider，避免每次演示受费用、排队、限流和外部状态影响。
- 不做生产部署。
- 不做 exe 内自动演示。
- 不做 OAuth/SSO 或共享协作 UI。

后续可做 M41-live 或 M42：

- 加 `SHANHAI_DELIVERY_DEMO_PROVIDER=live`，在确认凭据和耗时边界后触发真实 provider。

## 4. 开发方案

### 4.1 文件与职责

- `docs\stages\local-real-mvp-m41-auto-delivery-demo-plan.md`
  - 本规划。
- `docs\stages\local-real-mvp-m41-auto-delivery-demo-test-plan.md`
  - 测试定义。
- `tests\e2e\stage41-auto-delivery-demo.spec.ts`
  - 浏览器自动交付演示主用例。
- `scripts\run-stage41-delivery-demo.mjs`
  - 初始化临时 DB，运行 Playwright，检查报告文件存在。
- `tests\stage41-delivery-demo-script.test.mjs`
  - 脚本与 package 命令合同测试。
- `package.json`
  - 增加 `demo:e2e:delivery` 和 `test:e2e:stage41`。
- `docs\stages\local-real-mvp-m41-auto-delivery-demo-report.md`
  - 阶段收尾报告。

### 4.2 浏览器流程

`stage41-auto-delivery-demo.spec.ts` 自动执行：

1. 创建项目。
2. 输入固定公开课需求。
3. 等待需求规格 artifact。
4. 确认需求规格、教材证据、教案、PPT 大纲、导入视频方案。
5. 用本地 fixture route substitute 触发：
   - 真实 PPTX 文件 artifact。
   - 真实课堂视觉图 artifact。
   - 真实导入视频 artifact。
6. 下载 PPTX、PNG、MP4 做魔数校验。
7. 下载最终材料包 ZIP。
8. 检查 ZIP entries：
   - `README.md`
   - `final-delivery.md`
   - `ppt-outline.pptx`
   - `classroom-visual.png`
   - `intro-video.mp4`
9. 生成 JSON/Markdown 报告。

### 4.3 报告字段

JSON 报告最少包含：

- `ok`
- `stage`
- `mode`
- `projectId`
- `prompt`
- `artifacts`
- `downloads`
- `packageEntries`
- `checks`
- `generatedAt`

Markdown 报告最少包含：

- 阶段名。
- 项目 ID。
- 下载文件清单。
- ZIP entries。
- 通过/失败检查项。

## 5. 风险与回退

- 风险：fixture substitute 被误解为真实 provider live。回退：报告明确 `mode=local-substitute`。
- 风险：Playwright 下载路径在失败时为空。回退：用断言提前失败并保留 trace。
- 风险：报告文件被旧结果污染。回退：脚本启动前删除旧 report 和旧 DB。
- 风险：命令时间较长。回退：只跑 Chromium desktop，作为一键演示基线；窄屏覆盖仍由 stage8/stage40c 负责。
- 风险：默认 E2E 端口被本机代理或旧服务占用。回退：脚本自动选择 `3127-3199` 可用端口；若用户显式设置 `E2E_PORT`，优先尊重显式配置。

## 6. 验收标准

- `node --test tests\stage41-delivery-demo-script.test.mjs` 通过。
- `npm run demo:e2e:delivery` 通过。
- 报告 JSON 和 Markdown 均生成。
- JSON 中 `ok=true`，`packageEntries` 包含 Markdown、PPTX、图片、视频。
- `npm test` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 无敏感信息写入报告、文档或提交。
