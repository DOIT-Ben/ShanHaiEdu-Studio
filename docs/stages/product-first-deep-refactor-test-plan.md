# 产品优先深度重构测试计划

更新时间：2026-07-20

## 1. 验收层级

本阶段只可关闭`contract`与`executor`重构门。未调用真实Provider时，`model orchestration`和`product E2E`最多保持既有partial，`release`保持not started。

## 2. 必须先失败的行为合同

| ID | 场景 | 预期 |
|---|---|---|
| DR-A01 | 项目写handler在wrapper前提前返回 | orchestration gate失败 |
| DR-A02 | 非`route.ts`的Next写入口绕过registry | orchestration gate失败 |
| DR-A03 | 成员新增、改角色、删除绕过统一actor/CSRF | 请求失败且业务handler不执行 |
| DR-A04 | attempted审计写入失败 | 业务handler调用次数为0 |
| DR-A05 | terminal审计写入失败 | 不返回业务成功并保留open attempt |
| DR-A06 | Observation、Event、Invocation终态错绑 | 提交事务拒绝 |
| DR-A07 | 重复terminal或terminal先于start | 提交事务拒绝 |
| DR-A08 | Observation-only成功没有Artifact | 合法成功，不被摘要误判 |
| DR-A09 | 声称产生Artifact但缺少正式绑定 | 提交或摘要失败 |
| DR-A10 | authority summary身份、ordinal、水位或digest篡改 | readyEligible=false |
| DR-B01 | 生产路径尝试读取或执行`toolPlan`/`deliveryPlan` | 编译或行为合同失败 |
| DR-B02 | deterministic结果尝试晋升为正式Artifact | 晋升失败 |
| DR-B03 | native turn之外的组件选择下一业务Tool | 行为合同失败 |
| DR-C01 | PendingDecision消息已更新，但事件或语义快照写入失败 | 不得对外形成部分确认；同一action可幂等恢复 |
| DR-C02 | 同一PendingDecision actionId以不同payload重放 | 冲突失败关闭，不覆盖首次提交事实 |
| DR-C03 | turn service拆分后执行讨论、单Tool、确认、取消、改道和恢复 | `createConversationTurnService`入口与外部行为不变 |
| DR-C04 | tool loop拆分后执行Tool资格、Envelope、结果提交和恢复 | `createMainAgentToolLoopOptions`入口与终态矩阵不变 |
| DR-C05 | Stage C目标文件或新职责模块新增超限，且未按复杂度治理ADR评估或登记 | complexity gate失败 |
| DR-D01 | 新增或扩大复杂度债务 | complexity gate失败 |
| DR-D02 | 债务减少但baseline尚未同步 | 报告可识别stale baseline，允许显式收缩 |
| DR-D03 | 新增源码字符串合同 | source-contract gate失败 |
| DR-D04 | 新增Lint warning | Lint失败 |
| DR-D05 | 动态路径可逃逸受限根 | 构建/路径合同失败 |
| DR-D06 | ConversationTurn同一幂等键携带不同消息、身份、metadata或控制动作 | 失败关闭，不复用旧Job |
| DR-D07 | 两个独立PrismaClient同时claim同一TurnJob | 只有一个running执行者，另一方返回null且不timeout |
| DR-D08 | 陈旧worker把queued、failed或succeeded GenerationJob标成submission_unknown | 状态不变并失败关闭 |
| DR-D09 | VideoShot完整计划移除旧shot或选择同项目错误shot/source片段 | 旧shot删除；错误血缘拒绝，正确血缘可选 |
| DR-D10 | D10目标文件移出baseline但职责尚未迁出 | complexity gate以`New complexity debt`失败 |
| DR-D11 | D10拆分改变Runtime请求/响应/schema/错误或ReAct恢复/重试/停止合同 | Runtime、Runtime质量与ReAct行为回归失败 |
| DR-D12 | D11 Feedback service拆分改变提交、重试、reconciliation或管理接口合同 | Feedback服务/存储/契约回归失败 |
| DR-D13 | D9拆分改变Agent策略、Provider调用/结果或Package产物合同 | 既有Agent Tool、Provider、Package和Tool Router行为回归失败 |
| DR-D14 | D12前端职责拆分改变项目快照、composer提交/恢复、Artifact动作或附件生命周期合同 | 前端Node/Vitest与源码合同回归失败 |
| DR-D15 | D13视频route未绑定唯一shot、GenerationJob unitId与Provider Tool输入，或HTTP边界/helper拆分改变共享Envelope、错误恢复和原子提交合同 | 视频route、Artifact route隔离、Provider视频工具和API client合同回归失败 |

