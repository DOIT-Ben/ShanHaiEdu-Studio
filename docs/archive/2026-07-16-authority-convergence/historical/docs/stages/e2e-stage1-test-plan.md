# E2E Verification Stage 1 Test Plan

日期：2026-07-07

## 1. 测试目标

Stage 1 测试目标是证明 E2E 验收体系已经可运行、可定位、可扩展，而不是证明业务闭环已经真实完成。通过本阶段后，下一阶段可以直接在同一套 Playwright 配置上增加真实 deterministic E2E 用例。

## 2. 测试范围

覆盖：

- Next.js 页面可以由 Playwright 启动并访问。
- 桌面视口能看到左侧项目栏、中间输入区、右侧节点串。
- 用户可以输入一句需求并触发发送动作。
- 用户可以打开右侧节点详情或预览。
- 页面可见文本不包含工程词红线。
- 集中验收能输出 JSON/HTML 报告、截图和失败证据目录。

不覆盖：

- 真实新建项目保存。
- 真实 API 请求。
- 真实 artifact 生成。
- 刷新后状态恢复。
- 双项目隔离。
- OpenAI Runtime 真实生成。

上述不覆盖项进入后续阶段，不得在 Stage 1 报告中写成已通过。

## 3. 测试数据

教师输入：

```text
我想要生成一个小学五年级关于百分数的公开课 PPT，需要教案、PPT 大纲和导入视频方案。
```

红线词清单：

```text
schema
manifest
provider
node_id
storage
API
debug
local path
mock
placeholder
deterministic
```

说明：红线扫描只检查当前浏览器页面可见文本，不扫描源码、文档或测试文件。

## 4. 集中验收命令

先安装依赖：

```powershell
npm install
npx playwright install chromium
```

集中验收：

```powershell
npm run build
npm run test:e2e:stage1
```

资源约束：

- Playwright worker 固定为 2。
- 只跑 Chromium 桌面项目。
- 不并行启动多个 dev server。

## 5. 用例清单

| 用例 | 目的 | 通过标准 | 失败归因 |
| --- | --- | --- | --- |
| Stage 1 shell loads | 验证本地页面可访问 | 页面显示工作台标题、项目列表、输入框和发送按钮 | 前端/构建 |
| Stage 1 prompt action | 验证输入动作可被浏览器驱动 | 输入教师需求后点击发送，出现用户可见反馈 | 前端交互 |
| Stage 1 node detail evidence | 验证节点详情入口可打开 | 点击导入节点后能看到详情标题和动作按钮 | 前端交互 |
| Stage 1 redline scan | 验证红线扫描可运行 | 页面可见文本不包含红线词 | 前端文案 |
| Stage 1 screenshot evidence | 验证证据产物可生成 | 保存桌面截图到测试输出目录 | 测试设施 |

## 6. 报告要求

Stage 1 验收报告必须包含：

- 执行日期和 commit。
- 执行命令和 exit code。
- 通过/失败用例数量。
- 截图、trace、JSON/HTML 报告路径。
- 与业务主线相关的阻塞，不直接跨主线修复。
- 明确声明 Stage 1 只完成测试基础设施，不代表真实 MVP E2E 完成。

报告模板：`docs\stages\e2e-stage1-report-template.md`。
