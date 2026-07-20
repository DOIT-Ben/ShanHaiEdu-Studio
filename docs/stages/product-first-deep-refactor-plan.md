# 产品优先深度重构计划

更新时间：2026-07-20

## 1. 目标

把当前“旧实现仍在、靠拒绝门防止复活”的状态改成只有一套生产控制面，并治理高风险复杂度、源码合同、Lint和构建追踪债务。复杂度按`docs/architecture/decisions/2026-07-20-adr-risk-based-complexity-governance.md`分级，不要求稳定且内聚的大文件机械拆分。

成功后的代码必须直接服务教师主链路：教师提交需求，Main Agent形成任务边界，自主选择原子Tool，结果原子持久化并投影为文本、Tool、Observation和Artifact；兼容层、Runner、旧计划和deterministic路径均不能再次决定下一步。

## 2. 当前事实

已经实现：

- assistant-ui是生产对话入口。
- TaskBrief、IntentGrant、IntentEpoch、ExecutionEnvelope、ToolInvocation、ValidationReport、Observation、Artifact和事件已经存在。
- native function-call已承担主控制循环；局部真实文本回合曾成功保持单Tool范围。
- SQLite、Provider ledger、验证manifest和release receipt具有基础合同。

阶段启动时确认、现已由阶段A修复的问题：

- Tool终态允许Observation、Event、Invocation和审计结果互相矛盾；权威摘要也未完整重算该关系。
- succeeded被错误等同于必须产生Artifact，合法的Observation-only成功会被误判。
- 部分项目写入口可以绕过统一actor/CSRF/orchestration wrapper，入口门只检查“出现过调用”，不能证明最外层统一包裹。

阶段B已经修复：

- `WorkflowNode`、外层`toolPlan`/`deliveryPlan`、生产deterministic runtime及其fallback已退出生产源码。
- 固定节点、AgentRun和approved-input写路由已删除；新库不再创建旧控制面表，既有库中的旧表不再由生产代码读取。
- HumanGate改为`PendingDecision + TaskAggregate + SemanticSnapshot + ReAct checkpoint`，前端步骤从真实Artifact或项目状态派生。

仍存在的问题：

- 复杂度baseline当前有14个登记项；按风险治理ADR分级，不能把该数字当作必须拆分的文件数量或清零证据。D4后当前源码合同门报告19个文件、219次直接读取命中，检测器只覆盖直接读取，wrapper读取仍未纳入。
- `conversation-turn-service.ts`为115行，`main-agent-tool-loop-config.ts`为97行，workbench repository已由2058行降至29行，workbench service已由667行降至58行；四个公开门面只负责组合内部职责。

尚未实现：

- 真实Provider连续多轮稳定性、唯一V1-9产品全链路、教师签收和release。
- 多实例数据库部署能力；SQLite仍只支持本地或单实例。
- 本轮不补造缺失的PPTX、图片、视频或整包交付样本。

已经废弃：

- 固定宏节点推进、外层计划执行下一Tool、生产deterministic draft/fallback。
- 用baseline登记债务代替偿还债务。
- 用Gate、manifest或文档齐全上推产品完成。

## 3. 唯一修复主线

### 阶段A：合同正确性

状态：**已完成离线合同与执行验收**。不代表真实Provider、model orchestration、product E2E或release通过。

目标：先堵住会产生错误业务事实的出口。

修改范围：

- 统一项目写操作registry、route wrapper和AST门。
- 建立Observation、Event、Invocation、authority audit的唯一终态矩阵。
- 为需要Artifact与Observation-only结果建立显式`resultMode`或等价服务端事实。
- authority summary独立重算身份、顺序、状态和结果绑定。

验收：行为负例覆盖绕行、状态错绑、重复终态、错误Artifact要求和摘要篡改；定向测试、TypeScript和开发门通过。

完成事实：

- 阶段A当时的18个项目写入口统一到registry、外层wrapper和AST门；阶段B删除两条旧AgentRun路由后为16条，D2删除错误regenerate入口后当前为15条。
- `resultMode`由服务端Tool registry冻结并在终态与summary中独立复核。
- terminal replay复核attempted/resolved audit、Observation、Event和Artifact完整矩阵。
- authority summary保留历史IntentEpoch违规，按消息身份处理幂等提交，并明确降级旧v1证据。
- 失败ValidationReport绑定当前Invocation、runtime contract、capability、IntentEpoch和inputHash。
- `in_progress`普通Tool不会再次加载Skill或执行；Provider只有在已持久化同一GenerationJob任务ID且输入、epoch和运行状态一致时恢复轮询。
- 新增生产模块均低于500行；复杂度债务仍为31项，未新增债务，3个既存债务文件的7项复杂度指标已向下收紧。

