# ShanHaiEdu V1-2 Tool与Agent Tool注册计划

更新时间：2026-07-13

状态：`production candidate under review / 119 of 121 focused tests passing`

关联审计：`docs\stages\local-real-v1-v1-1-orchestration-attribution-audit.md`

## 1. 目标

在不改变当前完整交付推进方式的前提下，建立Main Agent下一阶段可使用的单一白名单Tool目录：

- 高层业务Tool负责确定性执行、文件生产和外部调用。
- Agent Tool负责只读专业推理、规划、审查和返修定位。
- Main Agent、Agent Tool、普通Tool、Validator、HumanGate和QualityDecision保持分权。
- Provider URL、密钥、数据库写入、Artifact提升和绕过Validator的能力不进入模型可见目录。

V1-2只完成注册、Schema、可见性、调用信封、Router和类型化结果边界；Main Agent同轮多工具循环、固定DeliveryPlan降级和Observation后Replan属于V1-3。

## 2. 设计原则

### 2.1 不把Agent Tool伪装成普通产物Tool

Agent Tool成功返回`AgentToolResult`：结构化建议、定位、下一Tool意图、停止条件和运行来源。它不直接创建教师产品Artifact、不推进WorkflowNode、不批准产物、不调用Provider。

如需保存Director/Critic报告，由Harness在短租约与`inputHash/IntentEpoch`复核后持久化为内部报告；不得复用ConversationTurnService当前“Tool成功即保存产品Artifact并推进计划”的默认路径。

### 2.2 Canonical ID与模型传输名分离

产品架构继续使用：

- `ppt_director.plan_or_repair`
- `video_director.plan_or_repair`
- `delivery_critic.review`

模型function name使用协议安全的稳定映射，例如`ppt_director_plan_or_repair`。Router只通过Registry映射，不用字符串猜测。

### 2.3 Main Agent只看到高层白名单

首批业务Tool白名单：

- `generate_ppt_sample_assets`
- `assemble_ppt_key_samples`
- `generate_ppt_full_assets`
- `assemble_ppt_full_deck`
- `repair_ppt_full_deck_pages`
- `generate_video_assets`（映射现有`asset_image_generate`）
- `generate_video_shot`（映射现有`generate_video_segment`）
- `assemble_video`（映射现有`concat_only_assemble`）
- `create_final_package`

现有文本能力在V1-3由Director的`nextToolIntents`和Main Agent编排决定是否继续直接暴露；V1-2不扩大Provider级或底层基础设施可见面。

## 3. 首批Agent Tool合同

| Canonical ID | 输入核心 | 输出核心 | 副作用/HumanGate |
|---|---|---|---|
| `ppt_director.plan_or_repair` | goal、stage、brief/evidence/report refs、targetPageIds、profile | decision、plan/repair draft、nextToolIntents、assumptions、stopConditions | `none` / 不需要 |
| `video_director.plan_or_repair` | goal、stage、courseAnchorRef、lessonContextRef、targetShotIds、asset/report refs、能力摘要 | concept/beat/shot/repair draft、独立短片三问、nextToolIntents、stopConditions | `none` / 不需要 |
| `delivery_critic.review` | domain、stage、artifact/report/media evidence refs、rubric和contract版本 | recommendation、scores、findings、typedLocators、responsibleStage、minimalFix、硬门结果 | `none` / 不需要 |

Agent Tool输出不得包含：Provider凭据、底层URL、数据库指令、`final_eligible`写入、教师批准、状态提升或“已生成真实文件”声明。

## 4. 课程锚点硬门

Video Director可以携带候选自评用于规划，但不能授权下游；课程锚点权威结论必须由`delivery_critic.review(domain="video", stage="course_anchor")`的Critic Schema显式携带以下六个硬门和证据说明：

1. 不知道学科、教材和教案的观众仍能理解短片发生了什么。
2. 去掉最后课程回接后，短片仍有目标、阻碍、变化和观看价值。
3. 短片明显不是教材情境复刻或PPT动态版，且不是脱离教师讲解或课堂教学任务便无法成立的活动脚本/录像。
4. 全片只有一个最小课程回接。
5. 目标受众年龄没有被扩张为人物和场景的必需条件。
6. 视频没有提前泄露本课答案或替代教师讲解。

任一为`false`时：

- Agent Tool结果只能是`rework_required`或`blocked`。
- `nextToolIntents`不得包含真实图片、视频、拼接或最终包Tool。
- `responsibleStage`必须回到Concept Selection、Beat或上游创意。
- 目标年龄只能影响可理解性、安全性和节奏；不能把儿童主角、教室、教师或课堂活动变成必需条件。

## 5. Tool调用信封

新增统一`ToolInvocationEnvelope`，至少包含：

```text
invocationId
toolId / transportName
actorId
projectId
intentEpoch
inputHash
sourceMessageId
arguments
approvedArtifactRefs(id/kind/version/digest)
requestedAt
```

高成本或不可逆业务Tool额外要求受控HumanGate引用；只读Agent Tool不得伪造HumanGate。V1-2先让新Main-Agent可见Router强制校验该信封，现有Route调用保留兼容适配层并标记后续迁移，不在同一阶段重写全部旧入口。

## 6. 实施切片

### V1-2A Registry与类型

