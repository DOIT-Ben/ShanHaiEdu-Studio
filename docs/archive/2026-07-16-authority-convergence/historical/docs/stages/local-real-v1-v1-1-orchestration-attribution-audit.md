# ShanHaiEdu V1-1 编排归因审计

更新时间：2026-07-13

状态：`complete / implementation gaps identified`

关联计划：`docs\stages\local-real-v1-mainline-adjustment-plan.md`

## 1. 结论

当前真实产品链路不是“Main Agent原生多工具ReAct”，而是：

```text
教师消息
-> 模型Main Agent单次选择首个capability
-> ConversationControlResolver与固定Guard校正
-> ConversationTurnService调用ToolRouter或AgentRuntime
-> 系统生成并持久化Observation
-> 成功时固定DeliveryPlan选择下一步
-> 失败时结束当前请求，等待教师再次发消息后Main Agent才重新观察
```

因此，现有代码证明了模型首步选择、执行安全、工具路由、状态持久化和部分恢复能力，但没有证明Main Agent会在同一受控Harness中持续执行`Observe -> Plan -> Guard -> Act -> Observe -> Replan`。此前真实PPT、视频和最终包不能归因为产品Main Agent自主编排完成。

## 2. 审计基线与方法

- 代码基线：`c85c49f65d0fb6a438c06dba76e5e81ad271dbbc`，annotated tag `v1.1.0-alpha`。
- 工作树：审计开始时只有V1主线、需求与复盘文档改动，没有未提交代码改动。
- 方法：从教师消息Route沿Queue、Main Agent、Control Resolver、ToolRouter、Adapter、Validation、Observation、Artifact和Finish路径逐层只读追踪。
- 本阶段不调用真实媒体Provider，不生成新交付包。
- 新鲜验证：12个相关测试文件、135/135项通过。

## 3. 真实调用链归因

| 环节 | 当前真实主体 | 证据 | 判断 |
|---|---|---|---|
| 教师消息入队 | API Route与Workbench Service | `src\app\api\workbench\projects\[projectId]\messages\route.ts:29-56` | 已实现 |
| 项目任务串行 | Conversation Queue与项目租约 | `src\server\conversation\conversation-turn-queue.ts:41` | 已实现 |
| WorldState编译 | 固定系统代码 | `conversation-turn-service.ts:148-178` | 已实现 |
| 首个能力选择 | 模型Main Agent输出结构化`toolPlan` | `model-main-conversation-agent.ts:68-75,172-229` | 已实现；不是function call |
| 控制、改道和政策归一 | ConversationControlResolver | `conversation-turn-service.ts:187-225`、`conversation-control-resolver.ts:153-177` | 已实现；规则层可覆盖模型 |
| Guard | CapabilityAvailability、PlanGuard、HumanGate、ReAct Guard | `conversation-turn-service.ts:327-533` | 已实现但分散在调用层 |
| Act | ConversationTurnService调用ToolRouter或AgentRuntime | `conversation-turn-service.ts:535-545,669-792` | 已实现 |
| Observation | Adapter与系统代码构造并写入消息metadata | `conversation-turn-service.ts:547-594,802-838` | 已实现 |
| 同轮Replan | 无 | 失败后直接返回；成功后不再次调用Main Agent | 缺失 |
| 完整链下一步 | 固定DeliveryPlan与`advanceDeliveryPlan()` | `model-main-conversation-agent.ts:32-52`、`conversation-turn-service.ts:1017-1055` | 固定线性续步，不是Agent决策 |
| Finish证据门 | 独立AgentRun API与Repository | `agent-runs\[runId]\finish\route.ts`、`react-control.ts:137-170` | 结构存在；未接主对话链 |

## 4. 交付节点决策归因矩阵