验收入口：8文件阶段矩阵、TypeScript、零warning Lint、源码合同门、复杂度门、development gate及`git diff --check`均需在阶段A提交候选上通过。

### 阶段B：删除竞争控制面

状态：**已完成离线合同与执行验收**。不代表真实Provider、model orchestration、product E2E或release通过。

目标：生产源码只剩Main Agent原子Tool控制循环。

修改范围：

- 迁移并删除`WorkflowNode`、`toolPlan`、`deliveryPlan`消费者。
- 删除生产deterministic runtime及其fallback出口。
- 保留仍有产品价值的数据投影，但改为从Task/Invocation事实派生，不能执行下一步。
- 删除只证明旧行为的测试；保留并改写为新合同行为测试。

验收：`src`中旧控制面符号和生产deterministic入口为0；没有第二个Tool选择器；全量合同测试通过。

完成事实：

- 删除WorkflowNode、AgentRun、旧planner/orchestrator/control resolver、deterministic runtime及其生产消费者。
- `toolPlan`、`deliveryPlan`、`pendingDeliveryPlan`和旧控制面开关不再由生产代码读写；活动E2E证据改读直接`PendingDecision`。
- 错误HumanGate actionId保持任务暂停且零Tool；确认、取消和编辑改道分别处理，只有取消或改道提升IntentEpoch。
- 项目列表和快照不再依赖固定节点，当前步骤由最新真实Artifact或项目状态派生。
- 生产旧控制面符号扫描为0；复杂度债务由31降至29，源码字符串合同债务由22降至21。
- 标准全量测试、TypeScript、零warning Lint、生产构建、development gate、SHA manifest和desktop smoke均在阶段B候选工作树通过；Provider保持0请求和`passed=false`。

### 阶段C：拆分两个核心巨型模块

状态：**已完成离线合同与执行验收**。C0阶段合同、C1 PendingDecision一致性、C2 turn service拆分与C3 tool loop拆分均已完成；不代表真实Provider、model orchestration、product E2E或release通过。

目标：让turn协调和Tool执行各自只做一件事。

固定基线：阶段B验收提交`20c6e2530b991db77108c7b7a61090e9060b7fca`。Stage C不得修改Provider请求构造、模型选择、网络提交与重试、响应晋升、receipt可信根或release条件。

执行顺序只有一条：

1. **C0 阶段合同（已完成）**：推进`active-stage.json`、离线Provider延期精确绑定和门禁测试到固定基线；已独立提交，未修改生产业务代码。
2. **C1 PendingDecision一致性（已完成）**：失败注入证明旧实现会先暴露`confirmed`消息；现已把TaskAggregate、授权元数据、匹配消息、决策事件和SemanticSnapshot纳入同一Prisma事务。同一`actionId`同payload重放复用原事件，冲突终态失败关闭。
3. **C2 turn service拆分（已完成）**：保持`createConversationTurnService`、`MessageTurnResponse`和`capabilityTeacherLabel`原导入路径不变；任务intake、控制回合、进度投影、协调、上下文、结果提交和共享类型分别进入职责模块。公开门面降到115行，新职责模块最大363行且单函数均低于150行。
4. **C3 tool loop拆分（已完成）**：保持`createMainAgentToolLoopOptions`公开入口不变；Tool资格、教师可见描述、输入投影、checkpoint、DialogueCheckpoint、HumanGate、Invocation/Skill/Provider准备、业务与Agent结果、Observation和PPT批次生命周期分别迁到职责模块。公开门面降到97行。

每个切片都必须先保留外部行为测试，再迁移实现，最后删除原位置的竞争实现。新增职责模块不得制造新的超限项；既有文件超过500行或函数超过150行时先按ADR评估是否存在职责混杂，再决定拆分或登记保留理由。不得通过转发层套转发层、提高阈值、扩大排除目录或源码字符串测试制造通过。

