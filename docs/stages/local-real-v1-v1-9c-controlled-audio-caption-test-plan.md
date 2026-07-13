# V1-9C 受控音轨与字幕证据测试计划

更新时间：2026-07-13

| 编号 | 场景 | 预期 |
|---|---|---|
| V1-9C-01 | 视频脚本结构化输出 | `videoNarrationScript` 通过确定性校验 |
| V1-9C-02 | 缺失/空旁白脚本 | Runtime/Capability Gate 阻断 |
| V1-9C-03 | TTS 音频与 subtitle_file | 下载真实 bytes 和 timing，生成 SRT |
| V1-9C-04 | Provider 原始随机音轨 | 最终 MP4 中被受控 TTS 完全替换 |
| V1-9C-05 | 无原始音轨镜头 | 仍能形成受控最终音轨 |
| V1-9C-06 | 旁白短于视频 | 结尾补静音但不复制或伪造字幕 |
| V1-9C-07 | 旁白长于视频 | Tool 失败，不截断语义、不保存成功成片 |
| V1-9C-08 | 字幕 timing 越界/倒序/空文本 | Tool 失败 |
| V1-9C-09 | 五类成片证据 | 成片 Critic evidence gate 接受，HumanGate 仍分离 |
| V1-9C-10 | TTS Provider 失败 | 可恢复 Provider 失败，视频组装不冒充完成 |

验证命令：

```powershell
npx vitest run tests/video-narration-provider.test.ts tests/package-tool-adapter.test.ts tests/video-agent-critic-review-adapter.test.ts tests/agent-runtime/openai-runtime.test.ts tests/capability-runner.test.ts --maxWorkers=1
npx tsc --noEmit
npm test
npm run build
git diff --check
```