## 3. 每切片验证

```powershell
node --test --test-concurrency=1 <相关Node测试>
npm test
npm run typecheck
npm run lint -- --max-warnings 0
npm run gate:development
git diff --check
git diff --cached --check
```

`npm test`是依赖数据库测试的权威入口，会为Node测试和Vitest分片初始化独立临时SQLite；不得裸跑依赖数据库的Vitest并复用真实库。每个切片都必须保持ESLint `0 error / 0 warning`；只有阶段D完成高风险治理、完成保留项登记并通过最终门禁后，才允许声称复杂度治理阶段完成；不能把剩余保留baseline称为清零。

## 4. 删除性验收

```powershell
rg -n "WorkflowNode|toolPlan|deliveryPlan|DeterministicRuntime" src
node scripts/development-gates/complexity.mjs --report-json
node scripts/development-gates/source-contracts.mjs
```

最终预期：第一条无生产命中；复杂度门无新增或扩大债务，高风险项已治理，保留项与风险治理ADR的理由和触发条件一致；源码字符串合同报告无债务。

## 5. 阶段B新鲜证据

2026-07-20阶段B候选工作树已实际取得：

- 生产旧控制面符号扫描为0，活动写操作registry为16条。
- Node测试`427/427`，Vitest两个隔离分片`793/793`与`775/775`。
- TypeScript、ESLint `0 warning`、生产构建、standalone敏感文件检查通过。
- development gate通过，Provider结果为`deferred_provider_validation_during_offline_refactor`且`passed=false`。
- `verify:local`生成绑定当前HEAD与工作树的manifest，`gate:manifest:verify`及`desktop:smoke`通过。
- 复杂度债务为29个文件、源码字符串合同债务为21个文件，未上推为阶段D完成。

## 6. 阶段C切片验证

- C0：Provider continuity gate测试、wiring测试、development gate和`git diff --check`；Provider结果必须保持`passed=false`且请求数为0。
- C1：PendingDecision失败注入、幂等重放、冲突payload、错误actionId、确认/取消/改道和刷新恢复测试。
- C2：conversation turn service、streaming progress、structured intake、TaskBrief和控制回合回归。
- C3：main agent tool loop、Tool registry、ExecutionEnvelope、terminal replay、Observation/Artifact提交和GenerationJob恢复回归。
- 每个切片再运行TypeScript、零warning ESLint、complexity gate、source-contract gate和development gate。

C1新鲜证据：

- 失败注入红测先观察到Snapshot失败后消息错误变为`confirmed`，修复后同一故障会回滚Aggregate、授权元数据、消息和事件，旧快照保持`pending`。
- 同一`actionId`同payload重放只保留一个事件；改为不同终态时失败关闭且不覆盖首次事实。
- Node测试`427/427`；Vitest隔离分片`793/793`与`777/777`。
- TypeScript、ESLint `0 warning`、生产构建、standalone敏感文件检查和development gate通过。
- Provider保持离线延期、`passed=false`且请求数为0；复杂度债务仍为29个文件、源码字符串合同债务仍为21个文件。

C2新鲜证据：

- `createConversationTurnService`、`MessageTurnResponse`和`capabilityTeacherLabel`继续从原模块导入；没有新增竞争入口。
- Node测试`427/427`；Vitest隔离分片`793/793`与`777/777`，覆盖讨论、单Tool、流式进度、TaskBrief、确认、取消、改道、失败与双用户隔离。
- TypeScript、ESLint `0 warning`、生产构建、standalone敏感文件检查和development gate通过。
- `conversation-turn-service.ts`为115行，新职责模块均低于500行且无函数超过150行；复杂度债务由29降至28，源码字符串合同债务仍为21。
- Provider保持离线延期、`passed=false`且请求数为0。

C3新鲜证据：