验收：PendingDecision不存在部分确认；两个公开工厂签名和Provider语义不变；讨论零Tool、单Tool范围、HumanGate确认/取消/改道、迟到结果隔离、Invocation/Observation/Event/Artifact终态矩阵和恢复行为均通过；Stage C结束时两个目标文件均不超过500行。

C1完成后，`control-plane-store.ts`由758降至639行、最大函数由406降至351行；`conversation-turn-service.ts`由1415降至1321行、最大函数由491降至424行；workbench repository由2081降至2058行。债务基线只按实际下降值收紧，债务文件总数仍为29，未上推为阶段D完成。

C2完成后，`conversation-turn-service.ts`由1321降至115行并退出复杂度baseline；复杂度债务文件总数由29降至28。拆分未改变Provider请求、模型选择、Tool执行、消息返回、控制回合或错误文案合同。

C3完成后，`main-agent-tool-loop-config.ts`由2062降至97行并退出复杂度baseline；15个内部职责模块均低于500行且单函数低于150行，复杂度债务文件总数由28降至27。公开工厂和输入类型继续从原路径导出，生产消费者仍只有`conversation-turn-agent-context.ts`；重试和停止策略仍只在controlled ReAct loop。V1-9 contract repair evidence已把15个拆分模块全部纳入SHA-256闭包，避免只绑定门面文件；C3未调用真实Provider。

### 阶段D：治理剩余工程债务

目标：按风险分级治理阶段C结束后的复杂度债务，优先完成“应拆”清单；迁移全部显性与隐藏源码字符串合同，修正检测器后清除真实漏项。稳定且内聚的保留项必须登记理由和未来触发条件。

修改范围：按职责拆分其余前端、workbench、skills、tool adapters和共享合同；清理无用变量、未处理Promise和不稳定依赖；把动态文件追踪改为显式受限根与静态入口。

D1已完成：

- `createPrismaWorkbenchRepository`降至29行并退出复杂度baseline；内部职责模块均低于500行、函数低于150行，V1-9 repair evidence绑定全部活动模块。
- 修复ConversationTurn同键异payload静默复用、双连接claim timeout/重复执行风险、GenerationJob终态降级、VideoShot旧镜头残留和跨镜头/跨source片段绑定。
- 删除无生产消费者且会生成`legacy/null`废Artifact的staged promotion出口；GenerationJob不再自动创建无人消费的StagedArtifactCommit。当前唯一Tool结果晋升仍在control-plane原子事务。
- 全量测试为Node`427/427`、Vitest`801/801 + 773/773`；未调用Provider。

D2已完成：

- “调整后重做”改为带真实Artifact ID的标准教师消息，复用现有幂等提交和Main Agent队列；提交当下不创建新Artifact、不提升IntentEpoch，并与composer草稿及待确认HumanGate隔离。
- 删除专用regenerate route/service/repository/type和对应写操作registry项；Stage3/Stage6中的通用版本递增、项目隔离和唯一批准指针合同已迁入当前主线行为测试，只删除错误直接regenerate合同。
- 删除development adapter、mock selector和四份生产seed；`workbench-api.ts`由499降至233行并退出复杂度baseline，债务由26降至25。
- 全量测试为Node`424/424`、Vitest`782/782 + 786/786`；未运行PPT浏览器验收，未调用Provider。

D3已完成：

- 删除Stage41 local substitute的runner、Playwright假文件交付、专属源码断言测试和package alias；删除零生产消费者的runtime A/B、`orchestrator-runtime`及其专属测试。
- 删除`@openai/agents`依赖；runtime唯一生产实现仍是现有Main Agent native function-call/ReAct链路。
- `StagedArtifactCommit`退出Prisma、新库初始化、health与Provider验证合同；不DROP或改写用户旧库，行为测试证明旧表和数据在重复初始化后保留且health仍通过。
- 2026-07-14冲突ADR按原字节和SHA-256归档；活动索引只保留Main Agent唯一编排口径。
- 全量测试为Node`423/423`、Vitest`778/778 + 773/773`；TypeScript、ESLint、生产构建和development gate通过。源码合同登记债务由21文件/301次收缩为20文件/293次；复杂度债务保持25；未调用Provider。

D4已完成（检测器纠偏）：

