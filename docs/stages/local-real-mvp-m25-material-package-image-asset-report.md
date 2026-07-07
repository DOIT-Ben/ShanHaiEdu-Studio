# Local Real MVP M25 Material Package Image Asset Report

日期：2026-07-07

## 1. 阶段目标

M25 目标是把 M24 已可下载的本地图片资产纳入最终材料包 ZIP：当同项目存在带 `storage.imageAsset` 的 PPT artifact 时，最终材料包额外包含课堂视觉图；当图片不存在时，材料包保持旧能力，不伪装图片完成。

## 2. 本阶段变更

- `src\server\package\artifact-package.ts`
  - `buildFinalMaterialPackageDownload` 增加可选 `image` 输入。
  - 有图片时 ZIP 增加 `classroom-visual.png` 或 `classroom-visual.jpg`。
  - README 根据图片、视频是否存在组合说明已包含资产和仍需核对事项。
- `src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\package\route.ts`
  - 增加同项目图片 artifact 查找逻辑。
  - 优先选择已批准的 `ppt_draft` 图片 artifact，否则选择最新带 `imageAsset` 的 `ppt_draft` artifact。
  - 复用 M24 `buildStoredImageDownload`，继续保留 `.tmp` 路径约束和 PNG/JPEG 校验。
- `tests\artifact-package-download.test.mjs`
  - 增加材料包生成器图片 ZIP entry 测试。
- `src\server\workbench\__tests__\stage13-material-package.test.ts`
  - 增加 package route 包含本地 PNG fixture 的集成校验。

## 3. TDD 记录

红灯：

```powershell
node --test tests\artifact-package-download.test.mjs
```

结果：失败，`classroom-visual.png` entry 不存在。

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage13-material-package.test.ts --maxWorkers=1
```

结果：失败，route 返回的 ZIP 中 `classroom-visual.png` entry 不存在。

绿灯：

```powershell
node --test tests\artifact-package-download.test.mjs
```

结果：4 tests passed。

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage13-material-package.test.ts --maxWorkers=1
```

结果：1 test passed。

## 4. 集中验收

| 命令 | 结果 |
| --- | --- |
| `node --test tests\artifact-package-download.test.mjs` | 通过；4 tests passed |
| `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage13-material-package.test.ts --maxWorkers=1` | 通过；1 test passed |
| `npm test` | 通过；Node 39 tests passed；Vitest 21 files / 81 tests passed |
| `npm run build` | 通过；exit 0 |

构建仍有 1 条既有 Turbopack output tracing warning，import trace 指向 `src\server\video-generation\artifact-video.ts` 和 `/video` route；本阶段未新增图片相关 tracing warning。

## 5. 边界与风险

- M25 只完成“图片进入最终材料包 ZIP”，不代表 PPTX 内嵌图片、图片质量评分或教师 UI 图片生成入口已完成。
- 图片读取继续限制在 `.tmp` 下；生产部署前仍需替换为部署卷或对象存储。
- README 只说明已包含课堂视觉图，并要求教师核对视觉准确性、版权和课堂适配；没有图片时仍保持图片待生成或完善的边界。

## 6. 审查结论

M25 通过。当前主线已具备最终材料包打包 Markdown、最小 PPTX、可选导入视频 MP4 和可选课堂视觉图 PNG/JPEG 的能力。下一阶段建议转入教师 UI 真实生成入口，让 Coze PPT、图片和视频后端能力从 route/adapter 层进入可控教师操作流。
