# M64-R ToolRouter Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 17 项 Capability 全部注册到 ToolRegistry，并把现有 PPTX、图片和视频真实执行统一收口到 ToolRouter。

**Architecture:** ToolRegistry 是唯一工具目录，ToolRouter 是唯一执行分流边界。ProviderToolAdapter 复用现有 Coze PPT、图片和视频 runner；CTS/API 只负责编排、门禁、Job 和 Artifact 持久化。

**Tech Stack:** Next.js 16、TypeScript、Prisma 7 + SQLite、Vitest、现有 Workbench/Agent Runtime/Provider runners。

---

## Task 1：注册表严格一致性

**Files:**
- Modify: `tests/tool-registry.test.ts`
- Modify: `src/server/tools/tool-registry.ts`
- Modify: `src/server/capabilities/capability-registry.ts`

- [ ] 先写失败测试，断言 CapabilityRegistry 与 ToolRegistry capabilityId 集合严格相等且无重复。
- [ ] 写失败测试，断言 `generate_classroom_image` 和 `generate_video_segment` 的 adapter、前置产物、输出和 providerToolId。
- [ ] 运行 `npx vitest run tests/tool-registry.test.ts --maxWorkers=1`，确认因缺少两项工具失败。
- [ ] 最小实现两项 ToolDefinition，并把图片、视频 Capability 上游合同对齐真实执行路径。
- [ ] 重跑测试并确认 0 failed。

## Task 2：图片 Provider 工具

**Files:**
- Modify: `tests/provider-tool-adapter.test.ts`
- Modify: `tests/tool-router.test.ts`
- Modify: `src/server/tools/provider-tool-adapter.ts`
- Modify: `src/server/tools/tool-router.ts`

- [ ] 先写图片成功、缺前置、Provider 失败、质量失败和脱敏失败测试。
- [ ] 先写 Router 按 `image_asset` 分派 Provider Adapter 的失败测试。
- [ ] 运行两个测试文件并确认失败原因是图片工具尚未支持。
- [ ] 复用 `generateImageFromArtifact`，返回真实图片 ArtifactDraft、ArtifactTruth 和 QualityGate。
- [ ] 重跑两个测试文件并确认 0 failed。

## Task 3：视频 Provider 工具

**Files:**
- Modify: `tests/provider-tool-adapter.test.ts`
- Modify: `tests/tool-router.test.ts`
- Modify: `src/server/tools/provider-tool-adapter.ts`
- Modify: `src/server/tools/tool-router.ts`

- [ ] 先写视频三种前置 Artifact、成功 metadata、缺输入、Provider 失败和质量失败测试。
- [ ] 先写 Router 按 `video_segment_generate` 分派 Provider Adapter 的失败测试。
- [ ] 运行两个测试文件并确认失败原因是视频工具尚未支持。
- [ ] 复用 `assertVideoProviderPreconditions` 与 `generateVideoFromArtifact`，返回真实视频 ArtifactDraft、ArtifactTruth、QualityGate 和输入血缘。
- [ ] 重跑两个测试文件并确认 0 failed。

## Task 4：ConversationTurnService 去旁路

**Files:**
- Modify: `tests/conversation-turn-service.test.ts`
- Modify: `src/server/conversation/conversation-turn-service.ts`

- [ ] 先写失败测试，断言 `image_asset` 和 `video_segment_generate` 都调用注入的 ToolRouter。
- [ ] 保留既有 HumanGate、Availability、预算、Job、Artifact 和消息合同测试。
- [ ] 运行目标测试并确认新断言失败。
- [ ] 将图片和视频加入 ToolRouter 能力集合，删除 CTS 的 Provider 直连分支与重复 ArtifactDraft 构造代码。
- [ ] 重跑目标测试并确认 0 failed。

## Task 5：图片与视频 API Route 去旁路

**Files:**
- Modify: `src/server/image-generation/__tests__/image-artifact-adapter.test.ts`
- Modify: `src/server/video-generation/__tests__/video-artifact-adapter.test.ts`
- Modify: `src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/image/route.ts`
- Modify: `src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/video/route.ts`

- [ ] 先修改 route 测试，断言 POST 通过 ToolRouter 执行，Provider 失败不保存 Artifact。
- [ ] 运行两个 route 测试并确认新断言失败。
- [ ] Route 在权限和 HumanGate 通过后构建服务端 Artifact refs，调用 ToolRouter，并保存其 ArtifactDraft。
- [ ] 保留 GET 下载行为、Job 生命周期和教师安全错误文案。
- [ ] 重跑两个 route 测试并确认 0 failed。

## Task 6：集中验收与收尾

**Files:**
- Add: `docs/stages/local-real-mvp-m64r-toolrouter-unification-closeout.md`
- Modify: `docs/mainlines/current-mainline-status.md`

- [ ] 运行 M64-R 针对性 Vitest，最大 worker 设为 1。
- [ ] 运行全量 Node/Vitest 测试，使用项目既有资源上限。
- [ ] 运行 `npx tsc --noEmit`、`npm run build`、`git diff --check`。
- [ ] 运行 `graphify update .` 并检查图谱报告。
- [ ] 由独立 reviewer 检查注册一致性、旁路残留、门禁和占位产物风险。
- [ ] 写 closeout，记录真实测试证据和剩余阻断工具。
