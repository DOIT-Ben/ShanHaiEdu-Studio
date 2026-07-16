# Agent Runtime Stage 4 Plan

日期：2026-07-07

## 1. 第一性原理：本阶段核心需求

Stage 4 不新增生成能力，目标是证明本主线已经满足可合并条件：合同、deterministic runtime、OpenAI 服务端边界、节点质量规则、失败恢复和边界约束都已实现并通过新鲜验证。

成功标准：

- 全量测试通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- React 组件和 App Router 页面无 OpenAI SDK 直接引用。
- 无明显密钥形态字符串被提交。
- `docs\mainlines\agent-runtime-adapter.md` 更新为当前完成状态。
- 工作区干净或只剩本阶段待提交文件。

## 2. 可复用方案调研

复用项目既有验收口径：

- `AGENTS.md` 要求完成前必须有新鲜验证证据。
- `docs\mainlines\agent-runtime-adapter.md` 要求 contract tests、deterministic golden tests、prompt output structure tests、error handling tests。
- `docs\mvp-to-production-agent-architecture.md` 要求无 key deterministic 可跑，有 key OpenAI runtime 服务端接入，OpenAI SDK 不进入 React 组件。

## 3. 复用、适配与必要自研

复用：

- 复用 Stage 1-3 已有测试。
- 复用 `rg` 做边界扫描。

适配：

- 本阶段只更新收口文档，不改 runtime 行为。

必要自研：

- `docs\stages\agent-runtime-stage4-closeout.md` 最终验收记录。
- `docs\mainlines\agent-runtime-adapter.md` 当前完成状态。

## 4. 验证标准

- `npm test -- --maxWorkers=2`
- `npm run build`
- `git diff --check`
- 前端 OpenAI 直连扫描无匹配。
- 密钥形态扫描无匹配。
