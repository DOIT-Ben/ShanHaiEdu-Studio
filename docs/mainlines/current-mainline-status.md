# ShanHaiEdu 当前主线状态

更新时间：2026-07-20

## 当前结论

- 重构启动基线：`95b9b29d22553474ffe0c937d035bbe55924b157`；阶段C活动基线：`20c6e2530b991db77108c7b7a61090e9060b7fca`，即阶段B已验收提交。
- 唯一活动阶段：`product-first-deep-refactor`。
- 阶段进度：阶段A、阶段B、阶段C以及阶段D的D1、D2、D3、D4、D5、D6、D7、D8、D9、D10、D11、D12和D13切片已完成离线行为回归；D7完成TaskAggregate与external-audit ingress职责治理，另完成了风险优先的Agent Tool授权职责、Provider结果合同和Provider视频镜头请求拆分；D8完成Skill runtime执行、结果校验和辅助合同职责拆分；D9完成Agent策略、Provider结果和Package三族职责拆分；D10完成Runtime请求/响应/schema/错误结果与ReAct合同/回合辅助职责拆分；D11完成Feedback service reconciliation职责拆分，并明确repository、controller和dialog稳定内聚保留；D12完成真实前端controller/composer职责治理，并明确MediaWorkbench与ProjectListItem继续保留；D13完成视频route HTTP边界与执行协调最小拆分以及单镜头血缘修复。
- 当前口径：**CONTRACT PARTIAL / EXECUTOR PARTIAL / MODEL ORCHESTRATION PARTIAL / PRODUCT E2E PARTIAL / RELEASE NOT STARTED**。
- 本轮未调用真实Provider，未创建V1-9 runId，未生成或测试图片、视频、PPTX、ZIP，未运行390px真实黑盒，未部署或发布。

## 已实现

- assistant-ui是唯一生产对话入口；Main Agent structured intake和native function-call/ReAct是唯一业务Tool控制循环。
- TaskBrief、IntentGrant、IntentEpoch、ExecutionEnvelope、ToolInvocation、ValidationReport、Observation、Artifact、PendingDecision和事件具有持久化合同。
- Tool结果使用服务端冻结的`resultMode`和唯一终态矩阵；Invocation、Observation、Event、Artifact及GenerationJob replay必须相互一致。
- authority summary独立重算身份、顺序、结果绑定和历史IntentEpoch违规；失败ValidationReport绑定当前Invocation、runtime contract、capability、IntentEpoch和inputHash。
- `WorkflowNode`、外层`toolPlan`/`deliveryPlan`、旧planner/orchestrator/control resolver和生产deterministic runtime已退出`src`。
- 固定节点、AgentRun和approved-input写路由已删除；新库不再创建旧控制面表，当前写操作registry从18条收缩为15条。
- HumanGate由`PendingDecision + TaskAggregate + SemanticSnapshot + ReAct checkpoint`承载；错误actionId保持暂停且零Tool，取消和编辑改道不会混同为确认。
- PendingDecision确认现在把TaskAggregate、授权元数据、所有匹配消息、决策事件和SemanticSnapshot纳入同一事务；Snapshot末端失败不再暴露部分确认，同一action同payload幂等重放，冲突终态失败关闭。
- `createConversationTurnService`保持唯一公开工厂，115行门面只负责接收新消息或队列消息；任务intake、控制回合、进度投影、执行协调、上下文构建和结果提交已按职责拆分，原返回类型与`capabilityTeacherLabel`导入路径不变。
- `createMainAgentToolLoopOptions`保持唯一公开工厂，97行门面只组合Tool资格、检查点回调和唯一dispatch；输入投影、DialogueCheckpoint、HumanGate、Skill/Provider准备、结果提交与Observation已拆到内部职责模块，重试和停止仍只由controlled ReAct loop决定。
- `createPrismaWorkbenchRepository`保持唯一公开工厂，29行门面组合项目、消息、Artifact、GenerationJob、ConversationTurn、VideoShot和执行Guard职责；所有内部模块低于500行且函数低于150行。
- ConversationTurn同键不同payload现在失败关闭，receipt同时复核当前持久事实；claim使用条件更新，两个独立PrismaClient只能产生一个执行者，SQLite争用不再直接冒泡为timeout。
- GenerationJob只有`running/submitting`且无Provider task时可进入`submission_unknown`；终态、queued和failed不能被陈旧worker降级。无生产消费者的staged promotion出口及自动stage写入已删除，真实Tool结果仍只由control-plane原子提交。
- VideoShot完整计划会原子移除当前source下淘汰镜头；片段选择必须绑定唯一succeeded GenerationJob、RunInputSnapshot、source、shot、可信tool_result和Artifact证据。
- Artifact“调整后重做”只构造带真实Artifact ID的标准教师消息并进入Main Agent队列；提交时不直接创建Artifact、不提升IntentEpoch、不绕过TaskBrief、Tool或Observation，也不清空教师尚未发送的composer草稿或误携带待确认HumanGate。
- 前端生产数据源只剩真实API client；development adapter、环境选择器和四份mock seed已删除，`NEXT_PUBLIC_WORKBENCH_DATA_SOURCE`不能再启用mock。
- 前端不再从固定节点推导步骤；有真实Artifact时显示其类型，无Artifact时显示项目状态。
- Stage41 local substitute、专属runner、Playwright假文件交付和package alias已删除；无生产消费者的runtime A/B、`orchestrator-runtime`及专属测试已删除，`@openai/agents`不再是项目依赖。
- `StagedArtifactCommit`已退出Prisma模型、新库初始化、健康检查和Provider验真合同。初始化脚本不执行DROP；旧SQLite中的遗留表、字段和数据继续保留并被新代码忽略。
- 仍宣称`OrchestratorRuntime`和双runtime边界的2026-07-14 ADR已按原字节归档，当前活动架构只保留Main Agent唯一编排口径。
- ESLint为`0 error / 0 warning`硬门；生产构建无动态追踪warning，standalone敏感文件检查`forbidden=[]`。