- `createMainAgentToolLoopOptions`和`CreateMainAgentToolLoopOptionsInput`继续从原模块导出；生产消费者仍只有`conversation-turn-agent-context.ts`，没有新增竞争dispatch入口。
- `npm test`通过：Node测试`427/427`，Vitest隔离分片`793/793`与`778/778`；覆盖Tool资格、ExecutionEnvelope、HumanGate、Skill合同、terminal replay、Observation/Artifact提交、GenerationJob恢复及PPT/视频编排。
- TypeScript、ESLint `0 warning`和生产构建通过，standalone检查`forbidden=[]`；`main-agent-tool-loop-config.ts`为97行，15个职责模块均低于500行且无函数超过150行。
- V1-9 contract repair evidence的默认SHA闭包包含全部15个拆分模块，定向合同`2/2`通过。
- development gate通过；复杂度债务由28降至27，源码字符串合同债务仍为21。Provider保持离线延期、`passed=false`和0请求，未把离线回归上推为连续性通过。

D1新鲜证据：

- 红测先复现两种幂等入口静默吞掉异payload、双PrismaClient claim timeout、queued GenerationJob被降级、VideoShot旧计划残留和错误片段绑定。
- `createPrismaWorkbenchRepository`为29行；全部内部模块低于500行且函数低于150行，复杂度债务由27降至26。
- 无生产消费者的staged result promotion及其自动stage写入已删除；迟到结果隔离继续由当前control-plane行为测试覆盖。
- `npm test`通过：Node`427/427`，Vitest隔离分片`801/801`与`773/773`；匹配ValidationReport与Artifact原子保存、摘要不匹配时零新增事实的迁移测试已恢复；TypeScript和ESLint `0 warning`通过。
- 当前source gate仍报告21文件/301次，但该数字已确认有漏报和误报，只能作为旧检测器输出，不能作为最终债务总数。

D2新鲜证据：

- 红测先证明repository/service仍暴露直接`regenerateArtifact`、前端仍导出mock选择器且按钮缺少标准消息转换。
- 重做提交使用真实Artifact ID和标准`POST /messages`；路由行为验证提交后只有教师消息与queued ConversationTurn，Artifact版本保持1、IntentEpoch保持0；产物动作策略不清空composer草稿，也不绑定待确认HumanGate。
- 专用regenerate写入口、development adapter、mock selector和四份seed已删除；旧阶段测试中的版本递增、项目隔离和唯一批准指针合同已迁入当前主线行为测试，错误直接regenerate断言已删除；写操作registry由16降至15。
- `npm test`通过：Node`424/424`，Vitest隔离分片`782/782`与`786/786`；TypeScript和development gate通过，复杂度债务由26降至25。
- 按用户要求未运行PPT浏览器验收；Provider请求数为0。

D3新鲜证据：

- 数据库行为红测先以`2`项失败证明新库仍创建`StagedArtifactCommit`且旧表会被初始化脚本的旧索引假设阻断；修复后全新库无该表/字段，旧库遗留表和数据保留并被health忽略。
- Stage41 runner/spec/alias、runtime A/B、`orchestrator-runtime`、专属测试和`@openai/agents`依赖已删除；活动源码与依赖零引用。
- 定向数据库与control-plane回归`92/92`；`npm test`通过：Node`423/423`，Vitest隔离分片`778/778`与`773/773`。
- TypeScript、ESLint `0 warning`、生产构建、standalone `forbidden=[]`和development gate通过；复杂度债务保持25，源码合同门由21文件/301次收缩为20文件/293次。
- Provider保持离线延期、`passed=false`且请求数为0；未运行PPT浏览器验收、390px或任何真实媒体/整包流程。

D4新鲜证据：

- source-contract detector的回归覆盖词法作用域遮蔽、对象属性、getter/JSX名称、TypeScript表达式解包、无参数`new`、赋值顺序、`var`函数作用域和模板路径；共14项检测器测试全部通过。
- 当前直接读取报告为19个文件、219次命中；D4只修正直接读取的检测语义，不启用wrapper、import alias、解构、参数默认值、闭包或完整控制流传播扫描。相关漏报及多次重赋值误判保持显式未完成，留给D16增强扫描。
- `wiring.test.mjs`的活动归档例外清单已与2026-07-20归档目录三项文件同步；Provider保持离线延期、`passed=false`且请求数为0。
- 开发门禁测试`119/119`，另有1项Windows符号链接能力跳过；`npm test`通过Node`423/423`与Vitest`778/778 + 773/773`，TypeScript、ESLint `0 warning`、生产构建、standalone `forbidden=[]`、development gate和工作树绑定`verify:local`通过。

