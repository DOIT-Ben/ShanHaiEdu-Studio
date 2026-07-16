# Local Real MVP M27 Real Generation Browser Linkage Report

日期：2026-07-07

## 1. 阶段目标

M27 目标是用真实浏览器验证 M26 教师真实生成入口的联动闭环：教师在产物详情中点击生成真实 PPTX、课堂视觉图和导入视频后，前端必须请求正确后端 route，snapshot 必须刷新出新保存的真实素材 artifact，随后下载按钮和最终材料包必须能使用这些新 artifact。

本阶段不重复调用真实 provider。真实 provider smoke 已由 M16、M18、M20 覆盖，后端 artifact adapter 已由 M17、M19、M21 覆盖。M27 覆盖的是浏览器 UI、前端 data source、后端 route 合同、下载 route 和材料包联动。

## 2. 本阶段变更

- `tests\e2e\stage27-real-generation-linkage.spec.ts`
  - 新增 Stage27 浏览器专项用例。
  - 使用真实按钮点击触发 `coze-ppt`、`image`、`video` route。
  - 使用 Playwright route 替身写入受控测试 artifact，不调用真实 provider。
  - 校验 PPTX、PNG、MP4 下载文件头和最终材料包 entries。
  - 校验教师可见界面不暴露工程词。
- `scripts\run-stage27-e2e.mjs`
  - 新增独立 Stage27 runner。
  - 使用 `test-results/stage27-e2e.db` 和单 worker。
- `src\lib\types.ts`
  - `ArtifactItem` 增加 `realAssetDownloads`，只暴露可下载素材类型，不暴露内部存储字段。
- `src\lib\workbench-mappers.ts`
  - 从后端 `structuredContent.storage` 推导 PPTX、图片、视频可下载标记。
  - 继续过滤 `storage` 等工程词，不进入教师可见内容。
- `src\hooks\useArtifactRealAssetDownload.ts`
  - 新增图片和视频下载 hook，调用既有 `/image` 与 `/video` GET route。
- `src\components\artifacts\ArtifactDetailSheet.tsx`
  - 对带本地图片素材的 artifact 显示“下载图片”。
  - 对带本地视频素材的 artifact 显示“下载视频”。

## 3. TDD 记录

红灯：

```powershell
node scripts\run-stage27-e2e.mjs
```

有效红灯结果：Stage27 在“真实课堂视觉图”详情中等待“下载图片”按钮时失败，说明生成后的图片 artifact 无法从教师界面下载。修正测试脚手架前曾出现两次前置状态/selector 问题，已收敛为真实用户逐节点确认路径和精确按钮匹配。

绿灯：

```powershell
node scripts\run-stage27-e2e.mjs
```

结果：Chromium desktop 1 passed。验证通过真实点击生成入口、snapshot 刷新、PPTX 下载、图片下载、视频下载、材料包包含 `classroom-visual.png` 与 `intro-video.mp4`。

## 4. 集中验收

| 命令 | 结果 |
| --- | --- |
| `node scripts\run-stage27-e2e.mjs` | 通过；Chromium desktop 1 passed |
| `npm test` | 通过；Node 41 tests passed；Vitest 21 files / 81 tests passed |
| `npm run build` | 通过；exit 0 |
| `npm run test:e2e:stage2` | 通过；Chromium desktop 2 passed |
| `npm run test:e2e:stage8` | 通过；Chromium narrow 和 Firefox desktop 共 4 passed |

构建仍有 1 条既有 Turbopack output tracing warning，import trace 指向 `src\server\video-generation\artifact-video.ts` 和 `/video` route；本阶段未新增 warning。

## 5. 边界与风险

- M27 使用浏览器 route 替身，不证明 provider 当次可用；真实 provider 当次可用性仍以 M16、M18、M20 或后续 live smoke 为准。
- 新增的是本地已保存真实素材的下载联动，不等于生产存储、对象存储、Range 请求或在线播放已完成。
- `realAssetDownloads` 是前端模型上的布尔能力标记，不暴露 `storage`、本地路径、私有端点或 provider 响应。
- 图片和视频文件仍来自 `.tmp` 本地素材路径；生产部署前必须替换为部署卷或对象存储策略。

## 6. 审查结论

M27 通过。当前主线已从“教师可触发真实素材生成入口”推进到“真实生成入口在浏览器中可联动新 artifact、下载按钮和最终材料包”的状态。下一阶段建议进入生产存储准备、账号权限系统规划，或补 WebKit/真实移动触摸专项验证。
