# M64-R ToolRouter 统一封装测试计划

日期：2026-07-10

## 1. 验收目标

证明工具注册完整、真实 Provider 不再绕过 ToolRouter、失败不产生假 Artifact，同时保持 HumanGate、Job、权限和下载合同。

## 2. 注册合同

- CapabilityRegistry 与 ToolRegistry capabilityId 集合严格相等。
- 每个 capabilityId 只出现一次。
- `image_asset` 映射 `generate_classroom_image`。
- `video_segment_generate` 映射 `generate_video_segment`。
- 三项阻断工具不可转为 OpenAI executable schema。

## 3. Provider Adapter

### 图片
- 已批准 `ppt_draft` 可调用注入 runner。
- 成功返回 `image_prompts` ArtifactDraft、真实文件 metadata、truth 与 quality gate。
- 缺输入返回 `needs_input`，不调用 Provider。
- `invalid_image_output` 返回 `quality_gate_failed`。
- Provider 配置或请求失败返回脱敏 Observation，不创建 Artifact。

### 视频
- 只有 `video_segment_plan + storyboard_generate + asset_image_generate` 齐全时才调用 runner。
- 成功返回 `video_segment_generate` ArtifactDraft、真实 MP4 metadata、truth、quality gate 和输入血缘。
- 任一前置缺失返回 `needs_input`。
- `invalid_video_output` 返回 `quality_gate_failed`。
- Provider 配置、提交、轮询和下载失败返回脱敏 Observation，不创建 Artifact。

## 4. 编排合同

- CTS 的 `coze_ppt`、`image_asset`、`video_segment_generate` 都调用注入 ToolRouter。
- 无有效 HumanGate 时不调用 Router、不创建 Job。
- Router 成功后保存一个 Artifact 并完成 Job。
- Router 失败后不保存 Artifact，并按返回状态失败 Job、写 ToolObservation。
- 图片和视频独立 API POST 也调用 ToolRouter；GET 下载合同不变。

## 5. 静态旁路检查

允许 Provider runner import 的位置仅包括 ProviderToolAdapter、Provider runner 自身及其测试。CTS 和图片/视频 POST Route 不得直接 import 或调用：

```text
generateCozePptFromArtifact
generateImageFromArtifact
generateVideoFromArtifact
```

## 6. 验收命令

```powershell
npx vitest run tests/tool-registry.test.ts tests/tool-router.test.ts tests/provider-tool-adapter.test.ts tests/conversation-turn-service.test.ts src/server/image-generation/__tests__/image-artifact-adapter.test.ts src/server/video-generation/__tests__/video-artifact-adapter.test.ts --maxWorkers=1
npm test
npx vitest run --maxWorkers=2
npx tsc --noEmit
npm run build
```

通过标准：所有命令 exit 0，测试 0 failed；若外部真实 Provider 因凭据或网络无法 smoke，必须明确记录为未验证，不能用 mock 结果宣称真实 Provider 可用。
