# ShanHaiEdu V1-3 Main Agent受控ReAct测试计划

更新时间：2026-07-13

状态：`passed`（专项15文件197/197；全量、构建与SQLite门禁通过）

关联计划：`docs\stages\local-real-v1-v1-3-main-agent-controlled-react-plan.md`

## 1. 测试边界

- 使用确定性模型响应夹具、注入Agent Tool Executor和失败注入验证编排，不调用真实媒体Provider。
- 注入Executor只证明组合合同，必须断言其不能进入生产工厂或获得`productionEligible=true`。
- 自动化必须区分合同、Executor、Main Agent同轮编排和领域E2E四个证据层级。

## 2. 验收矩阵

| ID | 场景 | 通过标准 |
|---|---|---|
| T3-01 | Dispatcher分类 | Agent Tool进入Agent Tool Router；业务Tool只有显式外层授权才能进入ToolRouter |
| T3-02 | Dispatcher白名单 | 未知、非模型可见、未实现或非白名单Tool稳定拒绝，底层Provider/数据库Tool不可见 |
| T3-03 | 服务端权威信封 | 模型参数不能覆盖actor、projectId、IntentEpoch、sourceMessage、Artifact版本/digest或review target |
| T3-04 | 可信Executor | 生产工厂有配置时创建OpenAI Executor；无配置时返回不可用，不回退deterministic专业结论 |
| T3-05 | Executor严格输出 | 输出按Agent Tool Schema验证；未知字段、错误状态和不合规报告由Router拒绝 |
| T3-06 | Main Agent同轮Agent Tool | 首个模型响应调用Director/Critic，function output返回后同一轮模型选择新的业务计划或追问 |
| T3-07 | Observation持久化 | Agent Tool Report/Observation绑定project、IntentEpoch、invocation和输入摘要；重建WorldState可读取 |
| T3-08 | Agent Tool业务返修 | `rework_required/blocked/inconclusive`作为Observation进入Replan，不退化为通用执行失败 |
| T3-09 | 业务Tool成功后Replan | OpenAI模式刷新WorldState后由Main Agent选择下一动作，固定DeliveryPlan不自动推进 |
| T3-10 | 业务Tool失败后Replan | Main Agent读取失败Observation后换Tool、改变输入、定点返修或请求教师；不原样自动重试 |
| T3-11 | HumanGate不旁路 | Replan选择第二个有副作用Tool时只创建新pending action，真实执行次数为0 |
| T3-12 | 重复与轮数 | 同一Agent Tool同一参数重复或超过3轮时停止并形成安全Observation/Checkpoint |
| T3-13 | 预算停止 | 同动作、连续失败、能力重试或上下文预算达到阈值时暂停，不写成功态 |
| T3-14 | 租约/IntentEpoch失效 | 执行前或结果持久化前状态变化时结果隔离，不进入当前WorldState |
| T3-15 | deterministic显式降级 | 无模型测试路径仍可工作，但metadata明确`fixed_delivery_plan_fallback`且不计入自主编排 |
| T3-16 | 教师可见安全 | 对话中不出现Tool ID、Schema、Provider、路径、密钥、原始响应或内部locator |

## 3. 计划测试文件

- `tests\agent-tools\main-agent-tool-dispatcher.test.ts`
- `tests\agent-tools\openai-agent-tool-executor.test.ts`
- `tests\agent-runtime\main-agent-controlled-react-loop.test.ts`
- `tests\conversation-turn-service.test.ts`
- `tests\agent-world-state.test.ts`
- `tests\react-observation-replan.test.ts`
- `src\server\workbench\__tests__\stage60-conversation-turn-queue.test.ts`

## 4. 阶段验证

```text
npx vitest run tests/agent-tools tests/agent-runtime/main-agent-controlled-react-loop.test.ts tests/conversation-turn-service.test.ts tests/agent-world-state.test.ts tests/react-observation-replan.test.ts src/server/workbench/__tests__/stage60-conversation-turn-queue.test.ts --maxWorkers=1
npx tsc --noEmit --pretty false
npm test
npm run build
git diff --check
```

SQLite连续初始化继续使用V1-2已验证的`.tmp`隔离方式，显式禁止读取`.env`数据库。同一数据库必须连续初始化2/2成功。

## 5. 封板审查

- 确认OpenAI模式已不由`advanceDeliveryPlan()`选择业务Tool下一步。
- 确认Agent Tool内循环不包含任何业务副作用Tool。
- 确认生产Agent Tool Executor没有DeterministicRuntime fallback。
- 确认所有Agent Tool调用具有真实ExecutionIdentity、project、IntentEpoch、sourceMessage和Artifact绑定。
- 确认V1-3 closeout没有宣称PPT、视频、课程锚点或真实最终包领域闭环已经完成。