- 将源码合同检测从文件级变量名传播改为带词法作用域的直接读取分析，避免同名遮蔽、对象属性、getter、JSX属性/标签和标签名被误判为源码变量。
- 支持`as`、类型断言、`satisfies`、非空断言、`await`和括号等TypeScript表达式解包，并处理无参数`new`表达式；只按断言发生位置读取此前已经生效的赋值，避免后续源码赋值污染前置断言。
- 新增8项回归，检测器测试`14/14`；当前报告为19个文件、219次直接读取命中。D4不启用wrapper、import alias、解构、参数默认值、闭包或完整控制流传播扫描，相关漏报留给D16，不得把本切片称为源码合同清零。
- 复杂度债务保持25个文件；Provider保持离线延期且请求数为0。
- 全量验证通过Node`423/423`、Vitest`778/778 + 773/773`、TypeScript、ESLint `0 warning`、生产构建、standalone检查、development gate和工作树绑定`verify:local`。

D5已完成（workbench service拆分）：

- `createWorkbenchService`保持原导入路径、四个位置参数和47个公开方法；门面降至58行，只组合项目、消息、Artifact、Generation、VideoShot、TurnJob、snapshot以及执行身份/lease职责。
- 共享`ensureProjectAccess`、消息Artifact引用投影和六类数据库记录映射各只有一份实现；9个内部模块均为48至179行且函数低于150行。
- complexity baseline先移除旧债务并观察到`New complexity debt`红灯，拆分后复杂度债务由25降至24。V1-9 contract repair evidence的默认SHA闭包覆盖门面、全部9个内部模块和门面合同测试。
- 门面行为测试冻结服务端执行身份覆盖、guard写入、读授权以及finish/fail跳过普通项目查询并透传同一guard。`src/server/workbench/*.ts`已同步进入Provider敏感生产路径、脚本生产闭包和离线阶段精确白名单，且不匹配嵌套`__tests__`；开发态仍只允许延期，release不接受延期。
- 最终全量回归通过Node`423/423`与Vitest`776/776 + 781/781`；TypeScript、ESLint `0 warning`、生产构建、standalone `forbidden=[]`和development gate通过。Provider保持离线延期、`passed=false`且请求数为0。

D6已完成（消息与事件合同拆分）：

- `conversation-message-contract.ts`与`teacher-agent-events.ts`降为兼容导出门面，具体合同、投影、时间线和消息合并职责分别进入独立模块；现有生产导入路径与序列化版本保持不变。
- D6定向合同`41/41`通过；Node`423/423`、Vitest隔离分片`776/776 + 791/791`、TypeScript、ESLint `0 warning`、生产构建、standalone `forbidden=[]`和development gate均通过。复杂度债务由24降至22。
- Provider保持离线延期、`passed=false`且请求数为0；wrapper/alias/解构等源码合同漏报仍未处理，不能把D6称为源码合同清零或真实产品闭环。

D7已完成（control plane与external-audit ingress）：

- `control-plane-store.ts`中的TaskAggregate创建、暂停、恢复、读取及其校验/映射已迁入`control-plane-task-aggregate.ts`；公开`createControlPlaneStore`、方法名、输入输出与事务语义保持不变。
- `control-plane-store.ts`由639行降至469行，最大函数由351行降至217行；定向持久化/恢复回归`38/38`、TypeScript、ESLint `0 warning`和development gate通过。
- `external-audit-evidence-ingress.ts`保留handoff归一化、run-state绑定校验和唯一公开入口；事务内的TaskAggregate校验、幂等replay、Observation/Checkpoint/Event/Snapshot/TurnJob原子提交迁入`external-audit-evidence-transaction.ts`，公开函数、错误码和写入顺序保持不变。
- external-audit定向回归、startup recovery和V1-9 evidence closure共`31/31`；全量Node/Vitest回归为`423/423`、`776/776 + 793/793`，TypeScript、ESLint `0 warning`、生产构建`missing=[] / forbidden=[]`和development gate通过。
- external-audit拆分后复杂度债务由22降至21；新事务模块未新增超限项，V1-9 repair evidence闭包覆盖入口、事务模块和行为测试。Provider仍保持离线延期、`passed=false`且请求数为0。

风险优先小切片（Agent Tool授权）：

- `agent-tool-router.ts`中的授权、Artifact可信度、审核目标和locator绑定校验已迁入`agent-tool-authorization.ts`；`routeAgentToolCall`公开入口和结果合同保持不变。
- 定向Agent Tool路由/默认授权/dispatcher/report回归`57/57`，路由门面由825行降至408行；TypeScript、ESLint `0 warning`、生产构建`forbidden=[]`和development gate通过。
- 路由门面仍保留一条略超150行的主流程，已转为“修改时再评估”，不能称为该模块完全清零。