D5完成证据：

- 新增运行时门面合同冻结`createWorkbenchService`的47个方法以及`withExecutionGuard`身份传递；初始`2/2`通过，随后扩展为`5/5`，覆盖两个enqueue入口的服务端身份覆盖、guard写入、读授权以及finish/fail原guard透传。
- complexity baseline移除`src/server/workbench/service.ts`后先以`New complexity debt`失败；拆分后门面58行，9个内部模块48至179行且函数均低于150行，复杂度债务由25降至24。
- V1-9 contract repair evidence的默认SHA闭包覆盖门面、9个内部职责模块和门面合同测试；门面与闭包定向`9/9`通过。
- Provider红测先证明workbench模块未进入生产闭包且离线阶段不接受该路径；修复后Provider门禁`32/32`通过，另有1项Windows符号链接能力跳过。三个生产模块均命中`impacted:true`与`offlineRefactorOnly:true`，嵌套`__tests__`不命中；release仍因缺少真实receipt失败关闭。
- 最终`npm test`通过Node`423/423`与Vitest`776/776 + 781/781`；TypeScript、ESLint `0 warning`、生产构建、standalone `forbidden=[]`和development gate通过。Provider保持离线延期、`passed=false`且请求数为0。

D6完成证据：

- `MessagePart`拆为parts与projection职责，`TeacherAgentEvent`拆为contract、projection、timeline与message merge职责；旧导出路径保持兼容，序列化、持久化、assistant-ui投影和Provider敏感路径边界未改变。
- D6定向合同测试`41/41`通过；Node`423/423`，Vitest隔离分片`776/776 + 791/791`，TypeScript、ESLint `0 warning`、生产构建`forbidden=[]`和development gate通过。
- 复杂度债务由24降至22；源码合同门仍报告19个直接读取债务文件，wrapper、alias、解构及完整控制流传播漏报继续留给D16。Provider保持离线延期、`passed=false`且请求数为0。

D7完成证据：

- `control-plane-store.ts`中的TaskAggregate创建、暂停、恢复、读取及其校验/映射已迁入`control-plane-task-aggregate.ts`，公开store工厂和方法合同保持不变。
- control-plane持久化、生命周期恢复、会话恢复和终端事件定向回归`38/38`通过；TypeScript、ESLint `0 warning`和development gate通过。
- external-audit ingress已保留唯一边界入口，输入归一化/绑定校验与事务提交/恢复协调已分责到两个模块；公开函数、错误码、原子写入顺序和startup recovery合同不变。
- external-audit、startup recovery和V1-9 evidence closure定向回归`31/31`；复杂度债务由22降至21。
- 全量`npm test`通过Node`423/423`与Vitest`776/776 + 793/793`；TypeScript、ESLint `0 warning`、生产构建standalone `missing=[] / forbidden=[]`和development gate通过。
- Provider保持离线延期、`passed=false`且请求数为0；未调用真实Provider、未创建V1-9 runId、未生成媒体。

风险优先Agent Tool授权切片证据：

- 授权、Artifact可信度、审核目标和locator绑定校验迁入`agent-tool-authorization.ts`，`routeAgentToolCall`公开入口和结果合同保持不变。
- Agent Tool路由、默认授权、dispatcher与report定向回归`57/57`；路由门面由825行降至408行，TypeScript、ESLint `0 warning`、生产构建和development gate通过。
- 主路由函数仍略超150行，已按风险治理ADR登记为修改时再评估，不把该切片称为复杂度清零。

风险优先Provider结果合同切片证据：

- `needs_input/failed`教师结果、预算事件和重试动作迁入`provider-tool-result-contract.ts`，Provider提交与响应语义保持不变。
- Provider adapter与视频旁白定向回归`32/32`；适配器由1074行降至955行，TypeScript、ESLint `0 warning`、生产构建和development gate通过。
- Provider adapter剩余Provider族职责继续按风险评估，不以文件行数单独触发拆分。

风险优先Provider视频镜头请求切片证据：

