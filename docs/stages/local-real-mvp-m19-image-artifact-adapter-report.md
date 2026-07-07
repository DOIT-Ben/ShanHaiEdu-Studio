# Local Real MVP M19 Image Artifact Adapter Report

日期：2026-07-07

## 1. 阶段目标

M19 将 M18 的真实图片 API smoke 推进到后端 artifact adapter：后端可以基于 `ppt_draft` 产物触发课堂视觉图生成，并保存一个包含本地图片 metadata 的新版本 `ppt_draft` artifact。

本阶段不新增教师 UI 按钮，不把图片加入最终材料包，不宣称图片工作流已完整完成。

## 2. 本轮实现

### 2.1 图片服务端模块

新增 `src\server\image-generation\image-generation-run.ts`：

- 读取 `IMAGE_PROVIDER_CHANNEL` 指定的服务端图片 provider env。
- 支持根地址、`/v1` 地址或完整 `/v1/images/generations` endpoint。
- 基于项目和当前 PPT 大纲 artifact 组装课堂视觉图 prompt。
- 调用 OpenAI-compatible 图片生成接口。
- 支持 `b64_json` 和 URL 两类图片响应。
- 校验 PNG/JPEG 魔数。
- 保存本地图片到 `.tmp\image-artifacts\`。
- 返回本地输出路径、文件名、字节数、sha256、mime 和 `imageValid=true`。

### 2.2 后端 route

新增：

```text
POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/image
```

行为：

- 只允许 `ppt_draft` artifact 触发。
- 成功后保存新版本 `ppt_draft` artifact，标题为“真实课堂视觉图”。
- `structuredContent.storage.imageAsset` 保存本地文件 metadata。
- route 响应不包含 token、远程图片 URL、私有端点或完整 provider 响应。

## 3. 验收记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/image-generation/__tests__/image-artifact-adapter.test.ts --maxWorkers=1` | 红灯后绿灯 | 缺 route 时失败；实现后 2 tests passed |
| `node --test tests\image-smoke-script.test.mjs` | 通过 | 5 tests passed；M18 图片脚本契约未回归 |
| `npm test` | 通过 | Node 26 tests passed；Vitest 18 files / 73 tests passed |
| `npm run build` | 通过 | 新增 `/image` route；Prisma、Next.js、TypeScript 和静态页面生成均通过 |

## 4. 风险与边界

- M19 route 单元测试 mock provider adapter；真实 provider 可用性仍由 M18 live smoke 证明。
- `.tmp` 是本地 MVP 存储，不是生产持久化方案；生产部署准备阶段必须替换为部署卷或对象存储。
- 本阶段未新增教师 UI 触发入口，也未把图片打入最终材料包。
- 当前只保存图片 metadata，不新增图片下载 route；后续需要定义图片下载、材料包集成和 PPTX 内嵌策略。

## 5. 审查结论

M19 通过：图片能力已从服务端 live smoke 推进到后端 artifact adapter。下一步应进入视频真实 API readiness/live smoke，或继续补图片下载/材料包集成边界。
