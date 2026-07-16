# Local Real MVP M13 最终材料包 ZIP 下载规划

日期：2026-07-07

## 1. 第一性原理判断

M9 已经支持最终交付清单 Markdown 下载，M11 已经支持 PPT 大纲最小 PPTX 下载，M12 已经把最终交付清单口径同步到 PPTX 最小下载能力。下一块最高价值缺口是把这些真实文件合成一个教师可以保存和转交的本地材料包。

M13 的核心需求是：

```text
打开最终交付清单详情
-> 点击下载材料包
-> 后端读取当前最终交付 artifact
-> 后端读取同项目 PPT 大纲 artifact
-> 生成最终清单 Markdown + 最小 PPTX
-> 打包为真实 .zip 文件
-> 浏览器捕获真实下载
```

成功标准：

- 只对 `final_delivery` / “最终交付清单”开放“下载材料包”。
- ZIP 文件必须是真实 ZIP 二进制文件，不是改后缀文本。
- ZIP 内至少包含：
  - `README.md`：说明材料包范围和待完善项。
  - `final-delivery.md`：最终交付清单正文。
  - `ppt-outline.pptx`：由当前 PPT 大纲生成的最小 PPTX 文件。
- ZIP 和 README 不把图片、视频、动画或视觉精修伪装成已完成。
- 教师界面不出现工程词。

## 2. 可复用方案调研

项目内已有可复用资产：

- M9 的最终交付 Markdown 下载测试与浏览器 download 验收。
- M11 的 `src\server\pptx\artifact-pptx.ts`，可复用 PPTX 生成逻辑。
- M12 的最终交付清单口径，已经说明 PPTX 最小下载能力与图片/视频边界。
- `service.getArtifact(projectId, artifactId)` 与 `service.getArtifacts(projectId)` 可作为真实持久化 artifact 来源。
- `ArtifactDetailSheet` 已承载下载按钮，可复用为材料包入口。

外部成熟方案：

- JSZip 官方文档说明 `generateAsync({ type: "nodebuffer" })` 可在 Node.js 中生成 Buffer 形式 ZIP。
- npm `jszip` 最新版本为 `3.10.1`，当前已作为 `pptxgenjs` 的间接依赖存在；M13 将其声明为直接依赖，避免依赖偶然传递。
- 一手来源：
  - JSZip generateAsync 文档：https://stuk.github.io/jszip/documentation/api_jszip/generate_async.html
  - JSZip npm package：https://www.npmjs.com/package/jszip

## 3. 复用、适配与必要自研

复用：

- 复用 M11 PPTX 生成器，不另写 PPTX 生成逻辑。
- 复用最终交付 artifact 的 `markdownContent` 作为 `final-delivery.md`。
- 复用详情页下载区，不新增独立页面。
- 复用 Stage 2 E2E 主链路做浏览器真实下载验收。

适配：

- 新增后端下载路由：
  - `GET /api/workbench/projects/:projectId/artifacts/:artifactId/package`
  - 只允许 `final_delivery` artifact。
  - 返回 `application/zip`。
  - `Content-Disposition` 使用安全 `.zip` 文件名。
- 新增服务端包构建层：
  - 输入最终交付 artifact、PPTX 下载对象。
  - 输出 ZIP filename + Buffer。
- 新增前端 hook：
  - `useFinalPackageDownload(projectId, item)`
  - 仅当 item 是最终交付清单且有真实 `artifactId` 时启用。

必要自研：

- `src\server\package\artifact-package.ts`：封装 ZIP 构建。
- `tests\artifact-package-download.test.mjs`：验证 ZIP 结构、文件名、内容和边界声明。
- E2E 增加最终交付材料包真实下载断言。

## 4. 开发方案、风险与验证标准

开发方案：

1. 声明直接依赖 `jszip@3.10.1`。
2. 写 `tests\artifact-package-download.test.mjs` 红灯：
   - 检查 ZIP 文件名安全且以 `.zip` 结尾。
   - 检查 Buffer 以 `PK` 开头。
   - 解压检查包含 `README.md`、`final-delivery.md`、`ppt-outline.pptx`。
   - 检查 README 和 Markdown 内容不包含虚假完成表述。
3. 实现 `src\server\package\artifact-package.ts`。
4. 抽出或复用 `ArtifactRecord -> PptxDownloadableArtifact` 映射，避免路由复制。
5. 新增 `/package` 下载路由。
6. 新增前端 hook 与详情页按钮。
7. 扩展 Stage 2 E2E，捕获真实 `.zip` download 并检查 ZIP entries。
8. 写 M13 报告并更新当前状态审计。

风险：

- ZIP 生成会把整个文件放进内存；当前 MVP 文件小，可接受。若后续加入视频，应改为流式存储或对象存储打包。
- PPTX 仍是最小文本文件，不代表图片、视频、动画或视觉精修完成。
- 若最终交付 artifact 存在但 PPT 大纲 artifact 缺失，应返回教师可理解错误，不下载半成品包。

验证标准：

- 红灯：新增 Node 测试在实现前失败。
- 绿灯：
  - `node --test tests\artifact-package-download.test.mjs`
  - `npm run test:e2e:stage2`
- 集中验收：
  - `node --test tests\artifact-pptx-download.test.mjs`
  - `node --test tests\artifact-markdown-download.test.mjs`
  - `npm test`
  - `npm run build`
  - `npm run test:e2e:stage8`
  - `npm run test:e2e:stage7`
  - `git diff --check`