- 独立SQLite、单worker定向运行`tests/provider-tool-adapter.test.ts`、`tests/video-production-contract.test.ts`、`tests/video-reference-upload.test.ts`和`tests/v1-9-contract-repair-evidence.test.ts`，共`46/46`通过。
- `npm run typecheck`、`npm run lint -- --max-warnings=0`、`npm run build`和`npm run gate:development`均通过；生产构建standalone检查为`missing=[]`、`forbidden=[]`。
- development gate保持`passed-with-offline-refactor-defer`，Provider `passed=false`且请求数为0；未运行真实Provider、未创建V1-9 runId、未生成媒体。
- `provider-video-shot-request.ts`与`provider-tool-result-contract.ts`均已进入V1-9 repair evidence闭包断言；复杂度报告保持22个登记项，未把稳定大文件或其他未评估模块机械拆分。

D8完成证据：

- Skill runtime公开门面、配置运行时和预检入口保持兼容；执行、正式结果校验和辅助合同比较分别进入`business-tool-skill-runtime-execution.ts`、`business-tool-skill-result-validator.ts`和`business-tool-skill-runtime-execution-helpers.ts`。
- Skill registry、业务Tool绑定和正式输出协议均保持原文件，行为测试证明其稳定内聚注册表/协议映射边界；未来只有职责增长或变更边界变模糊才重新评估拆分。
- Skill定向测试`32/32`通过；V1-9 contract repair evidence闭包绑定4个Skill生产模块和3个Skill行为测试。
- 全量`npm test`通过Node`423/423`与Vitest`776/776 + 794/794`；TypeScript、ESLint `0 error / 0 warning`、生产构建standalone `missing=[] / forbidden=[]`和development gate通过。
- 复杂度债务由21降至20；development gate保持`passed-with-offline-refactor-defer`，Provider `passed=false`且请求数为0，未调用真实Provider、未创建V1-9 runId、未生成媒体。

D9完成证据：

- Agent Tool门面只保留注册解析、Envelope、授权、执行和schema校验；视频Director/Critic策略迁入`agent-tool-policy-result.ts`，原路由与失败观察合同保持不变。
- Provider门面只保留Provider识别、输入解析、提交顺序和调用边界；成功结果投影与失败分类迁入独立模块，原Provider请求、响应、重试、晋升和错误码语义保持不变。
- Package门面只负责能力分发和错误合同；PPT组装、视频组装和最终包/下载血缘分别进入独立模块，`executePackageTool`和`readPackageAssetBuffer`导入路径保持兼容。
- `tool-router.ts`继续作为唯一Tool前置校验、适配器分发和后置校验边界，按ADR登记为稳定内聚保留项。
- V1-9 repair evidence闭包绑定新增Agent、Provider、Package模块及行为测试；定向证据`9/9`通过。全量`npm test`通过Node`423/423`与Vitest`776/776 + 794/794`。
- `npm run typecheck`、ESLint `0 error / 0 warning`、生产构建standalone `missing=[] / forbidden=[]`和development gate通过；复杂度债务由20降至17。
- Provider保持离线延期、`passed=false`且请求数为0；未调用真实Provider、未创建V1-9 runId、未生成媒体。

D10完成证据：

- Runtime请求构造、结构化输出、JSON schema、错误分类与结果映射已从`openai-runtime.ts`迁入独立模块；ReAct合同、完成合同修复、Tool回合、checkpoint、telemetry和通知辅助已从`main-agent-controlled-react-loop.ts`迁入独立模块，旧公开导出路径保持兼容。
- `tests/agent-runtime/openai-runtime.test.ts`、`runtime-quality.test.ts`和`main-agent-controlled-react-loop.test.ts`定向行为回归`55/55`；`tests/v1-9-contract-repair-evidence.test.ts`为`10/10`，闭包覆盖D10门面、全部职责模块和行为测试。
- complexity baseline先移除D10两个目标并出现预期`New complexity debt`红灯；拆分后实际复杂度债务从17降至15，D10新增模块均低于500行且无函数超过150行。
- `npm run typecheck`与定向ESLint `0 error / 0 warning`通过；Provider继续离线延期，`passed=false`且请求数为0。独立运行依赖旧测试数据库表的`main-agent-tool-loop-config.test.ts`会因缺失`OrchestrationAuditEvent`失败，该环境问题不在D10改动路径；最终以`npm test`隔离数据库回归为准。

D11完成证据：

