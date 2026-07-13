# V1-9C 受控音轨与字幕证据计划

更新时间：2026-07-13

## 1. 目标

关闭产品内部成片 Critic 所需的五类真实证据。视频模型原始音轨不作为可信课堂内容；产品使用已批准视频脚本生成受控 MiniMax TTS 音轨与同源字幕 timing，再由 FFmpeg 替换成片音轨，形成真实 `finalVideo`、`timeline`、`sampledFrames`、`transcript` 和 `audioTrack`。

## 2. 已调研能力

- 本机 AI 资产索引存在 MiniMax 多模态/TTS 能力。
- 官方 MiniMax CLI 源码使用 `POST /v1/t2a_v2`、`speech-2.8-hd` 和 `subtitle_enable=true`。
- API 返回真实音频以及 `subtitle_file`；字幕文件为 `text/time_begin/time_end` 毫秒数组。
- 当前仓库没有 Whisper、STT、TTS 或字幕后期实现，因此不得把视频脚本直接填进 transcript 字段。

## 3. 实现

1. `video_script_generate` 同时产出教师可读 Markdown 和 `videoNarrationScript`：语言、声音、受控旁白文本、课程锚点边界。
2. Runtime 与 Capability Runner 确定性校验结构化旁白脚本；Markdown-only 或 deterministic fallback 不能进入真实媒体 Tool。
3. 新增 MiniMax narration adapter：
   - 密钥和 endpoint 只从环境变量读取。
   - 请求 TTS 音频和 subtitle timing。
   - 验证响应状态、音频 bytes、字幕 URL、HTTPS、时间连续性和文本非空。
   - 保存模型、声音、文本 digest、音频和字幕证据，不保存密钥。
4. `concat_only_assemble` 增加已批准 `video_script_generate` 前置，并在 HumanGate 后调用 narration adapter。
5. FFmpeg 用受控 TTS 替换 Provider 原始音轨；若 TTS 时长超过成片或音轨/字幕校验失败，则成片 Tool 失败。
6. 从最终 MP4 提取真实 AAC 音轨文件并计算 hash；把实际字幕数组转换为 SRT 并计算 hash。
7. 五类证据齐全后才允许产品内部 `video_final_review`；Critic pass 后仍需教师批准。

## 4. 边界

- 不保留或信任视频模型随机旁白、随机英文和环境音。
- 字幕文本和音轨必须来自同一次 TTS 响应。
- TTS 字幕 timing 不能由模型或外部 Codex手填。
- 本阶段测试使用注入的真实本地音频夹具和字幕响应，不调用真实 TTS；真实 TTS 只在 V1-9 收尾唯一 E2E 调用一次。

## 5. 成功标准

- 最终 MP4 的音轨 hash 可反向提取验证。
- SRT cue 均在成片时长内、严格递增、文本非空。
- `videoFinalReviewEvidence` 五类真实证据齐全并通过现有 Critic evidence gate。
- TTS 缺配置、响应无音频、字幕缺失、时长越界、hash 或 mux 失败均不得保存成功成片。