风险优先小切片（Provider结果合同）：

- `provider-tool-adapter.ts`中的`needs_input/failed`教师结果、预算事件和重试动作已迁入`provider-tool-result-contract.ts`；Provider提交、轮询和响应语义保持不变。
- Provider adapter与视频旁白定向回归`32/32`；适配器由1074行降至955行，TypeScript、ESLint `0 warning`、生产构建`forbidden=[]`和development gate通过。
- Provider adapter剩余按Provider族拆分仍需基于变更风险评估，不能把本切片称为Provider模块治理完成。

风险优先小切片（Provider视频镜头请求）：

- `resolveDefaultVideoShotRequest`及其 storyboard、shot duration、参考图本地文件/哈希、Provider ledger和Evolink参考上传证据职责已迁入`provider-video-shot-request.ts`；Provider提交、轮询、响应晋升和错误码语义保持不变。
- Provider适配器门面按复杂度检测器由955行收缩到900行，新模块为65行；复杂度baseline同步收缩，债务总数保持22项，没有新增超限模块。
- Provider适配器、视频生产合同、参考上传和V1-9 repair evidence 定向回归`46/46`通过；TypeScript、ESLint `0 warning`、生产构建`missing=[] / forbidden=[]`和development gate通过。
- 新增模块与既有`provider-tool-result-contract.ts`一起纳入V1-9 contract repair SHA闭包；Provider仍保持离线延期、`passed=false`且请求数为0，不能把本切片称为Provider模块治理完成。

D8已完成（Skill runtime职责拆分）：

- `business-tool-skill-runtime.ts`保留原公开工厂、配置运行时、预检入口、错误码和结果类型；执行编排迁入`business-tool-skill-runtime-execution.ts`，正式结果校验迁入`business-tool-skill-result-validator.ts`，合同集合比较等辅助逻辑迁入`business-tool-skill-runtime-execution-helpers.ts`。
- `skill-registry.ts`、`business-tool-skill-bindings.ts`和`business-tool-skill-output-contract.ts`未机械拆分：它们分别是稳定的版本化注册表、业务Tool绑定映射和正式输出协议映射，职责内聚且变更边界清晰，理由和未来触发条件已登记在风险治理ADR。
- Skill runtime定向回归`32/32`通过；V1-9 contract repair evidence闭包新增4个Skill生产模块和3个Skill行为测试，防止只绑定兼容门面。
- 全量`npm test`通过Node`423/423`与Vitest`776/776 + 794/794`；TypeScript、ESLint `0 error / 0 warning`、生产构建standalone `missing=[] / forbidden=[]`和development gate通过。
- 复杂度债务由21降至20；Provider保持离线延期、`passed=false`且请求数为0，未调用真实Provider、未创建V1-9 runId、未生成媒体。

D9已完成（Tool职责治理）：

- `agent-tool-router.ts`保留注册解析、Envelope校验、授权、执行和schema校验，只迁出视频Director/Critic结果策略。
- `provider-tool-adapter.ts`保留Provider识别、输入解析、提交顺序和调用边界，只迁出成功结果投影与失败分类；Provider请求、响应、重试、晋升和错误码语义不得改变。
- `package-tool-adapter.ts`按PPT组装、视频组装和最终包三类真实职责拆分，原`executePackageTool`与`readPackageAssetBuffer`导入路径保持兼容。
- `tool-router.ts`是唯一Tool前置校验、适配器分发和后置校验边界，当前稳定内聚，按ADR保留，不为清空数字机械拆分。
- D9定向行为回归沿用现有Agent Tool、Provider、视频旁白、Package和Tool Router合同；全量`npm test`通过Node`423/423`与Vitest`776/776 + 794/794`。
- `npm run typecheck`、ESLint `0 error / 0 warning`、生产构建standalone `missing=[] / forbidden=[]`和development gate通过；复杂度债务由20降至17。
- Provider保持离线延期、`passed=false`且请求数为0；未调用真实Provider、未创建V1-9 runId、未生成媒体。

D10已完成（Runtime与模型Agent职责拆分）：

