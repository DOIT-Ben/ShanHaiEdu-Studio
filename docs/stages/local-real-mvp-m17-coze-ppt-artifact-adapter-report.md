# Local Real MVP M17 Coze PPT Artifact Adapter Report

日期：2026-07-07

## 1. 阶段目标

M17 目标是把 M16 的真实 Coze PPT smoke 能力推进为后端 artifact 能力：PPT 大纲 artifact 可触发 Coze PPT 生成 route，后端保存一个新版本 PPT artifact，并让现有 PPTX 下载 route 优先返回本地保存的真实 Coze PPTX 文件。

本阶段不新增教师 UI 按钮；前端仍使用已有 PPTX 下载入口。

## 2. 本轮实现

### 2.1 Coze PPT 服务端模块

新增 `src\server\coze-ppt\coze-ppt-run.ts`：

- 读取 `COZE_PPT_RUN_URL` 和 `COZE_API_TOKEN`。
- 基于项目和当前 PPT 大纲 artifact 组装 Coze `/run` 请求。
- 解析纯 JSON 或 Markdown fenced JSON。
- 下载远程 PPTX 到 `.tmp\coze-ppt-artifacts\`。
- 校验 zip 头和 `ppt\presentation.xml`。
- 返回本地输出路径、文件名、字节数和 sha256。

### 2.2 后端 route

新增：

```text
POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/coze-ppt
```

行为：

- 只允许 `ppt_draft` artifact 触发。
- 成功后保存新版本 `ppt_draft` artifact，标题为“真实 PPTX 文件”。
- `structuredContent.storage.cozePptx` 保存本地文件 metadata。
- route 响应不包含 token、远程 PPTX URL 或私有端点。

### 2.3 PPTX 下载与材料包

更新：

- `src\server\pptx\artifact-pptx.ts`
- `src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\pptx\route.ts`
- `src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\package\route.ts`

行为：

- 如果 artifact 存在 `structuredContent.storage.cozePptx.localOutput`，下载 route 优先返回本地真实 Coze PPTX。
- 如果没有 Coze 文件，继续回退 M11 的最小 PPTX 生成能力。
- 读取本地文件时约束在 `.tmp` 目录内，避免路径越界。
- 最终材料包也优先打包真实 Coze PPTX。

## 3. 验收记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/coze-ppt/__tests__/coze-ppt-artifact-adapter.test.ts --maxWorkers=1` | 红灯后绿灯 | 缺 route 时失败；实现后 2 tests passed |
| `node --test tests\artifact-pptx-download.test.mjs` | 通过 | 2 tests passed；无 Coze 文件时仍生成最小 PPTX |
| `npm test` | 通过 | Node 21 tests passed；Vitest 17 files / 71 tests passed |
| `npm run build` | 通过 | 新增 `/coze-ppt` route；构建无 Turbopack warning |

## 4. 风险与边界

- M17 使用 M16 已验证的 `/run` 通道作为 provider 后端，不等于 Coze 官方 OpenAPI 主链路已完成。
- `.tmp` 是本地 MVP 存储，不是生产持久化方案；生产部署准备阶段必须替换为部署卷或对象存储。
- 本阶段未新增教师 UI 的“生成真实 PPT”按钮；真实触发入口先作为后端 route 保留。
- 当前材料包可优先使用真实 Coze PPTX，但只有在项目中已生成对应 Coze artifact 时生效。

## 5. 审查结论

M17 通过：Coze PPT 能力已从脚本 smoke 推进到后端 artifact adapter，现有 PPTX 下载和最终材料包已能优先复用本地真实 Coze PPTX 文件。下一步应进入 M18：图片真实 API readiness/live smoke。