## 当前问题

- 复杂度baseline当前有11个登记项；按风险治理ADR分为应拆、修改时再评估和可保留三类，不能把11项等同为11个必须拆的屎山，也不再以机械清空baseline作为唯一目标。D13已把视频route从baseline移出，并将执行协调与单镜头输入校验迁入同资源helper。
- 当前源码合同门报告13个文件；Ops smoke已改为结构化配置或可注入行为测试，但wrapper读取、import alias、解构、参数默认值、闭包和完整控制流传播尚未纳入，当前数字不能表述为全部债务或清零。
- 当前Provider连续性receipt不存在；一次历史Main Agent续轮502仍使连续多轮稳定性保持未关闭。
- D13暴露的产品边界风险仍在：只有服务端提供明确`shotId`的video Artifact action才可展示；当前旧artifact action没有镜头选择，不会再展示直发按钮，产品级多镜头选择与真实视频链路仍未验。

## 尚未实现

- 真实Provider连续3组、唯一V1-9真实全链路、教师签收、部署与release。
- SQLite横向扩容；当前只适合本地或单实例。
- 完整且自洽的“五以内数的认识”交付样本；缺失文件不能补写成已完成事实。

## 已废弃

- 固定宏阶段推进、外层计划执行下一Tool、生产deterministic draft/fallback。
- Stage41 substitute交付、runtime A/B、独立`OrchestratorRuntime`和OpenAI Agents SDK第二runtime方案。
- 用复杂度baseline、warning预算或源码字符串baseline长期容纳历史债务。
- 用CI、Gate、manifest或文档齐全替代教师可用性和真实产品链路。

## 新鲜验证