- `openai-runtime.ts`保留Runtime公开门面、OpenAI adapter、native Tool loop边界和结果入口；请求构造、结构化输出解析、JSON schema、错误分类与结果映射分别迁入`openai-runtime-request.ts`、`openai-runtime-output.ts`、`openai-runtime-schema.ts`、`openai-runtime-error.ts`和`openai-runtime-result.ts`，`OpenAIRuntime`与`buildOpenAIResponseRequest`原导出路径保持兼容。
- `main-agent-controlled-react-loop.ts`保留唯一ReAct状态机公开入口；类型合同、checkpoint/telemetry/通知/恢复辅助、完成合同修复和Tool回合处理分别迁入`main-agent-react-loop-contract.ts`与`main-agent-react-loop-helpers.ts`，恢复、重试、预算、HumanGate和停止语义保持不变。
- Runtime、Runtime质量与ReAct行为定向回归`55/55`通过；V1-9 repair evidence closure定向回归`10/10`通过。
- 复杂度 baseline 先移除两个D10目标并按预期出现`New complexity debt`红灯；拆分后两个目标均退出实际债务，登记项由17降至15，没有新增超限模块。
- `npm run typecheck`与定向ESLint `0 error / 0 warning`通过；Provider保持离线延期、`passed=false`且请求数为0，未调用真实Provider、未创建V1-9 runId、未生成媒体。

D11已完成（Feedback职责评估与最小拆分）：

- `feedback/service.ts`保留公开工厂、反馈提交、管理查询和附件下载；提交链路与后台reconciliation是不同运行语义，reconciliation迁入`feedback/service-reconciliation.ts`，跨提交/恢复共用的终态提交合同迁入`feedback/service-shared.ts`。
- `feedback/repository.ts`继续作为单一Feedback持久化边界保留；`useFeedbackController.ts`继续作为一个拥有幂等、图片生命周期和提交状态的客户端状态机保留；`FeedbackDialog.tsx`继续作为单一反馈Dialog及其图片区组件保留。三者没有证据表明存在重复控制权或不清晰变更边界。
- 复杂度 baseline 先移除`feedback/service.ts`并按预期出现`New complexity debt`红灯；拆分后复杂度登记项由15降至14，新模块均低于500行且无函数超过150行。
- Feedback服务/存储/契约定向回归`62/62`，UI/源码合同定向回归`16/16`；其余稳定保留项的理由、风险和未来触发条件已登记在风险治理ADR。

D12已完成（真实前端职责治理）：

- `useWorkbenchController.ts`保留唯一公开组合入口；项目状态/快照同步、项目生命周期动作、composer提交/恢复、产物导航和产物操作分别迁入`useWorkbenchProjectState.ts`、`useWorkbenchProjectSync.ts`、`useWorkbenchProjectActions.ts`、`useWorkbenchComposerController.ts`、`workbench-composer-submission.ts`、`useWorkbenchArtifactNavigation.ts`和`useWorkbenchArtifactOperations.ts`。提交、HumanGate、队列、恢复、Artifact和真实素材回调名称保持不变。
- `PromptComposer.tsx`保留唯一输入面；拖拽、粘贴、文本读取、大小限制、异步取消和附件提交快照迁入`useComposerAttachments.ts`。`MediaWorkbench.tsx`与`ProjectListItem.tsx`经评估继续保留，分别是工作台布局组合和单行项目编辑状态机，没有重复控制权。
- 拆分完成后按真实复杂度报告从baseline移除`useWorkbenchController.ts`与`PromptComposer.tsx`，复杂度登记项由14降至12；新增职责模块均低于500行且无函数超过150行。
- D12前端源码合同定向Node回归`34/34`；全量`npm test`通过Node`423/423`、Vitest`776/776 + 796/796`；TypeScript、ESLint `0 error / 0 warning`和生产构建通过，standalone为`missing=[] / forbidden=[]`。development gate为`passed-with-offline-refactor-defer`，Provider保持`passed=false`，未调用真实Provider。

D13已完成（视频route风险评估与最小血缘修复）：

