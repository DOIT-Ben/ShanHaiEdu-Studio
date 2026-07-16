# Local Real MVP M38 Next Standalone Tracing Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M38 的核心需求是消除当前 `npm run build` 中的 Next/Turbopack NFT tracing warning，降低桌面打包对 `desktop:prepare` 安全过滤的依赖。M37 已经证明未签名客户端可安装、启动和卸载，但只要 standalone tracing 仍可能把整个项目误判进入 trace，客户端生产化就仍依赖额外过滤脚本兜底。

本阶段不改变 PPT、图片、视频的用户可见能力，不改变 provider 调用，不重写 ArtifactStorage，不删除 `desktop:prepare`。本阶段目标是让文件系统读写路径对 tracing 更静态、更窄，并用构建日志证明 warning 消失。

## 2. 可复用方案调研

项目内证据：

- `next.config.ts` 已配置 `output: "standalone"`。
- `npm run build` 当前 exit 0，但仍提示 1 条 NFT tracing warning。
- 新鲜构建 warning 的 import trace 为：
  - `next.config.ts`
  - `src\server\artifact-storage\local-artifact-storage.ts`
  - `src\server\video-generation\video-generation-run.ts`
  - `src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\video\route.ts`
- warning 文案提示动态文件系统路径可能导致整个项目被意外 traced，并建议把路径静态限定到子目录，或在必要处使用 `/*turbopackIgnore: true*/`。

外部一手依据：

- Next.js `output: "standalone"` 文档说明 Next 会通过 output file tracing 自动追踪 production server 所需文件，并把必要文件复制到 `.next\standalone`。来源：`https://nextjs.org/docs/app/api-reference/config/next-config-js/output`

项目既有防线：

- `scripts\prepare-desktop-bundle.mjs` 已过滤 `.env`、`.tmp`、`data`、`artifact-storage-root`、`docs`、`tests`、`test-results`、`node_modules` 和数据库文件。
- `src\server\artifact-storage\local-artifact-storage.ts` 已拒绝绝对路径和越界相对路径。
- `tests\artifact-storage.test.mjs` 已覆盖默认 `.tmp`、配置存储卷、逻辑 key 和越界拒绝。

## 3. 复用、适配和必要自研

复用：

- 复用现有 `LocalArtifactStorage` 接口，不改 metadata contract。
- 复用现有 `artifact-storage.test.mjs` 验证行为不回归。
- 复用 `npm run build` 作为 tracing warning 的最终验收。

适配：

- 将 `process.cwd()` 相关路径集中到显式 helper，确保默认存储根静态限定在 `.tmp`。
- 对确实需要运行时解析的 `process.cwd()` 位置添加 Turbopack ignore 注释，避免 NFT 把项目根当作可枚举输入。
- 保持 `ARTIFACT_STORAGE_ROOT` 配置模式可用，继续支持部署卷和桌面 userData 下素材根。

必要自研：

- 增加一个轻量静态测试，要求 ArtifactStorage 的运行时 cwd 路径带有 tracing ignore 标记，避免后续改动重新引入同类 warning。
- 更新 runbook、当前状态审计和 M38 报告，明确 warning 是否已消除。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M38 阶段规划和测试定义。
2. 记录当前红灯：`npm run build` exit 0 但出现 `Encountered unexpected file in NFT list`。
3. 新增静态回归测试，覆盖 tracing ignore 标记和存储根仍限定在 `.tmp`。
4. 最小修改 `src\server\artifact-storage\local-artifact-storage.ts`，不改外部 contract。
5. 运行聚焦测试和构建，确认 warning 消失。
6. 运行桌面准备和默认客户端 smoke，确认打包链路不回归。
7. 更新 M38 报告和审计文档，审查后提交，不 push。

主要风险：

- 仅为消 warning 不能放宽本地文件读取边界。
- `ARTIFACT_STORAGE_ROOT` 是运行时配置，不能被写死进构建产物。
- 如果 Turbopack 对 ignore 注释行为变化，本阶段需要改为 `outputFileTracingIncludes/Excludes` 或拆分下载读取模块。
- 即使 warning 消失，`desktop:prepare` 仍应保留为安全过滤门禁，不能直接删除。

验证标准：

- `node --test tests\artifact-storage.test.mjs` 通过。
- 新增 M38 tracing 静态测试通过。
- `npm run build` exit 0，且不出现 `Encountered unexpected file in NFT list`。
- `npm run desktop:prepare` 通过。
- `npm run desktop:smoke` 或 `npm run desktop:installer-smoke` 默认模式通过。
- `git diff --check`、脱敏扫描和残留进程检查通过。
