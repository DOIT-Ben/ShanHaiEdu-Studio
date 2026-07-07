# Local Real MVP M28 Artifact Storage Prep Report

日期：2026-07-07

## 1. 阶段目标

M28 目标是把真实 PPTX、图片和视频素材从只写 `.tmp` 的本地临时实现，推进到可配置部署卷的生产准备状态。

本阶段不做对象存储、CDN、生产部署、清理策略或视频 Range 请求；只收敛本地文件写入和读取边界。

## 2. 本阶段变更

新增统一本地素材存储 helper：

- `src\server\artifact-storage\local-artifact-storage.ts`
- `writeLocalArtifact`：未配置时继续写 `.tmp\<category>`；配置 `ARTIFACT_STORAGE_ROOT` 时写入固定存储根目录。
- `resolveLocalArtifactOutput`：同时解析旧 `.tmp/...` metadata 和新 `artifact-storage/...` metadata。
- 路径安全规则：拒绝空路径、绝对路径、盘符路径、`..`、`.` 和非允许前缀。

改造真实素材写入：

- Coze PPTX 生成使用 `writeLocalArtifact`。
- 图片生成使用 `writeLocalArtifact`。
- 视频生成使用 `writeLocalArtifact`。

改造真实素材下载：

- PPTX 下载使用 `resolveLocalArtifactOutput` 读取已保存的真实 Coze PPTX。
- 图片下载使用 `resolveLocalArtifactOutput` 读取已保存图片。
- 视频下载使用 `resolveLocalArtifactOutput` 读取已保存 MP4。

测试补充：

- 新增 `tests\artifact-storage.test.mjs` 覆盖默认 `.tmp` 写入、配置部署卷写入、新旧 metadata 解析和越界拒绝。
- 更新 `tests\artifact-pptx-download.test.mjs` 的 test shim，使其能加载统一 storage helper。

## 3. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\artifact-storage.test.mjs` | 通过；2 tests passed |
| `node --test tests\artifact-pptx-download.test.mjs` | 通过；2 tests passed |
| `npx vitest run src/server/image-generation/__tests__/image-download-route.test.ts src/server/video-generation/__tests__/video-download-route.test.ts src/server/coze-ppt/__tests__/coze-ppt-artifact-adapter.test.ts --maxWorkers=1` | 通过；3 files / 8 tests passed |
| `npm test` | 通过；Node 43 tests passed；Vitest 21 files / 81 tests passed |
| `npm run build` | 通过；仍有 1 条 Turbopack output tracing warning |
| `node scripts\run-stage27-e2e.mjs` | 通过；Chromium desktop 1 passed |
| `git diff --check` | 通过；无空白错误 |
| `git check-ignore -v .env .tmp` | 通过；`.env` 与 `.tmp` 均被 `.gitignore` 忽略 |
| 本轮变更严格脱敏扫描 | 未发现真实 key、token、Bearer 值、签名 URL 或任务标识值；宽松扫描命中的 `apiKey`/`Authorization` 为源码变量名和请求头拼接 |
| 残留进程检查 | 未发现本工作区相关 Vitest/Jest/Playwright/Next dev 残留 Node 进程 |

## 4. 审查结论

M28 已把真实素材保存路径从分散的 provider adapter 拼接，收敛到统一的 ArtifactStorage 边界。

当前可以如实表述为：

- 本地开发默认 `.tmp` 行为不回归。
- 部署准备时可通过 `ARTIFACT_STORAGE_ROOT` 写入固定目录。
- 新配置模式下持久化 metadata 不保存机器绝对路径，而保存 `artifact-storage/<category>/<filename>` 逻辑 key。
- 下载 route 兼容旧 `.tmp/...` metadata 和新 `artifact-storage/...` metadata。
- 路径解析已拒绝常见越界输入。

当前不能表述为：

- 已完成对象存储。
- 已完成生产部署。
- 已完成素材生命周期清理、迁移、备份或 CDN。
- 已完成视频在线播放 Range 请求。
- 已消除 Next/Turbopack 对本地文件读取的 output tracing warning。

## 5. 剩余风险

- `ARTIFACT_STORAGE_ROOT` 只提供部署卷形态；未来如果接对象存储，需要新增独立 adapter，不应继续扩大本地文件 helper。
- 构建仍有 1 条 Turbopack output tracing warning，风险已集中在服务端 storage/download 路径，生产部署前仍需结合实际部署方式复查。
- 旧 `.tmp` metadata 会继续被兼容读取；如果后续要迁移历史素材，需要单独写迁移脚本和回滚方案。
- 当前不处理存储配额、清理策略、并发写入锁和备份策略。

## 6. 下一阶段建议

优先进入 M29 账号与权限最小闭环：

- 定义本地 MVP 的用户、角色、项目访问边界和会话边界。
- 先做单机本地账号，不引入公网登录和第三方 OAuth。
- 确保项目列表、项目详情、产物下载和真实生成动作都经过同一权限判断。

备选下一阶段为 M30 长任务队列与状态恢复：

- 覆盖 PPT、图片、视频生成的耗时、失败、重试和刷新恢复。
- 避免真实生成长任务只依赖一次 HTTP 请求生命周期。