- 复核确认GET下载和POST生成仍属于同一Artifact视频资源动作，GET/POST均只经过`withLocalWorkbenchActor`；POST继续只持有一个project execution lease、一个`ExecutionEnvelope`和共享原子commit边界，`submission_unknown`、Provider失败、质量失败、404/409/400语义保持不变。
- 发现真实缺口：route成功测试mock掉Tool Router，POST没有把单镜头`shotIds`传给`generate_video_segment`，也没有把同一镜头写入GenerationJob `unitId`，导致真实Provider合同无法闭合。新增`video-route-generation.ts`承接视频执行协调和边界输入校验，route保留HTTP/认证/下载/lease职责。
- `shotId`/`shotIds`必须是唯一、格式正确且一致的单镜头；缺失或冲突在claim、GenerationJob、Provider前失败关闭。源Artifact、TaskBrief、IntentEpoch、storyboard/asset上游和GenerationJob继续通过共享gateway与当前任务隔离；VideoShot下游只能消费绑定同一shot的正式结果。
- Artifact直发API新增可选`shotId`输入；没有服务端明确shotId的旧video action不再展示，避免教师触发必然失败的直发按钮。现有GET/POST响应、错误码和教师安全文案保持兼容。
- 定向视频与Artifact route回归`27/27`，API client Node合同`18/18`，TypeScript、ESLint `0 error / 0 warning`通过；复杂度从12个登记项单调降至11，Provider保持`passed=false`且请求数为0，未生成媒体。

D14已完成（Ops源码合同与失效数据源清理）：

- `desktop/electron-main.mjs`和`playwright.config.ts`删除无消费者的`NEXT_PUBLIC_WORKBENCH_DATA_SOURCE`注入；Electron、Playwright和deploy demo环境分别通过结构化配置函数生成，服务器只接收真实数据库与Artifact存储路径。
- container runtime、video smoke、desktop installer、deploy demo、auth preflight和production preflight测试改为可注入探针、结构化配置或行为断言；不再依赖读取实现源码并匹配字符串证明这些Ops行为。
- D14定向Ops Node合同`55/55`通过；全量`npm test`通过Node`425/425`、Vitest`776/776 + 797/797`；TypeScript、ESLint `0 error / 0 warning`和生产构建通过，standalone为`missing=[] / forbidden=[]`。
- source-contract债务由19个文件收缩至13个，complexity保持11个登记项；Provider仍为`passed=false`且真实请求数为0。

D14完成后的唯一执行顺序：

1. **D15 Runner源码合同**：先M67后V1-9，改验冻结树、child process、shutdown和manifest/state行为。
2. **D16 最终检测**：启用wrapper/常量表/属性传播检测，清完真实漏项并完成保留项登记后收口complexity与source policy。

验收：

- “应拆”清单中的高风险模块完成职责治理；“修改时再评估”和“可保留”项均有事实理由、风险和未来触发条件记录，D13视频route已完成最小职责拆分。
- 复杂度与源码合同baseline不得新增或扩大；真实已修复项必须收缩，不能把登记项当作完成证明。
- `sourceStringContracts.baseline`只在真实漏项清除后收缩，不用测试或放宽扫描语义制造清零。
- ESLint为0 error、0 warning，政策`maxWarnings=0`。
- 生产构建无动态追踪warning。

### 阶段E：最终产品验证

目标：证明重构没有破坏教师主链路。

验收：全量Node/Vitest、TypeScript、Lint、生产构建、development gate、SHA manifest、本地启动、health和桌面浏览器核心流程全部在最终HEAD重新执行。

真实Provider仍是独立阻塞：没有授权就保持0请求，不能用离线验证冒充连续性通过。

## 4. 删除原则

- 先迁移消费者，再删除旧实现；同一切片结束时不能留下两个可执行入口。
- 仅为兼容外部持久数据保留的解析器必须只读、不可执行，并明确迁移删除条件。
- 新模块按业务职责命名，不用`v2`、`final`、`latest`或`new`制造竞争版本。
- 拆分不得改变Provider选择、费用、真实产物晋升或教师授权语义。
- 总体代码行数应下降；新增文件只承接从巨型模块迁出的稳定职责。

## 5. 提交边界

1. 文档口径、阶段合同和Provider离线重构门。
2. 合同正确性与统一写入口。
3. 旧控制面和deterministic生产路径删除。
4. 两个核心巨型模块拆分。
5. 高风险复杂度与源码合同治理、Lint和构建追踪收口；稳定内聚保留项不因数字清零而机械拆分。
6. 最终验证与状态收口。

每个提交必须包含对应行为测试和实际验证结果；失败不得通过放宽阈值、增加fallback或删除有效测试处理。
