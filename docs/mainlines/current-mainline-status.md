# ShanHaiEdu 当前主线状态

更新时间：2026-07-20

## 当前结论

- 重构启动基线：`95b9b29d22553474ffe0c937d035bbe55924b157`；阶段C活动基线：`20c6e2530b991db77108c7b7a61090e9060b7fca`，即阶段B已验收提交。
- 唯一活动阶段：`product-first-deep-refactor`。
- 阶段进度：阶段A、阶段B以及阶段C的C0合同、C1 PendingDecision一致性、C2 turn service拆分、C3 tool loop拆分已完成离线验收；唯一下一阶段是阶段D清零剩余工程债务。
- 当前口径：**CONTRACT PARTIAL / EXECUTOR PARTIAL / MODEL ORCHESTRATION PARTIAL / PRODUCT E2E PARTIAL / RELEASE NOT STARTED**。
- 本轮未调用真实Provider，未创建V1-9 runId，未生成或测试图片、视频、PPTX、ZIP，未运行390px真实黑盒，未部署或发布。

## 已实现

- assistant-ui是唯一生产对话入口；Main Agent structured intake和native function-call/ReAct是唯一业务Tool控制循环。
- TaskBrief、IntentGrant、IntentEpoch、ExecutionEnvelope、ToolInvocation、ValidationReport、Observation、Artifact、PendingDecision和事件具有持久化合同。
- Tool结果使用服务端冻结的`resultMode`和唯一终态矩阵；Invocation、Observation、Event、Artifact及GenerationJob replay必须相互一致。
- authority summary独立重算身份、顺序、结果绑定和历史IntentEpoch违规；失败ValidationReport绑定当前Invocation、runtime contract、capability、IntentEpoch和inputHash。
- `WorkflowNode`、外层`toolPlan`/`deliveryPlan`、旧planner/orchestrator/control resolver和生产deterministic runtime已退出`src`。
- 固定节点、AgentRun和approved-input写路由已删除；新库不再创建旧控制面表，当前写操作registry从18条收缩为16条。
- HumanGate由`PendingDecision + TaskAggregate + SemanticSnapshot + ReAct checkpoint`承载；错误actionId保持暂停且零Tool，取消和编辑改道不会混同为确认。
- PendingDecision确认现在把TaskAggregate、授权元数据、所有匹配消息、决策事件和SemanticSnapshot纳入同一事务；Snapshot末端失败不再暴露部分确认，同一action同payload幂等重放，冲突终态失败关闭。
- `createConversationTurnService`保持唯一公开工厂，115行门面只负责接收新消息或队列消息；任务intake、控制回合、进度投影、执行协调、上下文构建和结果提交已按职责拆分，原返回类型与`capabilityTeacherLabel`导入路径不变。
- `createMainAgentToolLoopOptions`保持唯一公开工厂，97行门面只组合Tool资格、检查点回调和唯一dispatch；输入投影、DialogueCheckpoint、HumanGate、Skill/Provider准备、结果提交与Observation已拆到内部职责模块，重试和停止仍只由controlled ReAct loop决定。
- 前端不再从固定节点推导步骤；有真实Artifact时显示其类型，无Artifact时显示项目状态。
- ESLint为`0 error / 0 warning`硬门；生产构建无动态追踪warning，standalone敏感文件检查`forbidden=[]`。

## 当前问题

- 复杂度债务仍有27个文件，源码字符串合同债务仍有21个文件，尚未达到本活动阶段的清零目标。
- workbench repository为2058行、最大函数1428行，是当前风险最高的巨型模块；其余登记债务必须按阶段D唯一顺序继续偿还。
- 当前Provider连续性receipt不存在；一次历史Main Agent续轮502仍使连续多轮稳定性保持未关闭。

## 尚未实现

- 真实Provider连续3组、唯一V1-9真实全链路、教师签收、部署与release。
- SQLite横向扩容；当前只适合本地或单实例。
- 完整且自洽的“五以内数的认识”交付样本；缺失文件不能补写成已完成事实。

## 已废弃

- 固定宏阶段推进、外层计划执行下一Tool、生产deterministic draft/fallback。
- 用复杂度baseline、warning预算或源码字符串baseline长期容纳历史债务。
- 用CI、Gate、manifest或文档齐全替代教师可用性和真实产品链路。

## 新鲜验证

- 阶段B clean HEAD的`verify:local`、SHA manifest和`desktop:smoke`通过并绑定`20c6e2530b991db77108c7b7a61090e9060b7fca`；当时Node测试`427/427`、Vitest`793/793 + 775/775`。
- 阶段B生产旧控制面符号扫描为0；当时复杂度门和源码合同门通过，但仍分别有29与21个登记债务。
- C1全量回归：Node测试`427/427`，Vitest隔离分片`793/793`与`777/777`；TypeScript、ESLint `0 warning`、生产构建、standalone检查和development gate通过。Provider为离线延期且`passed=false`，请求数为0。
- C2全量回归：Node测试`427/427`，Vitest隔离分片`793/793`与`777/777`；TypeScript、ESLint `0 warning`、生产构建、standalone检查和development gate通过。复杂度债务降至28，Provider仍为离线延期且`passed=false`，请求数为0。
- C3全量回归：Node测试`427/427`，Vitest隔离分片`793/793`与`778/778`；TypeScript、ESLint `0 warning`、生产构建、standalone检查和development gate通过。`main-agent-tool-loop-config.ts`降至97行，新模块均低于复杂度阈值，V1-9 repair evidence绑定全部拆分模块，债务降至27；Provider为离线延期、`passed=false`且请求数为0，连续性仍未验证。

## 当前验收边界

| 层级 | 状态 | 本轮允许证明 | 本轮不能证明 |
|---|---|---|---|
| contract | partial | 旧控制面已删除，行为与数据合同未回退 | 真实Provider稳定 |
| executor | partial | 原子Tool提交、PendingDecision跨写入原子性、权限、队列和恢复边界 | 真实媒体与整包执行 |
| model orchestration | partial | 既有局部文本链路 | 连续多轮和任意任务稳定 |
| product E2E | partial | 仓内合同、构建和桌面壳smoke | V1-9、真实浏览器教师流程与教师签收 |
| release | not started | 无 | 部署或发布完成 |

## 唯一下一动作

进入阶段D，唯一首切片是拆分2058行的workbench repository：先冻结现有repository公开接口和事务行为，再按项目、消息、Artifact、GenerationJob、成员与生命周期职责迁移，删除原位置重复实现并退出复杂度baseline。随后按登记顺序清零其余26个复杂度文件与21项源码字符串合同债务；Provider连续性继续保持0请求，待离线重构完成后按`..\roadmap\release\provider-continuity-readiness-spec.md`重新规划。
