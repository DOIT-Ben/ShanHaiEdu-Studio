# Local Real MVP M9 Markdown Download Report

日期：2026-07-07

## 1. 阶段目标

M9 目标是补齐最终交付清单的真实 Markdown 下载能力，让教师能把已生成的最终交付文本保存为本地 `.md` 文件。

本阶段不生成 PPTX、图片文件或视频成片，也不声明真实 OpenAI live smoke 已通过。

## 2. 本轮实现

### 2.1 Markdown 导出纯函数

新增 `src\lib\artifact-markdown-download.ts`：

- `buildArtifactMarkdownDownload(item)` 返回安全文件名和 Markdown 正文。
- 文件名使用 `shanhai-<artifact-key>-<YYYYMMDD>.md`。
- 文件名过滤 Windows 不安全字符。
- Markdown 正文包含标题、摘要、关键字段、正文、上游来源和更新时间。

### 2.2 下载 hook

新增 `src\hooks\useArtifactMarkdownDownload.ts`：

- 使用浏览器 Blob 生成 Markdown 文件。
- 使用临时 object URL 触发 `<a download>` 下载。
- 触发后释放 object URL。
- 提供 `下载 Markdown`、`已下载`、`下载失败` 三种按钮状态。

### 2.3 详情页入口

更新 `ArtifactDetailSheet`：

- 在产物详情底部增加“下载 Markdown”按钮。
- 与复制、作为输入、确认、重做保持同一操作区。
- 下载按钮只导出当前已保存 artifact 的 Markdown，不触发 provider 或后端写入。

### 2.4 E2E 下载验证

更新 Stage 2 E2E：

- 在最终交付清单详情页点击“下载 Markdown”。
- 捕获真实 Playwright download 事件。
- 校验文件名以 `.md` 结尾。
- 读取下载文件内容，确认包含“最终交付清单”“已形成材料”“待确认事项”。
- 校验下载内容不包含“PPTX 文件已生成”“图片文件已生成”“视频成片已生成”。

## 3. TDD 与调试记录

红灯 1：

- 新增 `tests\artifact-markdown-download.test.mjs`。
- 首次运行失败，原因是 `src\lib\artifact-markdown-download.ts` 不存在。

绿灯 1：

- 实现 Markdown 文件名和正文生成后，纯函数测试通过。
- 初版直接 import `.ts` 会产生 Node 模块类型警告，随后改为与现有 Node 合同测试一致的 TypeScript transpile + VM 加载方式，输出干净。

红灯 2：

- 扩展 `npm run test:e2e:stage2` 后失败。
- 失败原因是最终交付详情页没有“下载 Markdown”按钮，且没有 download 事件。

绿灯 2：

- 接入下载 hook 和详情页按钮后，Stage 2 浏览器下载验收通过。

## 4. 验收记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `node --test tests/artifact-markdown-download.test.mjs` | 红灯后绿灯 | 缺函数时失败；实现后 1 test passed |
| `npm run test:e2e:stage2` | 红灯后绿灯 | 缺下载按钮时失败；实现后 Chromium desktop 1 passed，下载 `.md` 文件内容校验通过 |
| `npm test` | 通过 | Node 11 tests passed；Vitest 15 files / 68 tests passed |
| `npm run build` | 通过 | Prisma Client 生成成功；Next.js 编译、TypeScript、静态页面生成均通过 |
| `npm run test:e2e:stage8` | 通过 | `chromium-narrow` 与 `firefox-desktop` 2 passed |
| `npm run test:e2e:stage7` | 通过 | Chromium desktop 1 passed；双 browser context 隔离未回归 |
| worker 残留检查 | 通过 | 未发现 Vitest/Jest/Playwright 残留 Node 进程 |
| `git diff --check` | 通过 | 无空白错误；仅有工作区换行提示 |

## 5. 风险与边界

- 下载 Markdown 只导出文本产物，不代表真实 PPTX、图片或视频文件已经生成。
- 下载行为依赖浏览器内置下载机制，不新增后端文件存储。
- 下载文件名使用 artifact key 而不是完整中文标题，优先保证跨平台安全。
- M6 live OpenAI smoke 仍缺真实凭据，真实模型路径尚未证明。

## 6. 审查结论

M9 通过。当前最终交付清单已支持复制和真实 `.md` 文件下载，本地 deterministic 文本 MVP 的交付闭环更接近教师可用状态。

当前仍不能表述为真实模型、多媒体文件或生产部署完成。
