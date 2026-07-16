# V1-9B 产品内单镜头 Provider 合同收尾

更新时间：2026-07-13

## 1. 阶段结论

V1-9B 已关闭“Main Agent 虽能在文本计划中写 `shotIds`，但真实 Provider Adapter 不消费它”的缺口。视频分镜现在必须同时具备教师可读 Markdown 和产品可执行 `videoStoryboardManifest`；真实视频 Tool 每次只接受一个目标镜头，并把该镜头作为 GenerationJob `unitId`、Provider 请求和结果 Artifact 的共同身份。

本阶段没有调用真实视频 Provider；参考资产上传使用本地真实文件与受控 HTTP 夹具验证。

## 2. 已完成

- OpenAI Runtime 对 `storyboard_generate` 强制要求 `video-storyboard.v1` 结构化内容。
- 模型只负责分镜语义字段；`manifestDigest` 由产品 `createStoryboardManifest()` 确定性计算，不信任模型自报 hash。
- Capability Runner 会拒绝缺失或无效的结构化分镜，deterministic/Markdown-only 结果不能进入真实视频生产。
- `video_segment_generate` Tool Schema 要求 `shotIds` 且 V1 每次恰好一个。
- Main Agent 提示约束初次生成和局部返修都必须逐镜头计划。
- Conversation Turn Service 将唯一镜头写入 GenerationJob `unitId`，并将 Tool 输入纳入内部 input snapshot 和 input hash。
- Provider Adapter：
  - 从当前已批准 StoryboardManifest 解析唯一镜头。
  - 缺失、多镜头、重复、越界和无效分镜均在 submit 前阻断。
  - 由镜头 `modelPrompt` 和 `negativePrompt` 构造单镜头请求。
  - 需要参考图时读取已批准资产 Artifact 的真实存储文件与 SHA-256，调用既有 Evolink 文件上传，再验证 HTTPS URL、assetDomain、hash 和 shot 绑定。
  - 将 `requestEvidence.shotId` 与引用上传证据写入视频片段 Artifact。
- 镜头选择/绑定错误被归类为不可自动重试的质量门禁失败，不再误报成 Provider 暂时不可用。

## 3. 验证

```text
专项：118/118 通过
TypeScript：通过
Node：259/259 通过
Vitest：820/820 通过
生产构建：通过，13/13 静态页面
git diff --check：通过
```

构建仍保留 4 条既存 Turbopack 动态文件模式告警，本阶段未修改对应存储实现。

## 4. 仍未关闭

1. 当前 V1 资产图 Provider 每次形成一个主参考图；单镜头需要多个独立参考资产时仍会阻断，不能假装全部已实传。
2. `concat_only_assemble` 已具备成片、时间线和采样帧，但尚未自动形成真实 transcript/字幕与可审计 audioTrack 文件证据。
3. 最终包主路径尚未适配 `buildVersionedFinalPackage()`。
4. 仍未启动唯一一次真实 Provider E2E。

## 5. 下一步

进入 V1-9C：实现字幕/转写与音轨证据采集，让产品内部 `video_final_review` 获得真实五类证据；随后适配版本化最终包，再由产品 Main Agent 从界面独立运行一次真实 E2E。
