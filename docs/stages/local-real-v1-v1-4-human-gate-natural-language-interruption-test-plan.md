# ShanHaiEdu V1-4 HumanGate与自然语言打断测试计划

更新时间：2026-07-13

状态：`passed`（专项7文件96/96；全量、构建与SQLite门禁通过）

## 1. 测试边界

- 使用确定性夹具、失败注入和持久化状态验证，不调用真实媒体Provider。
- 测试必须同时检查教师可见响应、pending/paused/canceled状态、IntentEpoch、actionId、Observation、Checkpoint和Tool调用次数。
- 不用单个关键词测试代替语义生命周期验证。

## 2. 验收矩阵

| ID | 场景 | 通过标准 |
|---|---|---|
| T4-01 | 原样按钮确认 | actionId与文本均绑定当前offer时执行一次 |
| T4-02 | 编辑按钮文本 | 文本发生实质修订时旧actionId零授权，旧offer退出活动状态 |
| T4-03 | 低副作用自然语言继续 | 唯一active计划可继续，无按钮依赖 |
| T4-04 | 高成本模糊继续 | 只选择方向并披露动作，不执行Provider |
| T4-05 | 高成本明确确认 | 只有已披露动作与匹配actionId可执行一次 |
| T4-06 | 改道 | 旧offer superseded、IntentEpoch+1、新能力重新规划 |
| T4-07 | 修订 | 新计划绑定新action，旧action重放失败 |
| T4-08 | 暂停 | 生成paused状态与teacher_requested_pause Checkpoint，不推进Tool |
| T4-09 | 恢复 | 唯一paused计划恢复后签发新action，旧action不复活 |
| T4-10 | 取消 | canceled并推进IntentEpoch，恢复旧action失败 |
| T4-11 | 多候选消歧 | 只问一个具体问题，不猜测、不执行Tool |
| T4-12 | 局部返修影响 | 有合法locator时记录repair_unit、目标和impact digest |
| T4-13 | 上游修订影响 | 修改目标/大纲记录repair_upstream并只失效受影响下游 |
| T4-14 | 未受影响复用 | 历史Artifact保留，未受影响批准项不变stale |
| T4-15 | 迟到结果 | 旧IntentEpoch staging结果quarantine，不能提升Artifact |
| T4-16 | 历史失败隔离 | superseded/canceled分支失败保留审计但不进入当前活动WorldState |
| T4-17 | Queue一致性 | 排队消息中的actionId与自然语言控制使用同一合同 |
| T4-18 | 教师可见安全 | 响应不出现工程字段、内部状态、路径或密钥 |

## 3. 计划测试文件

- `tests\conversation-control-resolver.test.ts`
- `tests\conversation-turn-service.test.ts`
- `tests\react-observation-replan.test.ts`
- `tests\agent-world-state.test.ts`
- `src\server\workbench\__tests__\stage4-stale-propagation.test.ts`
- `src\server\workbench\__tests__\stage30-generation-job-queue.test.ts`
- `src\server\workbench\__tests__\stage60-conversation-turn-queue.test.ts`

## 4. 阶段验证

```text
npx vitest run tests/conversation-control-resolver.test.ts tests/conversation-turn-service.test.ts tests/react-observation-replan.test.ts tests/agent-world-state.test.ts src/server/workbench/__tests__/stage4-stale-propagation.test.ts src/server/workbench/__tests__/stage30-generation-job-queue.test.ts src/server/workbench/__tests__/stage60-conversation-turn-queue.test.ts --maxWorkers=1
npx tsc --noEmit --pretty false
npm test
npm run build
git diff --check
```

SQLite使用独立`.tmp`数据库连续初始化2/2。V1-4不得执行真实图片、视频或整包生成。