- 增加Agent Tool定义、Canonical ID/transportName映射、严格输入输出Schema。
- Tool定义增加模型可见性、执行权限和结果语义，不破坏现有Capability Tool一一映射测试。
- 提供`listMainAgentToolDefinitions()`，只返回白名单副本。
- 三个Agent Tool在本阶段标记为`contractReady=true`、`executorReady=false`、`mainAgentExecutable=false`；V1-3接入独立Executor后才能进入生产请求。

### V1-2B Schema与权限验证

- 复用唯一OpenAI Tool Schema转换器，删除Agent Tool侧重复Schema拼装。
- 校验严格Schema、未知字段、敏感工程词、未实现Tool和非白名单Tool。
- 校验Agent Tool为`sideEffect=none`且不能声明产品Artifact输出。

### V1-2C Agent Tool Router

- 新增Agent Tool专用Router/Executor接口。
- V1-2测试使用注入Executor证明真实路由、类型化Observation和无产品Artifact副作用。
- 默认生产Executor未接通时必须显式返回`agent_tool_unavailable`，不得回退deterministic结果冒充专业Agent。

### V1-2D 课程锚点合同验证

- 保留Video Director独立短片三问候选自评，并为`delivery_critic.review`增加六硬门校验器；Critic通过只是后续Guard的必要语义前置，不能独立授权媒体调用。
- 加入“仅因小学受众或课程要求而强绑儿童、教师、教室，或全程依赖课堂教学活动才能成立”、教材动画版、PPT动态版等反例夹具；教室或儿童本身不是失败关键词，有独立叙事理由时必须允许通过。
- 反例在任何真实Provider Tool意图产生前阻塞。

## 7. 文件边界

预计新增或修改：

- `src\server\tools\agent-tool-types.ts`
- `src\server\tools\agent-tool-registry.ts`
- `src\server\tools\main-agent-tool-registry.ts`
- `src\server\tools\agent-tool-router.ts`
- `src\server\tools\openai-tool-schema.ts`
- `src\server\tools\tool-types.ts`（仅必要扩展）
- 对应`tests\agent-tools\*`和Tool Registry测试

不修改：Provider凭据、真实Provider Adapter、PPT/视频生成实现、数据库Schema、前端、固定DeliveryPlan和发布逻辑。

## 8. 风险与回退

| 风险 | 控制 |
|---|---|
| Agent Tool成功被当作产品Artifact | 使用独立结果联合类型与独立Router，测试断言`artifactCreated=false` |
| 模型看到底层Provider能力 | 显式白名单快照测试，禁止按adapterKind自动全量暴露 |
| Canonical ID不符合function name协议 | 通过transportName映射，Registry唯一解析 |
| 课程锚点只做软Prompt | 服务端结构校验器执行Critic六硬门；Director三问只作候选自评 |
| 一次改造全部旧Route导致回归 | 新Main Agent入口先使用调用信封；旧入口保留并记录V1-3/V1-4迁移 |
| 专业Agent不可用时回退弱草稿 | fail-closed，返回类型化Observation，不使用deterministic专业结论 |

回退方式：移除Main Agent可见白名单接线并保留新增Registry/Schema；不需要回退现有ToolRegistry、Provider Adapter或数据库。

## 9. 退出标准

- 三个Agent Tool有稳定Canonical ID、transportName、严格Schema、权限和副作用声明。
- Main Agent白名单只包含批准的高层业务Tool和Agent Tool，不含敏感/底层能力。
- 未知、未实现、非白名单、缺调用信封和越权请求稳定拒绝并产生类型化Observation。
- Agent Tool成功不会创建产品Artifact、推进节点或产生HumanGate批准。
- 四类课程锚点反例及六硬门失败在Provider前稳定阻塞；Director自评不能替代独立Critic，Critic通过后仍须可信生产Executor绑定、PlanGuard、HumanGate和QualityDecision。
- 相关测试、全量Node/Vitest、构建和`git diff --check`通过。

## 10. 2026-07-13实现检查点

Registry、OpenAI Schema投影、统一调用信封、独立Router、Main Agent白名单、课程锚点独立Critic候选、结构化返修和默认授权候选已经形成，但V1-2仍未达到退出标准。2026-07-13 03:15当前专项测试为119/121，正式closeout前必须关闭：

1. 默认数据库授权必须拒绝`needs_review + isApproved=true`与`approved + isApproved=false`两类自相矛盾的审查目标状态，且Executor调用次数为0。
2. 复核已经通过专项测试的合同边界：证据/理由充分性、blocking finding优先级、课程锚点领域隔离、签名review target、typed locator及failed/inconclusive完整性；不得通过放宽断言获得绿色。
3. 保留“儿童主角但创意独立”“教室仅在最终回接”“教室服务独立叙事而非教学活动”正例及否定语义，防止规则过度约束模型能力。
4. 注入Executor永远保持`unverified_injected`与`productionEligible=false`；六门通过只满足后续Guard前置，不代表媒体授权或产品运行时闭环。
5. 完成专项测试、全量测试、生产构建、`git diff --check`和V1-2 closeout；closeout后仍保持`executorReady=false`、`mainAgentExecutable=false`，可信Executor、租约下二次复核、调用重放门和Main Agent接线进入V1-3/V1-7。

详细事实与续接入口：`docs\stages\local-real-v1-v1-2-tool-agent-tool-registration-checkpoint.md`。
