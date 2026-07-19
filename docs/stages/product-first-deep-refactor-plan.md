# 产品优先深度重构计划

更新时间：2026-07-20

## 1. 目标

把当前“旧实现仍在、靠拒绝门防止复活”的状态改成只有一套生产控制面，并把已经登记的复杂度、源码合同、Lint和构建追踪债务实际清零。

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

- 复杂度债务已由27降至25个文件；当前源码合同门仍报告21个文件、301次命中，但已证实该检测器同时漏报wrapper读取并跨作用域误报，不能再把该数字当作完整债务。
- `conversation-turn-service.ts`为115行，`main-agent-tool-loop-config.ts`为97行，workbench repository已由2058行降至29行；三个公开门面只负责组合内部职责。

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

每个切片都必须先保留外部行为测试，再迁移实现，最后删除原位置的竞争实现。单文件不超过500行、函数不超过150行；不得通过转发层套转发层、提高阈值、扩大排除目录或源码字符串测试制造通过。

验收：PendingDecision不存在部分确认；两个公开工厂签名和Provider语义不变；讨论零Tool、单Tool范围、HumanGate确认/取消/改道、迟到结果隔离、Invocation/Observation/Event/Artifact终态矩阵和恢复行为均通过；Stage C结束时两个目标文件均不超过500行。

C1完成后，`control-plane-store.ts`由758降至639行、最大函数由406降至351行；`conversation-turn-service.ts`由1415降至1321行、最大函数由491降至424行；workbench repository由2081降至2058行。债务基线只按实际下降值收紧，债务文件总数仍为29，未上推为阶段D完成。

C2完成后，`conversation-turn-service.ts`由1321降至115行并退出复杂度baseline；复杂度债务文件总数由29降至28。拆分未改变Provider请求、模型选择、Tool执行、消息返回、控制回合或错误文案合同。

C3完成后，`main-agent-tool-loop-config.ts`由2062降至97行并退出复杂度baseline；15个内部职责模块均低于500行且单函数低于150行，复杂度债务文件总数由28降至27。公开工厂和输入类型继续从原路径导出，生产消费者仍只有`conversation-turn-agent-context.ts`；重试和停止策略仍只在controlled ReAct loop。V1-9 contract repair evidence已把15个拆分模块全部纳入SHA-256闭包，避免只绑定门面文件；C3未调用真实Provider。

### 阶段D：清零剩余工程债务

目标：把阶段C结束后的27个复杂度债务文件归零；迁移全部显性与隐藏源码字符串合同，修正检测器后在增强扫描下归零。

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

D3后的唯一执行顺序：

1. **D4 检测器纠偏**：修复跨作用域误报、属性名污染和TypeScript表达式解析；此时只校准当前直接读取，不提前把隐藏债务写成0。
2. **D5 workbench service**：按项目/消息、Artifact、Generation、VideoShot、TurnJob、snapshot与Guard拆分，保持工厂参数和授权/映射合同。
3. **D6 消息与事件合同**：先把Provider敏感路径从精确文件扩为新目录glob，再拆MessagePart和TeacherEvent合同。
4. **D7 control plane与外部审计**：拆store后拆唯一external-audit ingress，保持原子提交和authority事实。
5. **D8 Skill**：bindings、output contract、registry叶子先行，runtime最后组合。
6. **D9 Tool**：agent router、package/provider adapters、tool-router依次迁移；Provider请求和响应语义只允许机械保持。
7. **D10 Runtime与模型Agent**：OpenAI runtime、controlled ReAct loop、model agent依次迁移；任何请求/重试/晋升语义变化都退出离线阶段。
8. **D11 Feedback**：repository、service、controller、dialog按依赖顺序拆分。
9. **D12 真实前端**：删除无生产消费者的PromptComposer并把必要能力/测试绑定到assistant-ui，再处理controller和MediaWorkbench。
10. **D13 视频route**：保留GET/POST、外层wrapper、Envelope、任务隔离和错误码，只做机械拆分。
11. **D14 Ops源码合同**：container、deploy、desktop、auth和video smoke改为结构化配置或可注入行为测试，并删除已无消费者的旧数据源环境变量赋值。
12. **D15 Runner源码合同**：先M67后V1-9，改验冻结树、child process、shutdown和manifest/state行为。
13. **D16 最终检测**：启用wrapper/常量表/属性传播检测，清完最后漏项后同时置空complexity与source baseline。

验收：

- `complexity.baseline=[]`，实际债务为0。
- `sourceStringContracts.baseline=[]`，测试只验证行为、接口、schema或运行时事实。
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
5. 其余复杂度、源码合同、Lint和构建追踪清零。
6. 最终验证与状态收口。

每个提交必须包含对应行为测试和实际验证结果；失败不得通过放宽阈值、增加fallback或删除有效测试处理。