- 阶段B clean HEAD的`verify:local`、SHA manifest和`desktop:smoke`通过并绑定`20c6e2530b991db77108c7b7a61090e9060b7fca`；当时Node测试`427/427`、Vitest`793/793 + 775/775`。
- 阶段B生产旧控制面符号扫描为0；当时复杂度门和源码合同门通过，但仍分别有29与21个登记债务。
- C1全量回归：Node测试`427/427`，Vitest隔离分片`793/793`与`777/777`；TypeScript、ESLint `0 warning`、生产构建、standalone检查和development gate通过。Provider为离线延期且`passed=false`，请求数为0。
- C2全量回归：Node测试`427/427`，Vitest隔离分片`793/793`与`777/777`；TypeScript、ESLint `0 warning`、生产构建、standalone检查和development gate通过。复杂度债务降至28，Provider仍为离线延期且`passed=false`，请求数为0。
- C3全量回归：Node测试`427/427`，Vitest隔离分片`793/793`与`778/778`；TypeScript、ESLint `0 warning`、生产构建、standalone检查和development gate通过。`main-agent-tool-loop-config.ts`降至97行，新模块均低于复杂度阈值，V1-9 repair evidence绑定全部拆分模块，债务降至27；Provider为离线延期、`passed=false`且请求数为0，连续性仍未验证。
- D1全量回归：Node测试`427/427`，Vitest隔离分片`801/801`与`773/773`；TypeScript、ESLint `0 warning`、生产构建和development gate通过。repository由2058行降至29行并退出复杂度基线，复杂度债务降至26；D1未调用Provider。
- D2全量回归：Node测试`424/424`，Vitest隔离分片`782/782`与`786/786`；标准重做消息、真实Artifact引用、交错失败幂等重试、Artifact版本/批准指针、零直接Artifact写入、零IntentEpoch绕行和15条写入口合同通过。`workbench-api.ts`降至233行并退出复杂度基线，债务降至25；未运行PPT浏览器验收，未调用Provider。
- D3全量回归：数据库退役红测先以`2`项失败证明新库仍创建staging结构且旧表会触发初始化失败，修复后定向`92/92`、Node`423/423`、Vitest隔离分片`778/778`与`773/773`通过；TypeScript、ESLint `0 warning`、生产构建、standalone `forbidden=[]`和development gate通过。复杂度债务保持25，源码合同门收缩为20文件/293次；Provider保持离线延期、`passed=false`且请求数为0。
- D4全量回归：source-contract detector新增作用域、属性名、TypeScript wrapper、`var`作用域和模板路径回归，原有6项加新增8项、共`14/14`通过；开发门禁测试`119/119`，另有1项Windows符号链接能力跳过。`npm test`通过Node`423/423`和Vitest`778/778 + 773/773`；TypeScript、ESLint `0 warning`、生产构建、standalone `forbidden=[]`、development gate和工作树绑定`verify:local`通过。门禁报告由20文件/293次校准为19文件/219次；Provider保持离线延期、`passed=false`且请求数为0，wrapper与完整控制流漏报仍明确保留，未上推为源码合同清零。
- D5全量回归：complexity baseline先移除`service.ts`并按预期报`New complexity debt`；拆分后`service.ts`由667降至58行，项目、消息、Artifact、Generation、VideoShot、TurnJob、snapshot、共享授权与映射进入9个48至179行的内部模块，47个公开方法和原四参数工厂不变。V1-9 contract repair SHA闭包已覆盖门面、9个模块和门面合同测试；门面测试进一步冻结服务端执行身份覆盖、guard写入、读授权以及finish/fail原guard透传。`src/server/workbench/*.ts`已进入Provider敏感生产路径和离线阶段精确白名单，嵌套`__tests__`不匹配；开发态仍只允许延期，release不接受延期。最终全量回归通过Node`423/423`与Vitest`776/776 + 781/781`；TypeScript、ESLint `0 warning`、生产构建、standalone `forbidden=[]`和development gate通过。复杂度债务降至24；Provider保持离线延期、`passed=false`且请求数为0。

## D6新鲜验证

