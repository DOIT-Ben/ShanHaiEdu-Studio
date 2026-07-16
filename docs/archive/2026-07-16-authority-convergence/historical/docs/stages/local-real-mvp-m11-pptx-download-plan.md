> 历史口径提示：本文为早期 PPTX 下载阶段计划，仅保留为历史参考。当前开发与验收以 `docs\product\current-requirements-baseline.md` 为唯一权威口径；“只保证可打开和内容可读”的最小 PPTX 口径已不能作为当前真实 PPTX 交付标准。

# Local Real MVP M11 PPTX 最小下载闭环规划

日期：2026-07-07

## 1. 第一性原理判断

M0-M10 已经证明教师可以在本机浏览器完成公开课文本材料链路，并下载最终 Markdown。下一块最高价值缺口是“真实文件能力”：教师需要至少拿到一个可保存、可打开、可转交的 PPTX 文件，而不是只看到 PPT 大纲文本。

M11 的核心需求是：

```text
确认 PPT 大纲与逐页脚本
-> 打开 PPT 大纲详情
-> 下载真实 .pptx 文件
-> 文件能被 Office/WPS/LibreOffice 识别为 PPTX
-> 内容来自当前 artifact，不伪装图片、视频或精修设计完成
```

成功标准：

- 只对 `ppt_draft` / “PPT 大纲与逐页脚本”开放“下载 PPTX”。
- 生成的是标准 PPTX 二进制文件，不是改后缀的文本。
- PPTX 内包含当前 artifact 的标题、摘要、关键字段和正文要点。
- 文件名安全，后缀为 `.pptx`。
- 教师界面不显示工程词。
- 不把“图片文件”“视频成片”或“精修视觉设计”包装为已完成。

## 2. 可复用方案调研

项目内已有可复用资产：

- `ppt_draft` 节点已经由 M3 生成“PPT 大纲与逐页脚本”文本 artifact。
- `ArtifactDetailSheet` 已有下载 Markdown 操作区，可复用同一详情入口增加 PPTX 下载。
- `src\lib\artifact-markdown-download.ts` 已有安全文件名和内容序列化思路，可复用为 PPTX 内容提取参考。
- Stage 2 E2E 已覆盖“PPT 大纲与逐页脚本”详情打开、复制、确认和重做。
- 后端 artifact 路由已能按 `projectId + artifactId` 读取真实持久化 artifact。

外部成熟方案：

- `pptxgenjs` 是面向 Node、浏览器和 React 的 PPTX 生成库，当前 npm 可用版本为 `4.0.1`。
- PptxGenJS 生成标准 OOXML `.pptx`，不依赖本机安装 PowerPoint，适合本项目的 Next.js 后端路由生成最小文件。
- 一手来源：
  - PptxGenJS 官方文档：https://gitbrent.github.io/PptxGenJS/
  - npm package：https://www.npmjs.com/package/pptxgenjs
  - GitHub package metadata：https://github.com/gitbrent/PptxGenJS/blob/master/package.json

## 3. 复用、适配与必要自研

复用：

- 复用后端 `service.getArtifact(projectId, artifactId)` 作为 PPTX 内容真源。
- 复用现有 artifact mapper，不新增节点或数据库字段。
- 复用详情页操作区，不新增独立页面。
- 复用 Stage 2 E2E 主链路，避免另建孤立演示。

适配：

- 新增后端下载路由：
  - `GET /api/workbench/projects/:projectId/artifacts/:artifactId/pptx`
  - 只允许 `ppt_draft` artifact。
  - 返回 `application/vnd.openxmlformats-officedocument.presentationml.presentation`。
  - `Content-Disposition` 使用安全文件名。
- 新增前端 hook：
  - `useArtifactPptxDownload(projectId, item)`
  - 仅当当前 item 是 `ppt_draft` 且有真实 `artifactId` 时启用。
  - 通过 fetch 获取 blob 并触发浏览器下载。
- 新增纯内容构建层：
  - 把 artifact 的 Markdown/结构化内容转成 PPTX 页。
  - 第一版只做标题页、摘要页、关键字段页、正文要点页和边界说明页。

必要自研：

- `src\server\pptx\artifact-pptx.ts`：封装 artifact 到 PPTX 的生成逻辑。
- `tests\artifact-pptx-download.test.mjs`：验证生成物是 ZIP/PPTX 结构，包含关键 OOXML 文件和文本内容。
- E2E 增加对“下载 PPTX”的浏览器 download 事件断言。

## 4. 开发方案、风险与验证标准

开发方案：

1. 安装 `pptxgenjs@4.0.1`，更新 `package.json` 和 `package-lock.json`。
2. 写 `tests\artifact-pptx-download.test.mjs` 红灯：
   - 调用 `buildArtifactPptxDownload()`。
   - 断言 filename 以 `.pptx` 结尾。
   - 断言 buffer 以 ZIP 文件头 `PK` 开始。
   - 解压验证 `[Content_Types].xml`、`ppt/presentation.xml`、`ppt/slides/slide1.xml` 存在。
   - 断言 slide XML 包含“PPT 大纲与逐页脚本”等内容。
3. 写后端路由测试或 Node 测试，验证非 `ppt_draft` 返回不可下载。
4. 实现 `src\server\pptx\artifact-pptx.ts`。
5. 新增下载路由。
6. 新增前端 hook 与详情页按钮。
7. 扩展 Stage 2 E2E，在 PPT 大纲详情页捕获真实 `.pptx` 下载。
8. 更新 M11 报告和当前状态审计。

风险：

- PPTX 生成库可能增加依赖体积；放在后端路由而不是 React 客户端，降低前端 bundle 风险。
- 第一版 PPTX 只保证可打开和内容可读，不承诺视觉精修、图片生成或动画。
- PPTX XML 中文文本可能被拆分，测试应验证解压文本中可识别关键词，不做脆弱的完整 XML 字符串匹配。
- 不能把 PPTX 文件闭环扩大解读为图片、视频或完整多媒体生产已完成。

验证标准：

- 红灯：新增 Node 测试在实现前失败。
- 绿灯：实现后专项测试通过。
- 集中验收：
  - `node --test tests/artifact-pptx-download.test.mjs`
  - `node --test tests/artifact-markdown-download.test.mjs`
  - `npm test`
  - `npm run build`
  - `npm run test:e2e:stage2`
  - `npm run test:e2e:stage8`
  - `npm run test:e2e:stage7`
  - `git diff --check`
  - 测试 worker 残留检查