- `feedback/service.ts`保留公开提交、管理查询和附件下载门面；后台reconciliation进入`service-reconciliation.ts`，提交/恢复共用终态提交合同进入`service-shared.ts`。
- Feedback服务、存储、契约定向回归`62/62`；M67/M72/M78 UI与源码合同定向回归`16/16`。
- complexity baseline先移除`feedback/service.ts`并出现预期`New complexity debt`红灯；拆分后复杂度债务由15降至14，新模块均低于500行且无函数超过150行。
- repository、`useFeedbackController`和`FeedbackDialog`均按风险治理ADR登记为稳定内聚保留项；Provider保持离线延期，未调用真实Provider。

D12完成证据：

- `useWorkbenchController.ts`继续作为唯一公开组合入口；项目状态/快照同步、项目动作、composer提交/恢复、产物导航和产物操作进入独立职责模块，`PromptComposer.tsx`的附件读取生命周期进入`useComposerAttachments.ts`。`MediaWorkbench.tsx`和`ProjectListItem.tsx`按ADR继续保留。
- D12定向Node源码合同`34/34`；全量`npm test`通过Node`423/423`、Vitest`776/776 + 796/796`，TypeScript、ESLint `0 error / 0 warning`和生产构建通过；standalone为`missing=[] / forbidden=[]`。
- 拆分完成后按真实复杂度报告从baseline移除`useWorkbenchController.ts`与`PromptComposer.tsx`，复杂度登记项由14降至12；新增模块均低于500行且无函数超过150行。development gate为`passed-with-offline-refactor-defer`，Provider保持`passed=false`且请求数为0。
- `npm run build`通过，standalone检查为`missing=[] / forbidden=[]`；全量ESLint为`0 error / 0 warning`，development gate为`passed-with-offline-refactor-defer`。

D13新鲜证据：

- 红测先证明视频route成功测试没有覆盖真实Provider Tool的单镜头输入：route只提交确认actionId，`generate_video_segment`却要求唯一`shotIds`；route也未把镜头写入GenerationJob `unitId`，因此真实结果血缘无法闭合。
- `video-route-generation.ts`承接视频执行协调、输入边界、Provider生命周期和共享原子commit；`route.ts`只保留GET下载、wrapper、project lease和HTTP错误映射。`shotId`与`shotIds`缺失/冲突在claim和Provider前失败关闭。
- Artifact直发客户端新增可选`shotId`，mapper和动作投影只展示有明确镜头绑定的video action；旧无镜头action不再暴露为可点击失败路径。
- 定向视频/Artifact route/VideoShot相关回归`27/27`，Node API client `18/18`，TypeScript、ESLint `0 error / 0 warning`，complexity报告从12项收缩为11项。
- Provider验证保持`passed=false`且真实请求数为0；未创建V1-9 runId，未生成图片、视频、PPTX、ZIP。

D14新鲜证据：

- Electron standalone与Playwright webServer不再注入已无消费者的`NEXT_PUBLIC_WORKBENCH_DATA_SOURCE`；共享环境拼装保留数据库、Artifact存储、端口和生产模式边界。
- container runtime使用可注入binary probe，video smoke使用结构化Provider配置，desktop installer使用共享用户数据目录合同，deploy demo使用隔离环境builder；auth和production preflight以行为结果验证边界。
- D14定向Ops Node合同`55/55`；全量`npm test`通过Node`425/425`、Vitest`776/776 + 797/797`。
- TypeScript、ESLint `0 error / 0 warning`、生产构建和standalone `missing=[] / forbidden=[]`通过；development gate为`passed-with-offline-refactor-defer`，source-contract债务由19个文件收缩至13个，complexity保持11个登记项。
- Provider保持`passed=false`且请求数为0；未创建V1-9 runId，未生成媒体、部署或发布。

## 7. 最终全量验证

```powershell
npm test
npm run typecheck
npm run lint -- --max-warnings 0
npm run build
npm run gate:development
npm run verify:local
npm run gate:manifest:verify
npm run desktop:smoke
```

随后从最终HEAD启动隔离本地实例，验证：health、登录、新建项目、普通讨论不触发Tool、单一需求规格只触发对应Tool、刷新后状态不漂移、失败只出现一次恢复入口。浏览器使用桌面视口。

## 8. 明确不执行

- 不运行`gate:provider:live`、Provider seal或release gate。
- 不调用图片、视频、PPTX、ZIP或整包Provider。
- 不创建V1-9 runId，不执行教师签收或部署。
- 不运行390px真实黑盒。

这些项目必须在最终报告列为“未验证/需另行授权”，不能写成通过。
