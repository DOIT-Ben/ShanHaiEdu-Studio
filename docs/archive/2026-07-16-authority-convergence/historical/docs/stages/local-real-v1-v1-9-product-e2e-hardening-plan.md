# V1-9 产品内真实 E2E 前置硬化计划

更新时间：2026-07-13

## 1. 目标

在不调用真实 Provider 的前提下，关闭产品 Main Agent 发起唯一一次真实 E2E 前的媒体与成包硬缺口：真实 MP4 必须由 FFmpeg 按镜头顺序组装，逐镜头和成片都必须有 ffprobe 技术证据，并形成可供产品内部成片 Critic 使用的真实时间线与采样帧证据。

本阶段不由外部 Codex 选择创意、批准课程锚点、决定返修范围或代替 Main Agent 编排。外部 Codex 只实现确定性 Tool、Validator 和证据链。

## 2. 当前事实

- 逐镜头 Provider 请求、参考资产实传、`shotId`、`VideoShot`、`GenerationJob.unitId`、Provider taskId 恢复和 `submission_unknown` 已存在。
- `concat_only_assemble` 当前使用 `Buffer.concat`，无法证明 MP4 时间线有效。
- 产品内部成片 Critic 已要求 `finalVideo`、`timeline`、`sampledFrames`、`transcript`、`audioTrack` 五类证据，但组装 Tool 尚未自动形成真实证据。
- 本机已有 FFmpeg/ffprobe 7.1.1；V1-9 部署前提仍是单 Node 进程和单 Prisma singleton。

## 3. 范围

### 3.1 本阶段实现

1. 新增独立 `video-timeline-assembler`：
   - 解析每个已批准镜头的真实 MP4。
   - 校验视频流、时长、分辨率、帧率、codec 和可选音轨。
   - 使用 FFmpeg 将镜头归一化为统一 H.264/AAC 时间基线。
   - 使用 concat demuxer 形成真实可播放成片，不再拼接文件字节。
   - 对成片执行 ffprobe 与完整解码校验。
   - 按每个镜头中点导出采样帧。
   - 形成 `ShotProbeEvidence`、`NormalizedClipManifest`、`TimelineManifest` 和 `FinalVideoEvidence`。
2. `concat_only_assemble` Tool 调用该模块并持久化成片、归一化镜头、采样帧及结构化证据。
3. 只有真实媒体证据完整时 Tool 才成功；FFmpeg、ffprobe、镜头输入、流、时长、顺序或输出验证失败时不保存成功 Artifact。

### 3.2 明确不伪造

- `transcript` 只能来自真实字幕文件或真实转写结果。
- `audioTrack` 只能来自成片真实音轨探测与提取结果。
- 成片没有音轨时，不生成假的音轨 digest；没有字幕或转写时，不生成 placeholder transcript。
- 五类证据不完整时，`video_final_review` 和最终包必须继续阻断。

### 3.3 后续子阶段

- V1-9B：把真实字幕/转写与音轨证据接入产品 Tool，关闭五类成片证据。
- V1-9C：最终包主路径适配 `buildVersionedFinalPackage()`，绑定 `courseVersionId`、`courseAnchor`、`reviewBatchId` 和 `ClassroomRunSpec`。
- V1-9D：从产品界面由 Main Agent 独立启动唯一一次真实 E2E；外部 Codex 仅在成包后生成只读 `ExternalAcceptanceReport`。

## 4. 契约

```text
ShotProbeEvidence
  shotId / sourceArtifactId / sourceSha256
  durationMs / video(codec,width,height,fps)
  audio(codec,channels,sampleRate) | null

NormalizedClipManifest
  normalizationProfile / orderedClips[]
  每项绑定 shotId、sourceSha256、normalizedSha256、storageRef、durationMs

TimelineManifest
  timelineId / shotIds / durationMs / entries[]
  每项绑定 shotId、ordinal、startMs、endMs、sourceArtifactId、normalizedClipSha256

FinalVideoEvidence
  storageRef / sha256 / bytes / durationMs
  video/audio probe / fullyDecoded / sampledFrames[]
```

所有 locator 均绑定当前 Artifact 和当前镜头集合；不得接受越界 `shotId`、时间范围或旧 digest。

## 5. 风险与回退

- 风险：不同 Provider 输出的分辨率、帧率、像素格式和音频轨不一致。处理：逐镜头归一化，不依赖 stream copy。
- 风险：Windows 路径和 concat 清单转义。处理：由模块生成受控临时目录与清单，不接受用户拼接命令。
- 风险：无音轨镜头导致 concat 音轨不一致。处理：归一化时为无音轨镜头补静音，只作为真实成片技术轨，不冒充旁白或课程音频证据。
- 风险：运行环境找不到 FFmpeg。处理：支持环境变量覆盖与已知本机路径解析；找不到时硬失败。
- 回退：`package-tool-adapter` 只保留单一调用点；移除调用即可回到上一提交，历史 tag 不移动。

## 6. 成功标准

- 测试能够证明两个或三个本地真实 MP4 夹具被 FFmpeg 组装为可完整解码成片。
- 时间线顺序、各镜头时长、总时长、采样帧和 SHA-256 一致。
- 非法 MP4、缺视频流、错误镜头绑定、工具缺失和 ffprobe 失败均稳定拒绝。
- `Buffer.concat` 不再用于 `concat_only_assemble`。
- 专项测试、TypeScript、Node 全量、Vitest 全量和生产构建零失败后，才进入真实 Provider E2E。
