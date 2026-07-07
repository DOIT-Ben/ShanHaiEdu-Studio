# Local Real MVP M26 Teacher Real Generation Entry Report

日期：2026-07-07

## 1. 阶段目标

M26 目标是把已经完成的服务端真实生成 route 暴露为教师可见的受控入口：教师在产物详情中可以对 PPT 大纲触发真实 PPTX 和课堂视觉图生成，对导入视频方案触发导入视频生成。前端只调用项目 API route 并刷新 snapshot，不接触密钥、私有端点或 provider 响应。

## 2. 本阶段变更

- `src\lib\artifact-real-assets.ts`
  - 新增 `getRealAssetGenerationActions`，集中决定哪些产物显示真实生成入口。
  - PPT 大纲显示“生成真实 PPTX”和“生成课堂视觉图”。
  - 导入视频方案显示“生成导入视频”。
- `src\lib\types.ts`
  - `WorkbenchDataSource` 增加 `generateRealAsset`。
- `src\lib\workbench-api.ts`
  - API data source 调用 `coze-ppt`、`image`、`video` 后刷新 snapshot。
  - development adapter 仅更新本地状态，不伪装生产完成。
- `src\hooks\useWorkbenchController.ts`
  - 增加真实素材生成动作、触发中状态和教师提示。
- `src\components\artifacts\ArtifactDetailSheet.tsx`
  - 在产物详情操作区渲染真实生成按钮。
  - 移除未接线的“查看图片”静态按钮。
- `src\components\layout\MediaWorkbench.tsx`
  - 将 controller 的生成动作传入详情抽屉。

## 3. TDD 记录

红灯：

```powershell
node --test tests\workbench-api.test.mjs
```

结果：失败，`generateRealAsset` 方法不存在，`artifact-real-assets.ts` 不存在。

绿灯：

```powershell
node --test tests\workbench-api.test.mjs
```

结果：11 tests passed。

## 4. 集中验收

| 命令 | 结果 |
| --- | --- |
| `node --test tests\workbench-api.test.mjs` | 通过；11 tests passed |
| `npm test` | 通过；Node 41 tests passed；Vitest 21 files / 81 tests passed |
| `npm run build` | 通过；exit 0 |
| `npm run test:e2e:stage2` | 通过；Chromium desktop 2 passed |
| `npm run test:e2e:stage8` | 通过；Chromium narrow 和 Firefox desktop 共 4 passed |

构建仍有 1 条既有 Turbopack output tracing warning，import trace 指向 `src\server\video-generation\artifact-video.ts` 和 `/video` route；本阶段未新增 warning。

## 5. 边界与风险

- M26 完成的是教师 UI 入口和前端触发闭环，不等于长任务队列、后台轮询或生产存储已完成。
- 真实生成仍由后端 route 负责；前端没有读取 `.env`，没有接触 key、token、私有端点或 provider 响应。
- 视频和图片生成可能耗时较长，后续生产准备阶段仍需队列、进度状态、重试和对象存储。
- 教师可见文案不使用 `provider`、`storage`、`debug`、`local path` 等工程词。

## 6. 审查结论

M26 通过。当前主线已从“服务端真实生成能力可用”推进到“教师可在产物详情中触发真实 PPTX、课堂视觉图和导入视频生成”的前端入口阶段。下一阶段建议进入 M27：真实生成入口的浏览器专项用例和下载联动，或进入账号权限系统规划。