| 节点 | 当前决策/执行主体 | 目标主体 | 状态与差距 |
|---|---|---|---|
| 需求与教案 | Main Agent选能力；AgentRuntime生成；教师批准 | Main Agent +普通Tool | 基础可复用；完整链仍固定续步 |
| PPT大纲与逐页设计 | AgentRuntime生成；Validator验结构 | `ppt_director.plan_or_repair` + Validator | 专业Director未注册；无语义Critic闭环 |
| 样张页计划 | `ppt_design`模型写入`samplePlan` | PPT Director基于风险和页型决策 | Main Agent不复核覆盖合理性 |
| 样张资产与组装 | Provider/Package Tool | 普通Tool | 生产能力已接；等待专业审查 |
| 样张批准 | 教师Review Panel | 真实教师HumanGate | 已实现；不得由外部Codex模拟 |
| 全量资产与PPTX | 固定链在样张后推进 | Main Agent依据WorldState重新计划 | 固定推进；无Agent重估 |
| PPT页级返修 | 教师文本页码正则 + Package Tool | Critic定位pageId，Main Agent决定repair scope | 底层返修存在；不消费QualityDecision repairTargets |
| 视频知识/课程锚点 | AgentRuntime自由文本 | `video_director.plan_or_repair`生成结构化VideoIntent | 合同类型存在，运行时未接 |
| Concept Selection | 无独立选择记录 | Video Director + HumanGate | 缺失；候选主题可直接进入脚本 |
| 独立短片三问 | 仅架构Prompt文档 | Video Critic Agent Tool硬门 | 生产运行时缺失 |
| 视频脚本与分镜 | AgentRuntime Markdown | Video Director生成Beat/ShotSpec | 结构化StoryboardManifest未进入主链 |
| 视频资产 | Provider Tool | Main Agent按Director计划调用普通Tool | 生产能力存在；创意门未前置 |
| 逐镜头生成 | 当前一次`video_segment_generate`调用 | 按shotId独立Job与恢复 | Shot Job Planner存在但主链未调用 |
| 镜头级返修 | Repository/测试底座 | Critic定位shotId，Main Agent定点返修 | 运行时Tool与编排未接 |
| 视频拼接 | Package Adapter | 真实媒体时间线/FFmpeg Tool | 当前路径不能作为完整媒体合成最终证据 |
| CriticReport | 质量库和测试夹具 | `delivery_critic.review` | 生产无生成调用点 |
| QualityDecision | 确定性Engine和持久化库 | 系统强制聚合 | 生产主链无调用点 |
| 最终包 | 固定链调用旧Package Adapter | FinalDeliveryGate +版本化最终包 | 新版一致性实现未接主链 |

## 5. P0差距

### P0-1 固定步骤表仍是完整交付的主要编排者

`fullDeliveryStepIds`硬编码完整链；成功后`advanceDeliveryPlan()`直接寻找下一个未完成步骤并构造`toolPlan`。Main Agent只决定起点，没有逐节点观察后重估、跳过、并行、返修或停止。

### P0-2 三个专业Agent Tool仅存在于设计文档

当前ToolRegistry没有：

- `ppt_director.plan_or_repair`
- `video_director.plan_or_repair`
- `delivery_critic.review`

Main Agent因此无法调用领域Director或Critic。当前Native Tool Loop属于产物AgentRuntime：任务已选定后只暴露一个预绑定内部Tool，并非Main Agent多工具ReAct。

### P0-3 Observation没有形成同轮Replan

失败Observation会持久化，但当前函数立即返回；只有教师再次发消息时Main Agent才读取新的WorldState。成功时则由固定计划自动选择下一步。当前`ReAct Guard`主要防止重复失败和非法finish，不负责重新调用Main Agent。

### P0-4 Critic与QualityDecision是运行时孤岛

`createCriticReport()`、`decideQuality()`和质量报告Repository已经存在且有测试，但生产主链没有调用`persistQualityReview()`。主对话工具成功后保存`needs_review`产物即可继续，不要求专业CriticReport与QualityDecision。

### P0-5 视频课程锚点与独立创意门未接运行时

`VideoIntent`、`ShotSpec`、`StoryboardManifest`只验证字段完整、镜头ID、时长、参考资产等结构；没有验证“独立短片三问”或阻止课堂/儿童角色强绑定。当前deterministic视频草稿还明确写入学生角色、课堂黑板、小学生和教室场景，属于已确认负例倾向；生产视频节点不得依靠该fallback推进下游。

### P0-6 逐镜头与版本一致最终包未接主链

Video Shot Job Planner、镜头持久化和版本化最终包已有底座，但Conversation主链仍以单次视频能力和旧Package Adapter为主。当前证据不能证明逐镜头自主返修或FinalDeliveryGate闭环。

## 6. P1差距与边界风险

