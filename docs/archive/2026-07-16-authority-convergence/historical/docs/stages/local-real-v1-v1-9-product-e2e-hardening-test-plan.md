# V1-9 产品内真实 E2E 前置硬化测试计划

更新时间：2026-07-13

## 1. 测试原则

本阶段只使用 FFmpeg 在测试目录生成的真实短 MP4，不调用图片、视频或 PPT Provider。夹具用于验证媒体工具和证据契约，不得作为最终交付物。

## 2. 专项用例

| 编号 | 场景 | 预期 |
|---|---|---|
| V1-9A-01 | 两个不同颜色、不同输入参数的真实 MP4 | 归一化后按 ordinal 组装，成片可完整解码 |
| V1-9A-02 | 逐镜头 ffprobe | 每个镜头有绑定 sourceArtifactId、shotId、sha256、时长和视频流证据 |
| V1-9A-03 | 时间线 | entries 连续、无重叠、顺序正确，总时长与成片 ffprobe 在容差内一致 |
| V1-9A-04 | 采样帧 | 每个镜头至少一帧，storageRef 和 sha256 指向真实 PNG |
| V1-9A-05 | 音轨 | 输入有/无音轨均可归一化；成片真实音轨由 ffprobe 证明 |
| V1-9A-06 | 非法媒体 | 缺视频流、损坏 MP4、零时长或 ffprobe 失败时 Tool 返回 quality gate failure |
| V1-9A-07 | 镜头身份 | 缺失、重复或非法 `shotId`，以及顺序冲突时稳定拒绝 |
| V1-9A-08 | 工具不可用 | FFmpeg/ffprobe 不存在时稳定失败，不保存成功 Artifact |
| V1-9A-09 | Critic 证据 | 组装结果只写入真实 `finalVideo`、`timeline`、`sampledFrames`；缺 transcript 时成片 Critic 仍阻断 |
| V1-9A-10 | 回归 | 现有 Tool Router、Agent Tool、HumanGate、PPT 和双用户测试不回归 |

## 3. 验证命令

```powershell
npx vitest run tests/video-timeline-assembler.test.ts tests/package-tool-adapter.test.ts tests/video-agent-critic-review-adapter.test.ts
npx tsc --noEmit
npm test
npm run build
git diff --check
```

测试运行需限制 worker，避免在 Windows 本机并发启动大量 FFmpeg 或测试进程。

## 4. 阶段门禁

只有以下条件全部满足，才允许进入唯一一次产品内真实 E2E：

1. 本计划专项用例全部通过。
2. 五类 `videoFinalReviewEvidence` 已由真实 Tool 完整形成，不能靠测试 fixture 或手工字段填充。
3. 最终包使用版本绑定强实现并完成反向 ZIP 验证。
4. Main Agent、独立 Critic、HumanGate、Quality Gate 和恢复证据链均在产品内部闭环。
5. 外部 Codex 不参与创意选择、批准和返修决策。
