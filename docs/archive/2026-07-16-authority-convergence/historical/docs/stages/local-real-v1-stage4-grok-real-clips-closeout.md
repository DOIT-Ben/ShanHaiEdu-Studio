# V1 Stage 4：Grok 真实三镜头片段证据

日期：2026-07-12

状态：真实 Provider 三镜头与技术时间线通过，尚未通过 Full Intro 交付审查

## 授权

教师明确授权使用 API 台账中的 Grok/Evolink 视频 Provider，生成真实三镜头 MP4。

## 先前证据复核

初版 closeout 中列出的三段文件哈希已无法在当前本地忽略目录中定位，不能作为可恢复资产使用。该记录保留为历史调用线索，但不再作为当前交付证据。

## 2026-07-12 重新实测结果

Provider：Evolink Grok Imagine；模型：`grok-imagine-text-to-video-beta`；调用路径：服务端适配器 submit -> poll -> download -> MP4 基础校验。

| shotId | 内容 | bytes | SHA-256 |
|---|---|---:|---|
| `shot_01` | 生活观察悬念 | 861,726 | `e3564a64caae2cf55b21b8ab745b7ee6d3f41aa39bb1f7ad3cff5220f5a531d4` |
| `shot_02` | 比较不同状态 | 842,045 | `0fe22f118c7acab776f69f193d1cb76524146be7c1cc68e4d9d5eae72328b098` |
| `shot_03` | 回到课堂设问 | 1,128,780 | `23877cd5ec752e5c609ed79c8e0e68198f527fa1ed9be76ba48d4f39a39aec6e` |

每段在 Provider 接收任务时即写入 `VideoShot`：保存 `shotId`、顺序、输入哈希、Provider 任务关联和选择片段。三段均通过 MP4 基础结构校验，后续 `ffprobe` 结果一致：H.264/AAC、752×416、24fps、约 6.04 秒。

FFmpeg 已将三段规范化并按 ordinal 合成为 18.125 秒技术时间线：H.264、AAC、752×416、24fps，字节数 1,493,769，SHA-256 为 `bda3153f0243d0c7288bc774fc35e58f7b37519604e05ef687bb3b8ba904f7d4`。

## 结论与限制

三份文件均为重新生成并真实下载的 Grok MP4，且当前可恢复的镜头记录、`ffprobe` 与 FFmpeg 技术时间线均已存在。它们没有使用视频域参考资产，因此不能证明“连续性参考资产已真实传入 Provider”；同时还缺 Shot Critic、成片 Critic、教学锚点审查、可控音字轨道和教师成片审查。不得标记为 Full Intro 或进入最终 ZIP。
