# ShanHaiEdu V1-2 Tool与Agent Tool注册收尾

更新时间：2026-07-13

状态：`done`

## 1. 阶段结论

V1-2已完成三个高层Agent Tool的合同注册、调用信封、Main Agent可见白名单、默认数据库授权、独立Router、Executor结果权威边界和课程锚点独立Critic合同封板。

本阶段只证明Agent Tool合同、Router硬门、默认授权和注入Executor测试成立，不证明生产Executor、Main Agent同轮多Tool ReAct或产品内课程锚点运行时闭环已经完成。三个Agent Tool继续保持：

```text
contractReady=true
executorReady=false
mainAgentExecutable=false
implemented=false
```

## 2. 完成内容

| 能力 | 收尾结果 |
|---|---|
| Agent Tool Registry | 注册`ppt_director.plan_or_repair`、`video_director.plan_or_repair`、`delivery_critic.review`，保持无业务副作用、无生产Executor |
| 调用信封 | 绑定actor、projectId、IntentEpoch、sourceMessage、输入hash、action digest、批准输入和待审Artifact版本/digest |
| 默认授权 | 项目身份、消息、最新审查目标、批准状态、版本与digest不一致时fail-closed |
| Executor结果边界 | 按状态精确白名单重建；未知字段、Symbol、伪造HumanGate/QualityDecision字段稳定拒绝 |
| Critic目标边界 | 输入、输出和finding locator必须属于签名review target；支持合法page/asset/shot/track/timeline/frame-range子定位，拒绝跨Artifact和同Artifact兄弟范围漂移 |
| 课程锚点Critic | 六硬门、独立创意正反例、唯一最小回接、答案泄露、结构化finding、非空最小修复和上游责任阶段均形成可执行合同 |
| 结果语义 | 合法业务返修保持`succeeded + policyOutcome`供Main Agent Replan；只有信封、Schema、结构或目标绑定错误返回Router失败 |
| 非成功Observation | `needs_input`、`failed`、`inconclusive`经过运行时结构校验后保留原状态和Observation |

## 3. 新鲜验证

```text
Agent Tool专项
npx vitest run tests/agent-tools tests/tool-registry.test.ts tests/tool-router.test.ts --maxWorkers=1
8 files / 140 tests passed

TypeScript
npx tsc --noEmit --pretty false
exit 0

全量测试
npm test
Node 259/259 passed
Vitest 103 files / 763 tests passed

生产构建
npm run build
exit 0；TypeScript通过；13个静态页面生成完成

隔离SQLite连续初始化
同一.tmp数据库2/2 exit 0

git diff --check
exit 0，仅有工作区LF/CRLF提示
```

生产构建保留3条既有动态文件模式过宽的Turbopack性能警告；本阶段没有新增构建失败。

## 4. 人工审查结论

- Executor返回值不再通过对象展开直接透传，Router只重建声明字段。
- 课程锚点业务不通过不会被误报为执行失败，Main Agent仍可消费结构化返修依据。
- 缺finding、空修复、下游责任阶段、错误Artifact或范围逃逸属于不可消费合同错误，稳定返回`agent_tool_output_invalid`。
- 根Artifact授权允许审查其合法子范围；签名为具体页或镜头时，输出不能漂移到兄弟页或兄弟镜头。
- 注入Executor继续标记`unverified_injected`与`productionEligible=false`，不能解锁真实媒体Tool或冒充生产Critic。

## 5. 未关闭边界

- 生产PPT Director、Video Director和Delivery Critic Executor尚未接入。
- Main Agent尚不能在同一轮消费Agent Tool Observation后自主选择下一Tool。
- 执行前与持久化前的租约/fencing二次复核、调用幂等和防重放仍属于V1-3/V1-7。
- 产品内`video_final_review`、真实HumanGate、双用户编排和真实整包E2E尚未验证。
- 本阶段未调用真实PPT、图片、视频或最终包Provider，未制作新交付包。

## 6. 下一阶段

进入V1-3 Main Agent受控ReAct。先写V1-3阶段计划与测试计划，再接统一Dispatcher、可信Agent Tool Executor、同轮Observation/Replan、预算/停止条件、租约下二次复核和固定DeliveryPlan显式降级。V1-3不得把注入Executor或固定计划计入Main Agent自主编排证据。
