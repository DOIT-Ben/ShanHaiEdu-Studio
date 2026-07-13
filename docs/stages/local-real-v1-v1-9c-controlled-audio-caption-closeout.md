# V1-9C 受控音轨、字幕与成片审查证据收尾

更新时间：2026-07-13

## 1. 阶段结论

V1-9C 已关闭“视频 Provider 随机音轨和文本脚本无法形成可审计成片证据”的缺口。产品现在要求 `video_script_generate` 产出结构化受控旁白脚本；成片组装时由 MiniMax TTS Adapter 生成音频和字幕，FFmpeg 丢弃镜头 Provider 原始音轨并写入受控旁白，随后从最终 MP4 反向提取真实 AAC，形成可供产品内部 `video_final_review` 读取的五类证据。

本阶段没有调用真实 TTS、图片、视频或 PPT Provider；MiniMax 响应、音频和字幕下载使用受控夹具，最终 MP4、AAC、SRT 和逐镜头采样帧使用本地真实 FFmpeg/ffprobe 验证。

## 2. 已完成

- 新增 `video-narration-contract`：
  - 定义 `video-narration-script.v1` 结构化旁白合同。
  - 校验语言、音色、正文、课程锚点和答案泄露边界。
  - `scriptDigest` 由产品确定性计算，不信任模型自报 hash。
- OpenAI Runtime 对 `video_script_generate` 强制要求 `videoNarrationScript`；Capability Runner 拒绝缺失或无效结构化脚本。
- 新增 MiniMax TTS Adapter：
  - 请求受控音频与字幕。
  - 验证响应状态、音频内容、HTTPS 字幕地址和字幕 timing。
  - 将毫秒级字幕 cue 转换为真实 SRT。
  - Provider 配置只从环境读取，不写入 Artifact、日志或教师可见内容。
- `concat_only_assemble` 同时要求已批准的视频片段和视频脚本；缺少任一前置时在 Package Tool 前阻断。
- FFmpeg 成片路径：
  - 逐镜头归一化和拼接后，显式移除 Provider 原始音轨。
  - 将受控 TTS 音频编码为 AAC 并写入最终 MP4。
  - 对最终 MP4 执行完整解码和 ffprobe。
  - 从最终 MP4 反向提取真实 AAC，避免把 TTS 输入文件冒充最终音轨证据。
- 持久化真实 SRT、AAC、文件大小、时长、SHA-256 和存储引用。
- `videoFinalReviewEvidence` 现在完整包含：
  - `finalVideo`
  - `timeline`
  - `sampledFrames`
  - `transcript`
  - `audioTrack`
- 测试合同同步要求视频脚本作为成片组装硬前置；真实 FFmpeg 媒体测试单独使用 20 秒上限，未放宽全局测试超时。

## 3. 验证证据

```text
V1-9C 专项：58/58 通过
路由与可用性回归：26/26 通过
真实 FFmpeg 成片夹具：7/7 通过
TypeScript：通过
Node：259/259 通过
Vitest：825/825 通过（116/116 files，单 worker）
生产构建：通过，13/13 静态页面
git diff --check：通过
密钥模式扫描：无命中
残留 Vitest/Jest worker：0
```

Vitest 必须以单 worker 运行：项目测试共享 SQLite 文件，2 个 worker 会产生 `database is locked`、事务超时和连带失败；同一批失败文件在单 worker 下为 38/38 通过。这是测试执行隔离约束，不是 V1-9C 业务回归。

构建仍保留 4 条既存 Turbopack 动态文件模式告警，指向本阶段未修改的本地存储和反馈存储实现；编译、TypeScript 和页面生成均通过。

## 4. 仍未关闭

1. 当前生产 Main Agent 主路径尚未把 `executeFinalPackage()` 适配到 `buildVersionedFinalPackage()`。
2. 最终包尚未强制绑定 `courseVersionId`、`courseAnchor`、`reviewBatchId` 和 `ClassroomRunSpec`，也未证明 PPT、视频、教案和清单来自同一批准版本。
3. 真实 MiniMax TTS 仍未调用；真实字幕 URL、音频响应和最终音字同步只完成合同与夹具验证。
4. 唯一一次产品内真实 Provider E2E 尚未启动。

## 5. 下一步

进入 V1-9D：将生产最终包主路径切换到版本一致的 `buildVersionedFinalPackage()`，强制绑定课程版本、课程锚点、审查批次和课堂运行规格，并用确定性夹具验证错版、漏件和审查证据不足时必定阻断。V1-9D 全部门禁通过后，才允许产品 Main Agent 从界面启动唯一一次真实 E2E。
