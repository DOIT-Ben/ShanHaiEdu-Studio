# ShanHaiEdu V1-7 视频产品内编排闭环测试计划

更新时间：2026-07-13

状态：`executed`

## 1. 验收矩阵

| ID | 场景 | 通过标准 |
|---|---|---|
| T7-01 | Director 独立创意 | 教材/PPT复述、受众强绑儿童课堂的候选被阻断 |
| T7-02 | 课程锚点六硬门 pass | 正式审查绑定当前创意、Rubric 与独立调用身份，但不自动批准 |
| T7-03 | 课程锚点 fail/inconclusive | finding 与最小修复保留，媒体 Tool 调用为 0 |
| T7-04 | Concept HumanGate | 未批准时逐镜头生成调用 0；当前版本批准后下一轮才可继续 |
| T7-05 | 成片证据完整性 | MP4、时间线、采样帧、字幕/转写、音轨五类证据齐全才可审查通过 |
| T7-06 | 成片漂移 finding | 独立创意、唯一锚点或答案边界漂移定位 shot/time/track |
| T7-07 | 局部返修 | Main Agent 输出结构化 `shotIds`/`trackIds`/`timeRanges`，不重做无关镜头 |
| T7-08 | 绑定与 locator | 错项目、版本、digest、Rubric、generator invocation 或越界 locator 拒绝 |
| T7-09 | Observation/Replan | Critic 结果持久化为 Report、正式审查、Observation，Main Agent 改变计划 |
| T7-10 | 无真实 Provider | V1-7 图片、视频、拼接和最终包真实调用次数均为 0 |

## 2. 计划测试文件

- `tests\video-agent-critic-review-adapter.test.ts`
- `tests\video-main-agent-orchestration.test.ts`
- `tests\agent-tools\video-course-anchor-gate.test.ts`
- `tests\agent-tools\agent-tool-router.test.ts`
- `tests\conversation-turn-service.test.ts`
- `tests\video-shot-persistence.test.ts`
- `tests\video-production-contract.test.ts`

## 3. 阶段门禁

```text
npx tsc --noEmit --pretty false
npx vitest run tests/video-agent-critic-review-adapter.test.ts tests/video-main-agent-orchestration.test.ts tests/agent-tools/video-course-anchor-gate.test.ts tests/agent-tools/agent-tool-router.test.ts tests/conversation-turn-service.test.ts tests/video-shot-persistence.test.ts tests/video-production-contract.test.ts --maxWorkers=1
npm test
npm run build
git diff --check
```

SQLite 使用隔离 `.tmp` 数据库验证正式审查与镜头记录持久化。不得调用真实媒体 Provider。若本阶段无 UI 改动，桌面与 390px 浏览器项记录为不适用，不得伪报通过。
