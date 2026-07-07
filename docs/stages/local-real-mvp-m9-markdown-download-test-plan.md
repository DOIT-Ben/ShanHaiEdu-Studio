# Local Real MVP M9 Markdown Download Test Plan

日期：2026-07-07

## 1. 测试目标

M9 测试目标是证明最终交付清单可以真实下载为 Markdown 文件，并且下载内容不会伪装未完成的 PPTX、图片或视频能力。

本阶段不验证真实 OpenAI、PPTX、图片、视频、账号权限或生产部署。

## 2. 集中验收命令

### M9-1：Markdown 导出纯函数测试

```powershell
node --test tests/artifact-markdown-download.test.mjs
```

红灯通过标准：

- 新增测试在缺少导出函数或导出内容不完整时失败。
- 失败原因不是语法错误或路径错误。

绿灯通过标准：

- 文件名以 `.md` 结尾。
- 文件名不包含 Windows 不安全字符。
- Markdown 正文包含标题、摘要、关键字段、正文内容、上游来源和更新时间。
- 正文不包含“PPTX 文件已生成”“图片文件已生成”“视频成片已生成”。

### M9-2：浏览器下载验收

```powershell
npm run test:e2e:stage2
```

通过标准：

- 最终交付清单详情页出现“下载 Markdown”按钮。
- 点击后 Playwright 捕获真实 download 事件。
- 下载文件名以 `.md` 结尾。
- 下载文件内容包含“最终交付清单”“已形成材料”“待确认事项”。
- 下载文件内容不包含“PPTX 文件已生成”“图片文件已生成”“视频成片已生成”。
- M1-M5 主链路仍通过。

### M9-3：浏览器覆盖回归

```powershell
npm run test:e2e:stage8
```

通过标准：

- `chromium-narrow` 通过。
- `firefox-desktop` 通过。
- M8 窄屏与 Firefox 主链路未回归。

### M9-4：全量单元与构建

```powershell
npm test
npm run build
```

通过标准：

- `npm test` exit 0，失败数为 0。
- `npm run build` exit 0。

### M9-5：收尾审查

```powershell
git diff --check
git status --short --branch
```

通过标准：

- 无空白错误。
- 工作树只包含 M9 授权范围内变更。
- 未提交密钥、token、私钥或真实凭据。
