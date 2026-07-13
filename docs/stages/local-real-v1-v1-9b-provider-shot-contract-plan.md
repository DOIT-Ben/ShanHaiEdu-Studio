# V1-9B 产品内单镜头 Provider 合同计划

更新时间：2026-07-13

## 1. 目标

把 Main Agent 的镜头级计划真正落实为产品内可执行合同：`storyboard_generate` 必须产出可验证的结构化分镜清单；`video_segment_generate` 必须指定唯一目标 `shotId`；Provider Adapter 只能从当前已批准分镜中解析该镜头，绑定真实资产文件与上传证据后发起单镜头请求。

## 2. 实现范围

1. OpenAI Runtime 对 `storyboard_generate` 强制要求 `videoStoryboardManifest` 结构化内容，并用确定性 Validator 校验 schema、镜头连续性、课程锚点和 manifest digest。
2. Tool Registry 为 `video_segment_generate` 声明 `shotIds`，且 V1 每次真实调用只允许一个镜头。
3. Provider Adapter：
   - 拒绝缺失、重复、多镜头或越界 `shotIds`。
   - 只读取当前项目、已批准、当前版本的 Storyboard Artifact。
   - 按选中镜头的 `modelPrompt` 与 `negativePrompt` 构造请求。
   - 对需要参考图的镜头，从已批准资产图 Artifact 读取真实文件、SHA-256 和本地存储引用。
   - 使用既有 Evolink 文件上传能力形成受信 HTTPS URL 和上传证据。
   - 将 `requestEvidence.shotId` 与引用证据持久化到视频片段 Artifact。
4. 任一绑定失败时真实视频 Provider submit 次数必须为 0。

## 3. 边界

- Storyboard 阶段描述的是参考资产需求，不伪造尚未生成的文件 hash。
- Provider 阶段必须以真实资产 Artifact 的文件 hash 覆盖为最终生产证据。
- 外部 Codex 不选择镜头；目标镜头由产品 Main Agent 的 Tool Plan 决定，并受 HumanGate、IntentEpoch 和当前 Artifact 版本约束。
- 本阶段先用依赖注入的上传器和 Provider runner 测试，不调用真实 Provider。

## 4. 成功标准

- 结构化分镜缺失或无效时不能保存可供真实视频生成的 Artifact。
- 单镜头 Tool 输入、分镜镜头、上传证据和结果 Artifact 四处 `shotId` 完全一致。
- 参考图 hash、assetDomain、适用镜头和 HTTPS URL 全部验证。
- 错项目、旧版本、越界镜头、多镜头、损坏资产和上传失败全部在 submit 前阻断。
- 专项、TypeScript、全量测试和生产构建零失败。
