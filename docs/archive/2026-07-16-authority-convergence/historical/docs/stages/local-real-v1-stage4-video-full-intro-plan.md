# V1 Stage 4：视频 Full Intro 逐镜头生产计划

日期：2026-07-12

状态：planned

关联需求：`RQ-025 视频 Full Intro 逐镜头闭环`

## 目标

将当前“整份计划一次视频请求”替换为真实 Full Intro 工艺：课程锚点、独立创意、节拍、`ShotSpec[]`、视频专属参考资产、按 `shotId` 生成/恢复/审查/返修、音字后期、编码归一化和 FFmpeg 合成。短预览只能是 `preview_only`，不得冒充最终导入视频。

## 范围与边界

- 保留 Main Agent 的受控 ReAct、项目 lease、GenerationJob、原子提升和 HumanGate。
- 每个 shot 独立保存 inputHash、providerTaskId、attempt、clip、QA、选择版本和返修定位。
- 参考资产必须 `assetDomain=video`，记录 assetId/hash/用途/shot 适用范围；PPT 资产、PPT 总览和候选视频抽帧必须阻断。
- 旁白、字幕、overlay 是独立可返修轨道；复杂中文、数字和公式不能交给视频模型生成。
- 不实现 Studio 编辑器、资源库和第二档能力。

## 实施分段

### 4A 合同与导演工件

建立 `VideoIntent`、`CreativeBrief`、`ScriptBeatSheet`、`StoryboardManifest`、`ShotSpec`、`ReferenceAssetManifest`、`ResolvedShotExecution` 及 validator。缺 `shotId` 的局部返修必须先追问；答案泄露、儿童安全、跨域参考资产为硬阻断。

### 4B 逐镜头任务与恢复

Provider Adapter 每次只提交一个 shot，真实传递受信 URL 或 multipart 参考资产，并持久化实际传递的 assetId/hash。任务恢复优先 poll 已有 providerTaskId，不重复 submit 或计费。

### 4C QA、后期和成片

每个 clip 先过 ffprobe 和 Shot Critic，再按 `ordinal` 归一化并由 FFmpeg 合成。最终以 TimelineManifest、ffprobe、Video Critic、QualityDecision 和教师决定共同决定是否可交付。

## 完成标准

1. 三个 shot 可独立提交、恢复、失败重试、选择与返修。
2. 连续性镜头证明参考资产真实进入 Provider 请求；跨域/PPT 资产稳定被阻断。
3. 单镜头修复不重跑其他镜头，任务中断后可恢复。
4. FFmpeg 输出真实可播放 MP4，ffprobe 流、时长和编码与 TimelineManifest 一致。
5. Critic 能定位 shotId/track/timeline，阻断答案泄露、儿童安全和音字错误。
6. fixture 只证明工程合同；真实 Provider、真实成片、教师审查和最终包仍为外部验收门。
