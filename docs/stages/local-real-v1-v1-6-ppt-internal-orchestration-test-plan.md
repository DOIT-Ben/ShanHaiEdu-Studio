# ShanHaiEdu V1-6 PPT 产品内编排闭环测试计划

更新时间：2026-07-13

状态：`executed`

## 1. 验收矩阵

| ID | 场景 | 通过标准 |
|---|---|---|
| T6-01 | Director 规划 | Main Agent 调用 PPT Director 后自主提出正确业务 Tool |
| T6-02 | 样张 Critic pass | 生成逐页 D/V/P passed 审查与样张集，但不自动批准 |
| T6-03 | 样张 Critic fail | finding 映射到目标页和 D/V/P 维度，不能进入全量 |
| T6-04 | 样张 HumanGate | 未批准时全量资产调用 0；批准后下一次任务才可继续 |
| T6-05 | 整套 Critic pass | 逐页 D/V/P/R 审查通过并形成候选交付包，仍等待教师确认 |
| T6-06 | 整套页级返修 | finding 只产生目标 pageId，未受影响页面 render digest 保持不变 |
| T6-07 | Critic 绑定 | 错项目、版本、digest、stage 或 locator 稳定拒绝 |
| T6-08 | Observation/Replan | Critic rework 后 Main Agent 消费报告并改变计划，不重复同一调用 |
| T6-09 | 外部零介入 | 测试证据只来自产品 Agent、Agent Tool、业务 Tool 和 HumanGate |
| T6-10 | 无真实 Provider | V1-6 所有测试真实媒体请求次数为 0 |

## 2. 计划测试文件

- `tests\ppt-agent-critic-review-adapter.test.ts`
- `tests\ppt-main-agent-orchestration.test.ts`
- `tests\conversation-turn-service.test.ts`
- `tests\ppt-sample-approval-persistence.test.ts`
- `tests\ppt-full-deck-review-persistence.test.ts`
- `tests\ppt-full-deck-page-repair.test.ts`

## 3. 阶段门禁

```text
npx vitest run tests/ppt-agent-critic-review-adapter.test.ts tests/ppt-main-agent-orchestration.test.ts tests/conversation-turn-service.test.ts tests/ppt-sample-approval-persistence.test.ts tests/ppt-full-deck-review-persistence.test.ts tests/ppt-full-deck-page-repair.test.ts --maxWorkers=1
npx tsc --noEmit --pretty false
npm test
npm run build
git diff --check
```

SQLite 使用隔离 `.tmp` 数据库连续初始化 2/2。浏览器覆盖 1366×768 和 390×844 的样张等待批准、审查失败定位和页级返修状态。不得调用真实媒体 Provider。
