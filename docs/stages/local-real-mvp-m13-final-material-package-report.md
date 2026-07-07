# Local Real MVP M13 最终材料包 ZIP 下载报告

日期：2026-07-07

## 1. 阶段目标

M13 目标是把 M9 的最终交付 Markdown 和 M11 的最小 PPTX 合成一个教师可以保存、转交的本地材料包：

```text
最终交付清单详情
-> 下载材料包
-> 后端读取最终交付 artifact
-> 后端读取同项目 PPT 大纲 artifact
-> 生成 final-delivery.md 与 ppt-outline.pptx
-> 打包为真实 .zip
```

本阶段不生成图片、视频、动画或视觉精修内容，不改变 workflow 节点，也不接入真实 OpenAI live smoke。

## 2. 红灯记录

先写测试再实现：

- 新增 `tests\artifact-package-download.test.mjs`。
- 初始运行 `node --test tests\artifact-package-download.test.mjs` 失败，原因是 `src\server\package\artifact-package.ts` 不存在。
- 失败证明测试能够捕捉“材料包生成器尚未实现”的缺口。

## 3. 实现内容

代码改动：

- `package.json` / `package-lock.json`
  - 新增直接依赖 `jszip@3.10.1`，用于服务端生成真实 ZIP。
- `src\server\package\artifact-package.ts`
  - 新增 `buildFinalMaterialPackageDownload()`。
  - 只允许 `final_delivery` artifact 导出材料包。
  - ZIP 内写入 `README.md`、`final-delivery.md`、`ppt-outline.pptx`。
  - README 明确图片文件、视频成片、动画和视觉精修仍待生成或完善。
- `src\server\pptx\artifact-pptx.ts`
  - 导出 `toPptxDownloadableArtifact()`，复用 M11 的 PPTX artifact 映射。
- `src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\pptx\route.ts`
  - 改为复用 `toPptxDownloadableArtifact()`，减少路由内重复映射。
- `src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\package\route.ts`
  - 新增材料包下载路由。
  - 读取最终交付 artifact 与同项目最新已确认 PPT 大纲 artifact。
  - 返回 `application/zip` 和安全 `.zip` 文件名。
- `src\hooks\useFinalPackageDownload.ts`
  - 新增浏览器下载 hook，仅对最终交付清单启用。
- `src\components\artifacts\ArtifactDetailSheet.tsx`
  - 在最终交付详情页增加“下载材料包”按钮。

测试改动：

- `tests\artifact-package-download.test.mjs`
  - 验证 ZIP 文件头、文件名、内部 entries 和边界文案。
- `src\server\workbench\__tests__\stage13-material-package.test.ts`
  - 验证 `/package` 路由只允许最终交付 artifact 下载 ZIP。
- `tests\e2e\stage2-deterministic.spec.ts`
  - 浏览器捕获真实 `.zip` download。
  - 解压检查 `README.md`、`final-delivery.md`、`ppt-outline.pptx`。

文档改动：

- 新增 `docs\stages\local-real-mvp-m13-final-material-package-plan.md`。
- 新增 `docs\stages\local-real-mvp-m13-final-material-package-test-plan.md`。
- 新增本报告。
- 更新 `docs\stages\local-real-mvp-current-state-audit.md`。

## 4. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\artifact-package-download.test.mjs` | 红灯后绿灯；2 tests passed |
| `npx vitest run src/server/workbench/__tests__/stage13-material-package.test.ts --maxWorkers=1` | 通过；1 test passed |
| `npm run test:e2e:stage2` | 通过；Chromium desktop 2 passed，含真实 ZIP 下载与 entries 检查 |
| `node --test tests\artifact-pptx-download.test.mjs` | 通过；2 tests passed |
| `node --test tests\artifact-markdown-download.test.mjs` | 通过；1 test passed |
| `npm test` | 通过；Node 15 tests passed；Vitest 16 files / 69 tests passed |
| `npm run build` | 通过；Next.js 编译、TypeScript、静态页面生成均通过，新增 `/package` 动态路由 |
| `npm run test:e2e:stage8` | 通过；Chromium narrow + Firefox desktop 共 4 passed |
| `npm run test:e2e:stage7` | 通过；双 browser context 隔离 1 passed |

## 5. 审查结论

M13 已完成最终材料包真实 ZIP 下载闭环。教师在最终交付清单详情页点击“下载材料包”后，会得到包含最终清单 Markdown 和最小 PPTX 的真实 `.zip` 文件。

本阶段没有把图片文件、视频成片、动画、视觉精修或真实模型生成标记为完成。M6 live OpenAI smoke 仍因缺少真实凭据未通过。

## 6. 风险与后续建议

- `npm install` 提示当前依赖树存在 5 个中等漏洞；本阶段没有执行破坏性升级。后续可单独做依赖安全审查。
- ZIP 当前在内存中生成，适合本地 MVP 的小文件包；后续加入图片或视频后，应改为对象存储或流式打包。
- 下一阶段建议二选一：
  - M14：增强 PPTX 页面结构和教师可读性。
  - M14：材料包索引与缺失项检查，让包内 README 更接近交付手册。