- `MessagePart`与`TeacherAgentEvent`已拆为独立合同、投影、时间线和消息合并模块，旧导出门面保持兼容。
- 定向合同`41/41`、Node`423/423`、Vitest隔离分片`776/776 + 791/791`、TypeScript、ESLint `0 warning`、生产构建`forbidden=[]`和development gate通过；复杂度债务降至22。
- Provider仍为离线延期、`passed=false`且请求数为0；源码合同wrapper漏报、真实Provider和产品E2E仍未关闭。

## D7新鲜验证

- `control-plane-store.ts`的TaskAggregate职责继续保持独立模块；风险优先切片还将Agent Tool授权、Provider结果合同和视频镜头请求解析拆到独立模块，公开入口和Provider提交/轮询/响应语义保持不变。
- Provider适配器门面按复杂度检测器由955行收缩到900行；V1-9 repair evidence闭包新增两个Provider子模块，防止门面哈希遗漏拆分后的实际职责。
- 独立SQLite、单worker定向回归`46/46`；TypeScript、ESLint `0 warning`、生产构建standalone `missing=[] / forbidden=[]`和development gate通过。复杂度债务保持22项，Provider仍为离线延期、`passed=false`且请求数为0。
- external-audit ingress保留唯一入口，事务提交/恢复协调迁入独立模块；定向回归和V1-9 evidence closure为`31/31`，复杂度债务由22降至21。全量Node/Vitest、TypeScript、Lint、生产构建和development gate均通过。
- 本轮未调用真实Provider、未生成媒体、未创建V1-9 runId、未部署或发布。

## D8新鲜验证

- Skill runtime公开门面、配置运行时和预检入口保持兼容；执行、正式结果校验和辅助合同比较迁入独立模块。稳定的`skill-registry.ts`、`business-tool-skill-bindings.ts`和`business-tool-skill-output-contract.ts`按ADR保留，不因行数阈值机械拆分。
- Skill定向回归`32/32`；V1-9 repair evidence闭包绑定4个Skill生产模块和3个Skill行为测试。全量Node/Vitest、TypeScript、ESLint、生产构建和development gate均通过。
- `npm run build`的standalone检查为`missing=[] / forbidden=[]`；development gate为`passed-with-offline-refactor-defer`，复杂度债务降至20，Provider仍为`passed=false`且请求数为0。
- 本轮未调用真实Provider、未创建V1-9 runId、未生成媒体、未部署或发布。

## D9新鲜验证

- Agent Tool、Provider和Package门面已按真实职责拆分；`tool-router.ts`作为唯一前置校验、适配器分发和后置校验边界保留。
- V1-9 repair evidence闭包新增模块与行为测试，定向证据`9/9`；全量Node/Vitest、TypeScript、ESLint、生产构建和development gate均通过。
- `npm run build` standalone检查为`missing=[] / forbidden=[]`；复杂度债务由20降至17，Provider仍为`passed=false`且请求数为0。
- 本轮未调用真实Provider、未创建V1-9 runId、未生成媒体、未部署或发布。

## D10新鲜验证

- `openai-runtime.ts`保留Runtime门面和native Tool loop边界；请求构造、输出解析、JSON schema、错误分类和结果映射已进入独立模块，`OpenAIRuntime`与`buildOpenAIResponseRequest`原导出路径保持兼容。
- `main-agent-controlled-react-loop.ts`保留唯一ReAct状态机入口；类型合同、checkpoint/telemetry/通知/恢复辅助、完成合同修复和Tool回合处理已进入独立模块，恢复、重试、预算、HumanGate和停止语义保持不变。
- Runtime、Runtime质量与ReAct行为定向回归`55/55`；V1-9 repair evidence closure定向回归`10/10`；TypeScript和定向ESLint `0 error / 0 warning`通过。
- 复杂度目标先移出baseline验证`New complexity debt`红灯，拆分后复杂度债务由17降至15；新增模块均低于500行且无函数超过150行。
- 本轮未调用真实Provider、未创建V1-9 runId、未生成媒体、未部署或发布。独立运行`main-agent-tool-loop-config.test.ts`会因缺失`OrchestrationAuditEvent`测试表失败，需用`npm test`隔离数据库回归，不把该环境失败上推为D10代码回归。

