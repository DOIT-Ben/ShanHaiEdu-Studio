# ShanHaiEdu V1 上线前主线微调测试计划

更新时间：2026-07-13

状态：`Accepted / A-01 complete / A-02 production candidate / 119 of 121 focused tests passing`

关联计划：`docs\stages\local-real-v1-mainline-adjustment-plan.md`

## 1. 总门禁

- 自动化只证明覆盖范围；产品内编排必须从真实Main Agent请求、Tool调用、Observation和持久化状态证明。
- 外部Codex选择节点、模拟批准或手工返修的产物不得作为Main Agent能力证据。
- V1-1至V1-8未通过前，不执行新的完整真实Provider交付任务。
- V1-1至V1-8优先使用确定性夹具、受控失败注入和Provider adapter验证编排；不得用频繁生图、视频或整包生成掩盖Agent协调缺陷。
- V1-9真实任务中，外部Codex只能观察和在成包后黑盒验收，不得在运行中选案、改计划、批准锚点、批准样张或决定返修范围。
- 每项证据必须绑定actor、projectId、IntentEpoch、Action/Job/Artifact版本和时间，公开记录保持脱敏。

## 2. 分阶段验收

| 编号 | 场景 | 通过标准 |
|---|---|---|
| A-01 | 编排归因 | `passed`：每个PPT/视频节点已标明真实决策主体；现有固定链和缺失Agent Tool未被记为Main Agent完成 |
| A-02 | Tool注册 | Main Agent可发现且只能调用白名单高层工具；裸Provider/数据库/状态提升不可见 |
| A-03 | Tool合同 | 缺字段、错项目、错版本、错血缘、未批准输入稳定拒绝并产生类型化Observation |
| A-04 | Observation/Replan | Tool失败或质量不通过后，Main Agent改变计划或定点返修；精确重复失败触发预算停止 |
| A-05 | HumanGate | 缺少匹配actionId时高成本或不可逆动作零调用；拒绝、过期和改道后旧action失效 |
| A-06 | 自然语言打断 | 样张阶段修改叙事大纲后只失效受影响下游，保留历史且不提升迟到结果 |
| A-07 | 强度默认 | RQ-027实施后新任务默认“标准”并映射Terra Medium，教师侧不出现模型名 |
| A-08 | 强度升级 | 持续失败只产生一次受控建议；用户确认后下一次调用升级，拒绝后不循环打扰 |
| A-09 | 极致档 | Sol High不能首次自动建议；进入前提示更快积分消耗并要求独立二次确认 |
| A-10 | PPT内部闭环 | Main Agent自主推进到样张并等待教师，批准后全量生产；质量问题只返修目标页 |
| A-11 | 视频创意门 | 产品内`delivery_critic.review`执行六硬门：独立可理解、独立观看价值、非教材/PPT复刻、唯一最小锚点、受众不限制故事世界、不泄露答案；任一失败或inconclusive即停止 |
| A-11a | 课程锚点边界 | 锚点只有一个最小回接；不会因目标受众是小学生而强制儿童主角、教室场景或课堂活动；全程教材化/课堂化稳定阻塞并产生CriticReport |
| A-11b | 锚点自主返修 | Main Agent读取锚点CriticReport后自主Replan、换创意机制或请求HumanGate；外部Codex介入次数为0 |
| A-11c | 独立Critic与不过度约束 | `delivery_critic.review`通过只形成后续Guard的必要语义前置；仍须可信生产Executor绑定、PlanGuard、HumanGate和QualityDecision才允许真实媒体调用。儿童主角或教室场景有独立创意理由时可以通过；受众年龄强绑定或依赖课堂教学任务才能成立的复刻必须阻塞 |
| A-12 | 视频Provider前置 | Concept Selection和HumanGate未通过时，真实视频任务提交次数为0 |
| A-13 | 两用户隔离 | 两账号同时操作不同项目，消息、强度、action、job、artifact和反馈不串线 |
| A-14 | 双任务并发 | 不同项目可以并发；同项目只有一个有效写者；失败恢复不重复付费提交 |
| A-15 | 产品内真实E2E | 从教师UI启动，产品Main Agent完成计划、工具、审查和最终包；若质量不通过则自主定点返修，不为证明返修而故意制造昂贵失败；运行中外部Codex只观察，成包后才黑盒审核 |
| A-15a | 外部验收归因 | 外部验收发现的问题能回溯到Agent计划、Tool合同、Prompt、Critic Rubric、HumanGate或Quality Gate；修复责任层后只做必要的定点复验，不由外部手工补包 |
| A-15b | 课程锚点成包黑盒审核 | 外部验收者在成包后检查：脱离教材仍可理解、去掉唯一回接仍值得看、不是教材/PPT/课堂活动复刻、不因小学生受众强制儿童或教室、全片只有一个最小回接且不泄露答案 |
| A-16 | 发布恢复 | 共享卷重启、release回滚、备份恢复和公开注册关闭复核通过 |

## 3. 两用户最低容量标准

- 两名邀请教师同时保持有效会话。
- 两个不同项目的对话和普通Agent规划可同时执行。
- 两个高成本任务可以同时处于running/queued；受Provider限制时允许排队但不丢失。
- 同一项目仍只允许一个有效写租约。
- 一个用户调整生成强度、取消、修改大纲或确认升级，不影响另一个用户。

## 4. 完成记录

每个阶段closeout记录：提交SHA、测试命令和计数、真实请求/浏览器/状态证据、失败和回退点、仍由外部Codex介入的动作。只要仍有关键编排动作依赖外部Codex，V1-9不得开始。V1-9首次完整真实全链路验收集中执行；若失败，先完成责任归因和定点修复，再决定是否需要局部或整包复验，禁止无归因地反复烧真实Provider。

V1-2已有未提交生产候选；2026-07-13 03:15最新专项测试为119/121，两个红灯均为默认数据库授权未拒绝审批状态自相矛盾的review target。证据充分性、blocking finding优先级、通用Critic领域隔离、签名review target与typed locator绑定、failed/inconclusive报告完整性、损坏JSON和不过度约束正例已经进入通过项；closeout前仍须复核最终diff，并继续证明actor/project/IntentEpoch/Artifact版本、digest与审批状态一致性边界。

V1-2 closeout只允许声明“Agent Tool合同、Router硬门、默认授权边界和注入Executor测试就绪”。生产Critic Executor、Main Agent真实调用、CriticReport持久化及基于Observation的同轮Replan必须在V1-3/V1-7另行取证；这些证据成立前，不得将合同就绪升级为“产品智能体已经自主完成课程锚点审查”。
