# V1-9E Full Intro 叙事完整性与时长闭环测试计划

更新时间：2026-07-13

## 1. 合同测试

| 编号 | 场景 | 预期 |
|---|---|---|
| V1-9E-01 | Full Intro 缺少目标总时长 | Storyboard Validator 拒绝 |
| V1-9E-02 | 目标总时长小于 30 秒或大于 90 秒 | Validator 拒绝 |
| V1-9E-03 | 镜头时长总和不能覆盖目标范围 | Validator 拒绝 |
| V1-9E-04 | 三个长镜头或多个短镜头满足同一目标 | 均可通过，不固定镜头数 |
| V1-9E-05 | 单镜头目标超出 Provider 6-30 秒能力 | Validator/Provider Resolver 拒绝 |

## 2. Provider 测试

| 编号 | 场景 | 预期 |
|---|---|---|
| V1-9E-06 | 配置默认 6 秒，ShotSpec 要求 8-10 秒 | 请求使用 8 秒 |
| V1-9E-07 | 配置默认落在 ShotSpec 范围 | 保留配置时长 |
| V1-9E-08 | Provider request evidence | 同时绑定 shotId、durationSeconds 与参考资产证据 |
| V1-9E-09 | 恢复同一 GenerationJob | input hash 与 unitId 不变，不重复提交 |

## 3. 组装与审查测试

| 编号 | 场景 | 预期 |
|---|---|---|
| V1-9E-10 | 缺少一个 Storyboard 镜头 | 组装失败，不创建成功 Artifact |
| V1-9E-11 | 同一 shotId 有两个批准片段 | 组装失败 |
| V1-9E-12 | 片段 shotId 完整但 ordinal 错误 | 组装失败 |
| V1-9E-13 | 实际成片明显短于目标范围 | 质量门禁失败 |
| V1-9E-14 | 完整 Storyboard、片段和时长 | 形成真实 timeline、目标时长和 Storyboard digest 证据 |
| V1-9E-15 | 成片 Critic输出 | 必须包含 `narrative_completeness_and_pacing`，缺失时报告无效 |

## 4. 回归范围

- Main Agent仍逐镜头提出 `shotIds`，不由外部 Codex指定镜头。
- HumanGate、IntentEpoch、GenerationJob、Provider taskId恢复和镜头级返修不回退。
- 课程锚点六硬门继续独立存在，新增成片叙事门不能替代课程锚点门。
- TTS、字幕、FFmpeg、ffprobe 和最终包版本绑定不回退。

## 5. 验证命令

```powershell
$env:VITEST_MAX_WORKERS='1'
npx vitest run tests/video-production-contract.test.ts tests/provider-tool-adapter.test.ts tests/package-tool-adapter.test.ts tests/video-agent-critic-review-adapter.test.ts tests/tool-registry.test.ts tests/tool-router.test.ts tests/agent-runtime/openai-runtime.test.ts tests/capability-runner.test.ts --maxWorkers=1
npx tsc --noEmit
npm test
npm run build
git diff --check
```

本阶段只使用确定性合同夹具和本地 FFmpeg 真实媒体夹具，不调用外部 Provider。