| 项目 | 已有能力 | 待调整 |
|---|---|---|
| ToolRouter安全 | 已知Tool、前后Validator、Provider真值校验 | Router自身不携带actor/action/IntentEpoch完整门禁上下文，安全依赖调用方；V1-2需形成统一入口 |
| HumanGate | actionId等值核对、Route与Conversation门禁 | actionId缺actor、IntentEpoch、有效期、action digest和nonce绑定 |
| Tool Schema | 严格Schema与敏感工程词过滤 | Native loop存在另一套转换；需统一白名单Schema源 |
| 原子提升 | 核心GenerationJob支持幂等、恢复、fence和staging | 覆盖能力不完整；PPT批量资产和Package等仍有直接保存路径 |
| deterministic fallback | draft具有`deterministic_draft`标记 | 模型失败后可返回draft并把DeliveryPlan步骤标成succeeded；生产链需禁止其推进交付资格 |
| 重试预算 | 重复失败可形成checkpoint | 主路径预算上限使用极大值，尚未接四档强度与升级建议政策 |
| PPT审查 | 教师样张/全量Review Panel已存在 | `reviewSource`不能代替真实Critic运行身份，页级修复不消费结构化质量定位 |
| 视频合成 | 有片段收集和基础MP4检查 | 当前实现不能替代真实FFmpeg时间线与合成验证 |

## 7. 已确认可复用能力

- ContextPackage、AgentWorldState、CapabilityAvailability。
- Conversation Queue、ProjectExecutionLease、IntentEpoch、inputHash、幂等、Provider task恢复和fencing。
- ToolRegistry、ToolRouter、Provider/Package Adapter和严格Schema基础。
- Pre/Post Validator、ValidationReport、ToolObservation和AgentObservation。
- CriticReport、Rubric、QualityDecision数据结构与持久化Repository。
- PPT样张、全量资产、PPTX组装、渲染、教师Review和页级返修底座。
- VideoIntent/ShotSpec/StoryboardManifest、Shot Job Planner、镜头持久化和参考资产上传底座。
- 版本化最终包与ClassroomRunSpec实现。

这些能力是V1-2之后的基础，不应重写；缺口主要是注册、统一门禁、运行时串联与决策归属。

## 8. V1-2最小改动范围

1. 为高层业务Tool和三个Agent Tool建立单一白名单Registry、严格输入输出Schema、权限和副作用声明。
2. Agent Tool使用独立`agent` adapter/executor；只返回结构化规划或CriticReport，不走“Tool成功即保存教师产品Artifact”的默认路径。
3. Main Agent只看到高层业务Tool和Agent Tool；Provider URL、密钥、数据库写入、Artifact提升和绕过Validator能力保持不可见。
4. 将actor、project、IntentEpoch、action digest、HumanGate和预算上下文纳入统一Tool调用信封；ToolRouter强制校验，Route门禁保留为纵深防御。
5. 首批Video Critic合同加入独立短片三问和最小课程锚点硬门；任一失败必须在真实视频Provider前阻塞。
6. 统一OpenAI Tool Schema来源；未知、未实现、非白名单和越权Tool稳定返回类型化Observation。
7. V1-2只建立可执行Tool边界；Main Agent同轮循环、固定链降级和finish接回主链在V1-3完成。

## 9. 测试入口

- Main Agent：`tests\model-main-conversation-agent.test.ts`、`tests\main-conversation-agent.test.ts`。
- 编排：`tests\conversation-turn-service.test.ts`、`tests\agent-world-state.test.ts`、`tests\react-observation-replan.test.ts`。
- Tool与门禁：`tests\tool-registry.test.ts`、`tests\tool-router.test.ts`、`tests\human-gate.test.ts`、`tests\plan-guard.test.ts`。
- 质量：`tests\quality-decision-engine.test.ts`、`tests\quality-report-persistence.test.ts`。
- PPT：`tests\ppt-sample-approval-persistence.test.ts`、`tests\ppt-full-deck-review-persistence.test.ts`、`tests\ppt-full-deck-page-repair.test.ts`。
- 视频：`tests\video-production-contract.test.ts`、`tests\video-shot-persistence.test.ts`。
- 最终包：`tests\versioned-final-package.test.ts`、`tests\package-tool-adapter.test.ts`。

本审计只证明当前代码归因和V1-2边界，不证明任何缺失能力已经实现。
