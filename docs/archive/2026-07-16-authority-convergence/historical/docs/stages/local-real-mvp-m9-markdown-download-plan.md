# Local Real MVP M9 Markdown Download Plan

日期：2026-07-07

## 1. 阶段目标

M9 目标是补齐最终交付包的真实 Markdown 下载能力。教师在确认或查看最终交付清单时，应能直接下载 `.md` 文件，作为本地公开课材料包的一部分保存。

第一性原理判断：

- 本地真实 MVP 的交付闭环不应只停留在“复制到剪贴板”；教师需要一个可保存、可转交、可复用的本地文件。
- 下载 Markdown 只导出已经持久化的文本产物，不代表真实 PPTX、图片或视频文件已经生成。
- 该能力应保持在前端浏览器下载层，不新增后端存储或外部 provider。

## 2. 可复用方案调研

项目内可复用资产：

- `ArtifactDetailSheet` 已承载完整产物查看、复制、确认和重做按钮，是下载入口的自然位置。
- `artifactText()` 已提供复制用文本，但下载应使用更完整、结构更清楚的 Markdown 导出内容。
- `ArtifactItem.content`、`previewFields`、`sourceTitles`、`updatedAt` 已足够拼成可读 Markdown。
- Stage 2 E2E 已覆盖最终交付清单详情页，可扩展下载断言。

外部成熟方案：

- 浏览器原生 Blob + `URL.createObjectURL()` 可生成临时下载 URL。
- `<a download>` 可提示浏览器以指定文件名保存资源。
- 下载触发后应调用 `URL.revokeObjectURL()` 释放临时 URL。

## 3. 复用、适配与自研边界

复用：

- 复用 `ArtifactDetailSheet` 底部操作区。
- 复用 `ArtifactItem` 已有字段，不新增后端字段。
- 复用 Stage 2 E2E 主链路验证最终交付清单可下载。

适配：

- 新增小型纯函数，将 `ArtifactItem` 转换为 Markdown 文件名和 Markdown 正文。
- 新增前端 hook/函数触发浏览器下载，并返回成功/失败状态。
- 仅当产物具备可复制内容时展示或启用下载 Markdown。

暂不自研：

- 不新增服务端下载 API。
- 不生成 zip。
- 不生成 PPTX、图片或视频文件。
- 不引入文件系统权限 API，避免浏览器兼容面扩大。

## 4. 开发方案、风险和验证标准

执行顺序：

1. 写 M9 测试计划。
2. 新增导出 Markdown 纯函数测试，先观察缺函数红灯。
3. 最小实现 Markdown 文件名和正文生成。
4. 扩展 Stage 2 E2E：在最终交付清单详情中点击“下载 Markdown”，断言下载文件名和内容。
5. 若 E2E 红灯，最小实现详情页下载按钮。
6. 集中验收：`npm test`、`npm run build`、`npm run test:e2e:stage2`、`npm run test:e2e:stage8`、worker 残留检查、`git diff --check`。
7. 写 M9 报告并提交。

主要风险：

- 文件名若直接使用中文标题和特殊符号，可能在不同浏览器中表现不稳定；本阶段使用稳定 ASCII 前缀 + artifact key。
- 下载内容若只用复制摘要，会失去交付价值；必须包含标题、摘要、关键字段、正文和上游来源。
- 不能把下载 Markdown 文案写成“文件包/PPTX/视频已生成”。
- Playwright 下载验证在 Firefox 和 Chromium 中行为可能不同；本阶段优先在 Stage 2 desktop 主链路验证，M8 继续覆盖浏览器主链路。

验证标准：

- 纯函数测试证明最终交付产物可生成 `.md` 文件名和完整 Markdown 正文。
- Stage 2 E2E 下载到真实文件，文件名以 `.md` 结尾，内容包含“最终交付清单”“已形成材料”“待确认事项”，且不包含“PPTX 文件已生成”“图片文件已生成”“视频成片已生成”。
- `npm test` 通过。
- `npm run build` 通过。
- `npm run test:e2e:stage2` 通过。
- `npm run test:e2e:stage8` 通过。
- `git diff --check` 通过。
