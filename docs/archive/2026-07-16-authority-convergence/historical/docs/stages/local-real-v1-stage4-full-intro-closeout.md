# V1 Stage 4：真实视频 Full Intro 收尾

日期：2026-07-12

状态：真实 Provider 与集成审查通过；真实教师签收待完成

## 结论

`百分数的意义` 三镜头课堂导入视频已完成真实逐镜头生产、第三镜头局部返修、编码归一化、FFmpeg 合成和帧级审查。最终 MP4 为 18.125 秒、752×416、24fps、H.264/AAC，字节数 1,979,373，SHA-256 为 `99175e8de40f1a031eded69e9135136747396cd7f3e7265c901dea57e0aa3c66`。

这份结果通过主 Codex 的真实集成审查，但没有真实教师签收，不能据此关闭 V1 的教师验收门。

## 局部返修

原 `shot_03` 因场景和叙事漂移被拒绝。第一次以青绿色收纳篮作为参考图的返修虽然证明 Evolink 本地文件上传链路可用，但产生写实课堂，与前两镜头的暖色三维动画不连续，仍被拒绝。

第二次先由 MiniMax 生成视频专属 16:9 关键帧，固定橙色圆点盒子、儿童角色、暖色三维动画教室和课堂回接意图；通过禁字目检后，将该本地 JPEG 上传至 Evolink Files API，并把返回的临时 `file_url` 实际传入 Grok `image_urls[]`。仅重新生成 `shot_03`，`shot_01/02` 的 SHA-256 保持不变。

## 证据

| 项目 | 结果 |
|---|---|
| `shot_01` | 复用；`e3564a64...531d4` |
| `shot_02` | 复用；`0fe22f11...b098` |
| `shot_03` | 真实参考图返修；`af1283ca...4ee4` |
| 参考关键帧 | MiniMax；195,525 bytes；`783e9932...5bfa` |
| Provider 绑定 | 本地 assetId/hash、上传 file ID、临时 URL、实际 `image_urls` 在私有临时证据中绑定 |
| 最终 MP4 | `.tmp\stage4-full-intro-final\百分数的意义-课堂导入视频-v1.mp4` |
| Timeline | `.tmp\stage4-full-intro-final\timeline-manifest.json` |
| Critic | `.tmp\stage4-full-intro-final\video-critic-report.json` |
| 视觉证据 | `.tmp\stage4-full-intro-final\final-contact-sheet.png` 与四张边界帧 |

## 门禁结果

- `ffprobe`：视频 H.264 752×416 24fps；音频 AAC 48kHz 双声道；18.125 秒。
- `ffmpeg -v error`：完整解码无错误。
- 首、中、尾帧：三镜头均无可读文字、数字、公式、品牌、二维码或答案。
- 边界：第一到第二镜头由同一儿童和比较任务接续；第二到第三镜头由同一橙色圆点盒子接续。
- 局部返修：只替换 `shot_03`，前两镜头未重生成。

## 剩余门禁

1. 真实教师需观看并明确签收或提出返修意见。
2. Stage 5 最终包必须从真实 PPTX、PDF、视频、教案和 manifest 反向组装并校验版本一致性。
3. 三套递增教师任务、恢复门、浏览器门和目标服务器验证仍未完成。
