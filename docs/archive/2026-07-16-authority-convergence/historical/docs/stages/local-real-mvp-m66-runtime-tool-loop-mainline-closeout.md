# M66-R Runtime Native Tool Loop 主线接入收尾

日期：2026-07-10

状态：工程完成；默认关闭，显式开关启用

## 1. 完成内容

- 新增 `src\server\agent-runtime\native-tool-loop-config.ts`，把 `AgentRuntimeInput.task` 映射为单个 ToolRegistry internal tool。
- `createAgentRuntimeFromEnv(...)` 支持 `SHANHAI_OPENAI_NATIVE_TOOL_LOOP=1` 显式启用 OpenAI native tool loop；默认不启用，保持原 structured output 路径。
- `OpenAIRuntime` 支持 native tool loop resolver，可按每次 runtime input 动态决定是否暴露工具。
- 首批只暴露 internal capability tools，不暴露 provider、阻断工具或真实文件副作用工具。
- ToolRouter 输入由服务端 runtime input 构造，模型伪造的 `projectId`、`artifactRefs`、`sourceMessageId` 等控制字段不会进入执行层。
- internal tool 执行使用无 native loop 的 `toolExecutionRuntime`，避免 `OpenAIRuntime -> ToolRouter -> internal capability -> OpenAIRuntime` 递归。
- `AgentRuntimeInput`、CapabilityRunner 和 CTS 补充 `sourceMessageId` 透传，用于后续 observation / budget 审计。

## 2. 首批工具范围

已纳入 native tool loop 的 internal 工具：

```text
create_requirement_spec
create_lesson_plan
create_ppt_outline
create_ppt_design_draft
extract_knowledge_anchors
generate_intro_creative_themes
generate_intro_video_script
generate_video_storyboard
generate_video_asset_brief
plan_video_segments
create_final_delivery_checklist
```

仍不暴露给 native tool loop：

```text
generate_pptx_from_design
generate_classroom_image
generate_video_segment
asset_image_generate
concat_only_assemble
intro_video
```

原因：这些能力涉及真实 provider、真实文件、视频、最终包或当前阻断能力，需要更完整的 HumanGate、GenerationJob、resolved Artifact 和 Quality Gate 链路，不能在 M66-R 首批让模型直接选择。

## 3. 验证证据

```text
npx vitest run tests/agent-runtime/native-tool-loop-config.test.ts tests/agent-runtime/runtime-factory-native-tool-loop.test.ts --maxWorkers=2
  2 files passed / 6 tests passed

npx vitest run tests/agent-runtime/openai-runtime.test.ts tests/openai-tool-loop-runner.test.ts tests/tool-router.test.ts tests/conversation-turn-service.test.ts --maxWorkers=2
  4 files passed / 61 tests passed

npx tsc --noEmit
  exit 0

npm test
  Node: 197 passed / 0 failed
  Vitest: 452 passed / 0 failed

npm run build
  Prisma Client generated
  Next.js production build exit 0

git diff --check
  exit 0

graphify update .
  2666 nodes / 6542 edges / 204 communities
```

没有残留 Vitest、Jest 或 Playwright worker。

## 4. 未包含范围

- 未接真实 MCP Client / MCP Server。
- 未支持并行 tool calls。
- 未把 provider 工具暴露给 OpenAI native tool loop。
- 未为 Runtime input 增加服务端 `resolvedArtifacts`，因此 provider 工具仍不能从 native loop 安全执行。
- 未实现 `asset_image_generate`、`concat_only_assemble` 和工具层真实 ZIP 最终包。
- 未执行真实外部 Provider 网络 smoke。

## 5. 下一步

下一阶段应进入真实工具金路径闭环：实现 `asset_image_generate`、`concat_only_assemble` 和真实最终包动作，并扩展 Runtime/ToolRouter 输入，使 provider 工具只使用服务端 resolved Artifact；随后用一个真实小学数学公开课任务验收从教师输入到 PPTX、图片、视频和最终材料包下载的完整链路。
