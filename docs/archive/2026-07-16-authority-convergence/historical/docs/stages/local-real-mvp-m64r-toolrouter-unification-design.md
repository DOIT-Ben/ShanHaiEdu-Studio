# M64-R ToolRouter 统一封装设计

日期：2026-07-10

状态：已确认，进入实施

## 1. 目标

把当前主线 17 项 Capability 全部映射到唯一 ToolDefinition，并让已经真实可执行的 PPTX、课堂图片和分镜视频统一经过：

```text
Capability plan
  -> PlanGuard / HumanGate / CapabilityAvailability
  -> ToolRegistry
  -> ToolRouter
  -> Internal Capability Adapter / Provider Tool Adapter
  -> ToolExecutionResult
  -> Artifact / GenerationJob / ToolObservation 持久化
```

本阶段解决“已注册能力与真实执行入口不一致”的问题，不扩展新 Provider。

## 2. 当前事实

- CapabilityRegistry 有 17 项能力。
- ToolRegistry 有 15 项定义，其中 12 项可执行、3 项明确阻断。
- `image_asset` 和 `video_segment_generate` 缺少 ToolDefinition。
- `ConversationTurnService` 与图片、视频独立 API Route 直接调用 Provider runner，绕过 ToolRouter。
- `intro_video`、`asset_image_generate`、`concat_only_assemble` 尚无真实实现，必须继续 fail-closed。
- `final_package` 当前只生成交付清单，不在本阶段伪装为真实 ZIP 打包。
- OpenAI native tool loop 主线接线属于既有 M66-R 范围，本阶段不混入。

## 3. 方案选择

采用已确认的“方案 B：统一路由”。

不采用只补注册定义的方案，因为它会保留真实 Provider 旁路；不采用一次性实现全部阻断工具的方案，因为资产图、视频拼接、最终包和 native tool loop 是独立交付能力，必须分别经过真实 Provider、文件和质量门禁验收。

## 4. 设计边界

### 4.1 注册一致性

- 每个 CapabilityId 必须且只能映射一个 ToolDefinition。
- 新增 `generate_classroom_image`，映射 `image_asset`。
- 新增 `generate_video_segment`，映射 `video_segment_generate`。
- 图片要求已批准 `ppt_draft`，输出 `image_prompts`。
- 视频要求已批准 `video_segment_plan`、`storyboard_generate`、`asset_image_generate`，输出 `video_segment_generate`。
- 阻断工具继续保留定义和阻断原因，但不得暴露为 OpenAI 可执行 schema。

### 4.2 Provider Adapter

- ProviderToolAdapter 统一支持 Coze PPTX、课堂图片和分镜视频。
- ToolRouter 只接受服务端注入的项目和已批准 Artifact 事实，不信任模型提交的项目 ID、产物 ID、审批状态或本地路径。
- Provider Adapter 只执行外部调用、验证结果并返回 `ToolExecutionResult`；不直接写 Workbench 数据库。
- 成功结果必须包含 `artifactTruth`、`qualityGate`、真实文件 metadata 和可保存的 ArtifactDraft。
- 图片质量门禁至少验证真实 PNG/JPEG；视频质量门禁至少验证真实 MP4 `ftyp/moov`；PPTX 保持现有 slideCount 门禁。

### 4.3 编排职责

- ConversationTurnService 保留 PlanGuard、HumanGate、预算、GenerationJob、Artifact 保存和消息回写。
- CTS 不再包含图片/PPTX/视频 Provider runner 和 ArtifactDraft 构造分支。
- 图片和视频独立 API Route 保留权限、route-level HumanGate、GenerationJob 与 Artifact 保存，但执行动作必须调用 ToolRouter。
- ToolRouter 返回失败时，编排层只能保存失败 Job/Observation，不能保存占位 Artifact。

### 4.4 明确不做

- 不实现 `asset_image_generate` Provider。
- 不实现 `concat_only_assemble`。
- 不把 `final_package` 清单改称真实 ZIP。
- 不接 M66-R OpenAI native tool loop 主线。
- 不新增 MCP client。
- 不修改前端视觉。

## 5. 风险与回退

- 风险：迁移后 source Artifact 选择变化。控制：所有入口只使用同项目、已批准且 kind/nodeKey 匹配的真实 Artifact。
- 风险：视频多上游输入丢失。控制：ToolDefinition 与 Provider Adapter 同时要求三种前置 Artifact，并写入输入血缘 metadata。
- 风险：Job 状态未闭合。控制：成功必须 `finishGenerationJob`，失败必须 `failGenerationJob`，门禁失败不得创建 Job。
- 风险：Provider 错误泄露。控制：Observation 只写固定教师文案和脱敏内部类别。
- 回退：保留现有 Provider runner；若统一路由出现回归，可回退编排调用点，不涉及数据库不可逆迁移。

## 6. 成功标准

1. CapabilityId 与 ToolDefinition capabilityId 集合严格相等，且无重复。
2. 17 项能力为 14 项可执行或 3 项明确阻断；不存在未登记能力。
3. 图片、PPTX、分镜视频的 CTS 和独立 API 执行入口都经过 ToolRouter。
4. HumanGate、CapabilityAvailability、GenerationJob 和 Artifact 持久化行为保持。
5. Provider 失败或质量门禁失败不保存占位 Artifact。
6. 针对性测试、全量测试、TypeScript、构建和 `git diff --check` 全部通过。
