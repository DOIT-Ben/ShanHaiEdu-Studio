# ShanHaiEdu V1-3 Main Agent受控ReAct收尾

更新时间：2026-07-13

状态：`done / local commit pending`

## 1. 结论

V1-3共享编排运行时已经闭环。产品OpenAI Main Agent现在可以在一次教师消息内调用受控只读Agent Tool、消费结构化结果并Replan；业务Tool成功或失败后会先持久化Observation、刷新WorldState，再由Main Agent决定下一步。第二个有副作用业务Tool只形成新的HumanGate待确认动作，不在同轮连锁执行。

deterministic路径仍用于兼容测试和显式降级，但metadata写入`fixed_delivery_plan_fallback`，不得计入自主编排证据。

## 2. 完成内容

- 三个Agent Tool已进入Main Agent受控可执行面：PPT Director、Video Director、Delivery Critic。
- 新增统一Dispatcher，严格区分只读Agent Tool与外层业务Tool。
- 新增OpenAI Responses严格Schema Executor；缺配置或调用失败时fail-closed，无deterministic专业结论fallback。
- Main Agent只读内循环最多3轮，禁止并行与相同Tool+参数原样重复。
- Agent Tool调用信封由服务端绑定教师执行身份、projectId、IntentEpoch、sourceMessage和Artifact摘要。
- Report与AgentObservation写入消息metadata，并在当前IntentEpoch下恢复到下一轮WorldState。
- Queue真实路径把任务身份与项目租约fence传入ConversationTurnService和Agent Tool调用。
- OpenAI模式业务Tool成败后刷新项目、消息、节点、产物与任务，再执行Main Agent Replan。
- Replan提出第二个业务Tool时强制回到HumanGate；同轮副作用执行次数保持1。

## 3. 验证证据

| 门禁 | 结果 |
|---|---|
| V1-3专项 | 15个测试文件，197/197通过 |
| TypeScript | `npx tsc --noEmit --pretty false` exit 0 |
| Node全量 | 259/259通过 |
| Vitest全量 | `npm test` exit 0 |
| 生产构建 | exit 0，生成13个静态页面 |
| SQLite | `.tmp\v1-3-init.db`同库连续初始化2/2 |
| 差异检查 | `git diff --check` exit 0 |

生产构建仍保留3条基线已有的动态文件模式过宽警告，本阶段未引入新的构建错误。

## 4. 关键行为证据

- 成功Observation进入第二次Main Agent输入，下一能力由第二次响应决定，不由固定DeliveryPlan决定。
- 失败Observation进入第二次Main Agent输入，模型可以改Tool、改输入、请求教师或暂停。
- 第二次响应即使要求立即执行业务Tool，也只持久化pending HumanGate，不执行第二次副作用。
- Queue测试证明真实教师身份、IntentEpoch和租约fence进入Agent Tool调用边界。
- IntentEpoch变化时Executor不调用、Report不持久化；当前WorldState只接收当前epoch的有效Report。
- deterministic续步metadata明确标记`fixed_delivery_plan_fallback`。

## 5. 未完成边界

- V1-3不等于PPT领域闭环；样张、全量、渲染审查和页级返修在V1-6验收。
- V1-3不等于视频课程锚点闭环；生产前独立Critic和成片后复核在V1-7验收。
- 未调用真实PPT、图片或视频Provider，未生成新真实交付包。
- 自然语言确认、拒绝、暂停、改道、改大纲和局部返修矩阵属于V1-4。
- 四档生成强度、积分提示和升级确认属于V1-5。
- 两用户并发、真实产品内E2E和发布恢复门仍未关闭。

## 6. 下一阶段

进入V1-4 HumanGate与自然语言打断：先冻结确认、拒绝、暂停、取消、改道、修改大纲和局部返修的意图合同与影响分析，再验证旧actionId、旧IntentEpoch和迟到结果不能污染新分支。

保持`v1`、`v1.1.0-alpha`和`v1.1.0-alpha.1`不动；本阶段只做独立本地提交，不push、不部署。
