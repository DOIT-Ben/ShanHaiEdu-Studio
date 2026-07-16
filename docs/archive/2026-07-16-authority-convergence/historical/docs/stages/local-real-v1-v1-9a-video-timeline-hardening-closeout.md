# V1-9A 视频时间线前置硬化收尾

更新时间：2026-07-13

## 1. 阶段结论

V1-9A 已关闭 `concat_only_assemble` 直接拼接 MP4 文件字节的问题。产品 Package Tool 现在会对每个已批准镜头执行 ffprobe，统一归一化为 H.264/AAC 媒体参数，再由 FFmpeg concat 形成真实可完整解码的成片，并持久化时间线与逐镜头采样帧证据。

本阶段没有调用真实图片、视频或 PPT Provider，也没有由外部 Codex 选择创意、批准课程锚点或决定返修范围。

## 2. 已完成

- 新增 `video-timeline-assembler` 独立模块：
  - 校验镜头 `shotId`、ordinal、文件 SHA-256 和视频流。
  - 对不同输入参数逐镜头归一化。
  - 无输入音轨时补技术静音轨，使媒体时间线可稳定拼接；该轨不冒充旁白或课程音频证据。
  - FFmpeg concat 后执行成片 ffprobe 和完整解码。
  - 按每个镜头时间中点导出真实 PNG 采样帧。
  - 形成 `ShotProbeEvidence`、`NormalizedClipManifest`、`TimelineManifest` 和 `FinalVideoEvidence`。
- `concat_only_assemble` 不再使用 `Buffer.concat`。
- Package Tool 只写入真实存在的 `finalVideo`、`timeline` 和 `sampledFrames`；不会伪造 transcript 或 audioTrack。
- Provider 结果映射会把真实 `requestEvidence` 持久化到视频片段 Artifact，供后续组装按镜头身份绑定。
- 缺失镜头绑定时稳定返回质量门禁失败，不允许按版本号猜测镜头顺序。

## 3. 验证证据

```text
专项：35/35 通过
TypeScript：npx tsc --noEmit 通过
Node：259/259 通过
Vitest：815/815 通过
生产构建：通过，13/13 静态页面
git diff --check：通过
```

测试使用 FFmpeg 现场生成的真实本地短 MP4，覆盖一个无音轨镜头和一个有音轨镜头；最终成片通过完整解码、顺序、时间线、采样帧和真实音轨验证。没有调用外部 Provider。

构建保留 4 条既存 Turbopack 动态文件模式告警，均指向本阶段未修改的本地存储和反馈存储实现，不影响本阶段通过结论。

## 4. 未关闭的 V1-9 P0

1. Main Agent 的 `inputDraft.shotIds` 虽已进入 Tool Router，但 Provider Adapter 尚未把它解析为 `ResolvedShotVideoRequest` 并选择 StoryboardManifest 中唯一目标镜头。当前结果侧可以保存 `requestEvidence`，但产品内真实调用侧还不能证明逐镜头请求已闭环。
2. 视频参考资产上传能力已存在，但尚未从当前 Artifact 契约自动解析本地参考资产、上传并绑定到单镜头请求。
3. 产品尚未自动形成真实 transcript/字幕与可审计 audioTrack 证据，因此 `video_final_review` 仍会正确阻断。
4. 最终包主路径尚未切换到 `buildVersionedFinalPackage()`。

上述四项必须在唯一一次真实 E2E 前关闭；本地媒体组装通过不能替代产品 Main Agent 的真实编排证据。

## 5. 下一步

进入 V1-9B：建立 `shotIds -> StoryboardManifest -> reference upload evidence -> ResolvedShotVideoRequest -> Provider Artifact requestEvidence` 的产品内单镜头闭环，并实现真实字幕/转写与音轨证据采集。随后进入 V1-9C 版本化最终包接入。