## D11新鲜验证

- `feedback/service.ts`保留公开工厂、提交、管理查询和附件下载；后台reconciliation进入`service-reconciliation.ts`，终态提交共用合同进入`service-shared.ts`。
- `feedback/repository.ts`、`useFeedbackController.ts`和`FeedbackDialog.tsx`经评估继续保留：分别是单一Feedback持久化边界、单一幂等客户端状态机和单一反馈Dialog，不存在重复控制权或不清晰变更边界。
- Feedback服务/存储/契约定向回归`62/62`；M67/M72/M78 UI与源码合同定向回归`16/16`；复杂度债务由15降至14。
- `npm run build`通过，standalone检查为`missing=[] / forbidden=[]`；全量ESLint为`0 error / 0 warning`，development gate为`passed-with-offline-refactor-defer`。
- 本轮未调用真实Provider、未创建V1-9 runId、未生成媒体、未部署或发布。

## D12新鲜验证

- `useWorkbenchController.ts`保留唯一公开组合入口；项目状态/快照同步、项目动作、composer提交/恢复、产物导航和产物操作迁入独立职责模块。`PromptComposer.tsx`保留唯一输入面，附件读取生命周期迁入`useComposerAttachments.ts`。
- `MediaWorkbench.tsx`继续作为工作台布局组合保留；`ProjectListItem.tsx`继续作为单行项目编辑状态机保留。两者没有重复控制权或跨域变更边界证据。
- D12源码合同定向Node回归`34/34`；全量Node`423/423`、Vitest隔离分片`776/776 + 796/796`，TypeScript、ESLint `0 error / 0 warning`、生产构建和development gate通过；standalone为`missing=[] / forbidden=[]`，复杂度债务由14降至12。
- 本轮未调用真实Provider、未创建V1-9 runId、未生成媒体、未部署或发布。

## 当前验收边界

| 层级 | 状态 | 本轮允许证明 | 本轮不能证明 |
|---|---|---|---|
| contract | partial | 旧控制面已删除，行为与数据合同未回退 | 真实Provider稳定 |
| executor | partial | 原子Tool提交、PendingDecision跨写入原子性、权限、队列和恢复边界 | 真实媒体与整包执行 |
| model orchestration | partial | 既有局部文本链路 | 连续多轮和任意任务稳定 |
| product E2E | partial | 仓内合同、构建和桌面壳smoke | V1-9、真实浏览器教师流程与教师签收 |
| release | not started | 无 | 部署或发布完成 |

## D13新鲜验证

- route风险复核确认GET下载和POST生成仍属于同一Artifact视频资源；GET/POST均只经过`withLocalWorkbenchActor`，POST只持有一个project execution lease、一个`ExecutionEnvelope`和共享原子commit边界，`submission_unknown`、Provider失败、质量失败及404/409/400语义保持不变。
- 红测证明原route没有把Provider Tool要求的单镜头`shotIds`传入，也没有把镜头绑定到GenerationJob `unitId`；现已由`video-route-generation.ts`承接视频执行协调和输入校验，`route.ts`保留HTTP/认证/下载/lease职责。
- 定向视频/Artifact route回归`27/27`，API client Node合同`18/18`，TypeScript、ESLint `0 error / 0 warning`；complexity由12项单调降至11项。
- Provider保持`passed=false`且请求数为0；未创建V1-9 runId，未生成媒体，未部署、签收或发布。

## 唯一下一动作

D14 Ops源码合同已完成；进入D15 Runner源码合同，先治理M67后治理V1-9的冻结树、child process、shutdown和manifest/state行为。Provider连续性保持0请求，待离线重构完成后按`..\roadmap\release\provider-continuity-readiness-spec.md`重新规划。
