# V1 控制面与 assistant-ui 定向重构测试计划

日期：2026-07-14

状态：A10-A23 contract and executor passed / R5 historical pass retained / A23 start-new decision formed / unique V1-9 preflight pending

## 1. 证据规则

每条结果必须标记 `contract`、`executor`、`model orchestration`、`product E2E` 或 `release`。离线 fixture、deterministic Runtime、Node/Vitest、TypeScript和构建不得写成真实模型或R5通过。

当前阶段只运行受影响测试、控制面扩大回归、TypeScript、构建和静态审计；R5真实桌面历史证据保留且不重跑，不运行390px真实黑盒，不调用真实媒体或V1-9 Provider。

当前五层状态：

| 证据层 | 当前状态 | 本阶段边界 |
|---|---|---|
| `contract` | passed through A23 | 六个P1、事件恢复、共同A/B Orchestrator、跨恢复幂等、联合终态、Provider/Skill lock、正式 Skill Schema 与四个 Tool产物 Adapter 均有新鲜合同证据 |
| `executor` | passed through A23 | assistant-ui断线校正、精确checkpoint、错误Job恢复、ActionPolicy阻断、强制Envelope、原子结果提交及正式Schema失败关闭均通过 |
| `model orchestration` | R5 historical pass / V1-9 pending | 既有真实桌面证明动态Tool、局部视频脚本、一句话PPT候选与Observation/Replan；本轮离线fixture不新增模型证据 |
| `product E2E` | R5 historical pass / old V1-9 read-only failed / A23 new run not started | 旧run与旧锁只保留历史证据；新run在全量仓内回归和只读preflight通过前不创建、不调用Provider |
| `release` | not verified | V1-9、教师签收、切流与发布后验证尚未执行 |

## 2. 红色特征测试

| ID | 责任 | 红态断言 |
|---|---|---|
| C-P1-01 | Control first | active task在有或无pending计划时收到“暂停/取消/改道”，真实可执行Agent stub的dispatch次数必须为0；无pending改道也必须先提交IntentEpoch或等价revision |
| C-P1-02 | Task intake | 不含PPT/教案/视频关键词但明确交付的任务形成完整TaskBrief；约束、排除项和requestedOutputs不得为空或默认教案 |
| C-P1-03 | Envelope | 所有Tool（含只读Agent Tool）无任务级Envelope绑定、旧revision、错误actor/project/task/TaskBrief digest/intensity/grant/actionDigest/idempotencyKey时失败关闭 |
| C-P1-04 | Atomic commit | 在Artifact或Observation提交点注入故障后，不得出现可信Artifact无Observation/Event或Observation指向不存在Artifact |
| C-P1-05 | Single owner | native Orchestrator启用时，外层toolPlan/deliveryPlan和Runtime嵌套loop执行次数均为0；缺executor不得静默切旧路径 |
| C-P1-06 | Context snapshot | 超过8轮后早期目标、约束、排除项、IntentEpoch、未决决定和可信Artifact引用仍存在；旧摘要不得恢复逐节点确认语义 |

## 3. assistant-ui 与消息合同测试

| ID | 断言 |
|---|---|
| UI-M01 | 九类MessagePart均有版本化判别、边界验证和安全失败投影 |
| UI-M02 | 旧content无损映射text Part；新消息同时生成Parts和回退content |
| UI-M03 | Artifact、HumanGate、计划、质量和错误Part只接受服务端引用，不从正文猜测 |
| UI-M04 | MessagePart到assistant-ui消息顺序、角色、正文和引用稳定，非法Part显示安全错误且不丢消息 |
| UI-M05 | 重复/乱序事件按projectId+sequence幂等，跨项目事件拒绝，刷新后从lastSequence恢复 |
| UI-M06 | 通用编辑/重试/分支在无服务端合同时不显示，不得客户端重放副作用任务 |
| UI-M07 | 桌面长Markdown、表格、活动、HumanGate、错误恢复和输入框无重叠、裸Markdown或工程词 |
| UI-M08 | assistant-ui开关回退旧UI后消息、计划和Artifact一致，Tool调用数不增加 |
| UI-M09 | 事件到达后只有 Snapshot 成功确认包含该 sequence 才持久化游标；刷新失败或立即重载不得跳过事件 |
| UI-M10 | SSE 断线触发有界 Snapshot 校正并重新连接；快速事件合并刷新且旧响应不得覆盖新 Snapshot |
| UI-M11 | 请求 checkpointId 与 TaskAggregate 当前 checkpoint 不同则失败关闭，TurnJob和消息均不变 |
| UI-M12 | 生产执行链至少持久化 run/text/tool/decision/quality 中实际发生的事件；合成 fixture 不作为生产流式证据 |

## 4. A/B测试

固定候选集合为 `create_requirement_spec`、`create_lesson_plan`、`create_ppt_outline`，不把箭头顺序写成断言。Responses 与 Agents SDK Adapter 只负责单轮模型运输和一个 Tool 决策；共同评估 Orchestrator 独占 Observation 后的继续、Replan、重试和停止权。

新增红测：

| ID | 断言 |
|---|---|
| AB-01 | 两 Adapter 同一模型响应包含多个 function call 时均失败关闭，任何一轮最多执行一个 Tool |
| AB-02 | 失败 Observation 持久化后回到共同 Orchestrator，允许模型修输入、换 Tool 或 Replan；真实门才暂停 |
| AB-03 | checkpoint 保存 call digest、arguments digest、idempotency key 和 Observation；恢复时重复调用执行次数为0 |
| AB-04 | durable persistence 不能由空 callback 冒充；集成测试必须读取真实持久 Store 后再允许下一轮 |
| AB-05 | evaluator 只有 completed 且满足输出/轨迹合同才 accepted；同 Tool 不同参数的合法 repair 不算重复 |
| AB-06 | Agents SDK 不修改全局 tracing；A/B profile 运行时硬性 `productionEligible=false` |

Agents SDK只在官方接口、Provider兼容和服务端边界已核验后安装和运行；如果无法使用自定义Responses客户端、无法关闭SDK自有重试/状态真源或必须绕过ToolExecutionGateway，则记录为不采用，不改变现有生产Runtime。

## 5. 执行顺序

1. 每个ID先单文件红态并保存失败摘要。
2. 实现最小切片后只复跑对应文件。
3. 每组完成后运行控制面交叉回归，`VITEST_MAX_WORKERS=1`。
4. 运行`npx tsc --noEmit`、`npm run build`和`git diff --check`。
5. 保留既有R5真实桌面证据，不因仓内合同变更重复运行浏览器或390px。
6. 仓内门全绿后审计旧manifest字节不变，并按已形成的A23`start-new + predecessorRunId`决定执行只读preflight；preflight通过前不创建新run、不调用Provider。

### 5.1 A15 新增特征测试

| ID | 断言 |
|---|---|
| A15-01 | native Tool loop 已持久化 completion checkpoint 后，外层 runtime failure 只能追加 Observation；教师消息和 TaskAggregate checkpoint 不得被旧 metadata 覆盖 |
| A15-02 | V1-9 runner 优先保存 checkpoint Observation refs；checkpoint缺失时从产品 Snapshot 的持久 Observation 去重恢复，不得写空恢复入口 |
| A15-03 | `IMAGE_PROVIDER_CHANNEL=minimax` 时 preflight 与 capability availability 只接受 API 台账声明的 MiniMax key/base/model；其他图片通道不能满足 V1 MiniMax 门 |
| A15-04 | 图片 Adapter 调用 MiniMax 原生 `/v1/image_generation` 合同并保存 `provider=minimax` 血缘；失败不调用其他图片 Provider、CLI或fallback |

### 5.2 A16 完成性复核特征测试

| ID | 断言 |
|---|---|
| A16-01 | native生产入口首次接收明确交付任务时，TaskBrief的requestedOutputs、constraints与excludedOutputs只能来自同一Main Agent的严格结构化TaskProposal；缺少intake能力时失败关闭，不得回退关键词正则 |
| A16-02 | 无pending plan的自然语言改道先递增IntentEpoch，再由结构化TaskProposal形成新范围；迟到旧结果不能提升，控制识别不得继续决定业务输出集合 |
| A16-03 | Provider健康证据的`testedAt`必须严格晚于当前`recovery.healthEvidenceNotBefore`；旧manifest迁移时至少晚于最新恢复停止时间，不得因更早的Provider lock rotation而放宽 |
| A16-04 | 启动恢复必须读取并验证真实健康证据、active pointer和manifest Provider lock，只能重排manifest绑定的同一project/task/IntentEpoch/teacher message/TurnJob；任意ID、旧证据、其他失败Job和不匹配失败类型均为0重排 |
| A16-05 | 本地API台账私有归档、PRIVATE-LOCAL-SECRETS及其通用ZIP名称均被Git忽略；校验不得读取或输出密钥值 |

### 5.3 A17 ExecutionEnvelope 与真实路由原子提交特征测试

| ID | 断言 |
|---|---|
| A17-01 | `ToolRouter` 缺失 `ExecutionEnvelope` 时返回 `execution_envelope_required`，内部、Provider 与 package executor 调用次数均为0；无效或与 project/IntentEpoch 不匹配的 Envelope 同样失败关闭 |
| A17-02 | image、video、coze-ppt 三条真实 artifact route 只能从当前 TaskAggregate 与认证 actor 构造 Envelope，并在创建 GenerationJob 或调用 Provider 前经统一 `ToolExecutionGateway` 对账 actor/project/task、TaskBrief digest、IntentEpoch、plan revision、强度、授权、action digest 和幂等键；缺 TaskAggregate、旧 revision 或未授权时调用次数均为0 |
| A17-03 | 三条路由的可信成功结果必须通过统一控制面事务终结同一 Invocation，并一起提交 ValidationReport、Observation、Artifact、`artifact_committed` Event 与 GenerationJob 成功态；任一事务成员注入失败时这些成功事实全部回滚 |
| A17-04 | 三条路由源码与集成测试均不得再调用旧 `commitGenerationResult`；Provider 调用前已存在运行中 Invocation，失败只持久化失败 Observation/Event，不生成 fallback 或可信 Artifact |

### 5.4 A18 assistant-ui 一致性特征测试

| ID | 断言 |
|---|---|
| A18-01 | blocked TurnJob 的终态只能发布未完成事件并保留 `status=blocked`；同一 run 不得出现 `run_completed` |
| A18-02 | 普通 Snapshot 与事件刷新 Snapshot 必须经过同一项目级单调水位；较新的提交 Snapshot 已应用后，旧在途事件响应不得覆盖消息、任务或成果状态 |
| A18-03 | Markdown 链接只允许有效 `https` 外链或解析后仍为同源的站内绝对路径；`//evil.example`、斜杠反斜杠变体和脚本协议必须降级为纯文本 |
| A18-04 | assistant-ui 回退开关只在服务端动态请求边界求值；运行时切换只选择一个 UI Runtime，不得依赖构建时静态页面常量或同时挂载新旧线程 |

### 5.5 A19 Skill Runtime 与 MiniMax 血缘特征测试

| ID | 断言 |
|---|---|
| A19-01 | Provider 型业务 Tool 只能收到与当前 Tool 绑定的类型化 Skill semantic slice 和 provenance；slice 必须绑定 Tool 名、Skill 名称/版本、合同与引用摘要，不得包含完整 `SKILL.md`、Provider 选择、重试、停止或下一 Tool 指令 |
| A19-02 | runtime projection 在懒加载入口和每个选定文件读取后重新核对对应 lock digest；Registry 打开后发生的入口或 reference 篡改必须在内容进入 Tool 前以 `skill_runtime_lock_digest_mismatch` 失败关闭 |
| A19-03 | Skill 加载失败只能发生在 `startToolInvocation` 成功之后；同一原子提交必须终结 failed Invocation，并保存 ValidationReport、失败 Observation 与 teacher-safe Event，Artifact 数为0，且不得回退无 Skill 执行 |
| A19-04 | 每条 Skill-bound Tool policy 必须声明 consume/produce 合同，并同时与 Tool 的 required/produced artifact 和 Skill descriptor 合同相容；缺失、版本不容或方向颠倒均在 preflight 失败关闭 |
| A19-05 | `generate_classroom_image` 与 `generate_video_assets` 的 Prompt 必须从当前 TaskBrief、Tool 参数和对应可信上游语义形成；非数学或独立创意短片 fixture 不得出现“六年级数学百分数公开课”硬编码，局部视频资产不得扩张为教案、PPT、成片或整包 |
| A19-06 | MiniMax 图片成功结果必须绑定 `provider=minimax`、实际 model、宽高、原始文件和规范化文件；两者各自保存 bytes、MIME、SHA-256 和 locator，Artifact/Provider payload 中 provenance 一致；任一文件或摘要缺失不得成为生产成功产物 |

### 5.6 A20 Provider 台账与发布门特征测试

| ID | 断言 |
|---|---|
| A20-01 | Agent Brain channel、base URL、model、reasoning 和 credential source 完全相同但凭据值轮换时，config digest 必须变化；摘要与序列化配置不得包含凭据明文或可逆片段 |
| A20-02 | V1-9 Provider lock 和健康 evidence 使用同一含凭据指纹的 config digest；旧 key 生成的成功 evidence 在换 key 后必须失败关闭且 Provider 请求数为0 |
| A20-03 | production preflight 不得接受普通 `OPENAI_*` 作为 Main Agent Runtime，也不得把未知 `AGENT_BRAIN_CHANNEL` 默认成 primary；只接受台账声明的 selected channel 字段 |
| A20-04 | V1 图片发布门只接受 `IMAGE_PROVIDER_CHANNEL=minimax` 与台账声明的 MiniMax key/base/model；旧 `free`/`primary` 图片通道不能满足生产门 |
| A20-05 | MiniMax TTS 发布门只接受台账 manifest 声明并由 Runtime 使用的 key/base/model 字段；未声明别名或仅有图片 key 不得冒充 TTS 就绪 |

### 5.7 A21 Agent Tool 失败归因特征测试

| ID | 断言 |
|---|---|
| A21-01 | 未注册 Tool、失效 Envelope、参数或绑定错误均返回非 HumanGate Observation，`nextAction` 为 `fix_inputs` 或 `skip_or_replan`，不得为 `ask_teacher` |
| A21-02 | Director/Critic 输出或修复合同不合法时，具体 reasonCode 和 Observation 返回 Main Agent，Artifact 为0，教师决策为0 |
| A21-03 | 只有 actor/项目/任务授权缺失时返回 `blocked_by_policy + ask_teacher`；Executor 暂不可用或传输异常只返回有界 `retry_later`，重试耗尽后诚实暂停 |

### 5.8 A22 业务 Skill 标准反馈特征测试

| ID | 断言 |
|---|---|
| A22-01 | 旧 `shanhai-delivery 1.1` 保留，注册表只激活新版本目录；目录、注册版本、Schema 路径、发布包和 Runtime 投影版本一致 |
| A22-02 | `shanhai-video`、产品基线与活动 `shanhai-delivery` 对完整视频统一为 30–90 秒；交付 Skill 不得要求 60–120 秒或固定“最后35%”锚点，只验证独立故事闭合后的一次最小回接 |
| A22-03 | `create_final_package` 由 Main Agent 选择后才加载 `shanhai-delivery` 的 Tool 专属 semantic slice；slice 只含持久 package asset、一致性、版本、血缘和文件真实性规则，不含下一 Tool、重试、授权、Provider 或停止指令 |
| A22-04 | 最终包缺少正式持久 package asset、组件跨 task/IntentEpoch、版本非当前、未验证或文件摘要不匹配时失败关闭；不得现场拼 ZIP 或把旧包/降级包标成当前成功 |

### 5.9 A23 正式 Skill Schema 执行特征测试

| ID | 断言 |
|---|---|
| A23-01 | Registry 模式和 Runtime projection 模式均把 `schema_path` 安全绑定到当前 Skill 根；投影按 lock 的 `sourceDirectory -> runtimeDirectory` 映射，缺文件、越界、无效 Draft 2020-12 Schema、`schemaVersion.const` 与合同版本不一致或 suite version 漂移均失败关闭 |
| A23-02 | 六个 `formal_contract` Tool 的每个 consume/produce Adapter ID 都有真实注册实现；图片单图与PPT批次、视频单镜头和最终包都能确定性投影到当前正式 Skill payload，未知 Adapter 不得按 identity 猜测 |
| A23-03 | `shanhai-imagegen`、`shanhai-video-generation` 与 `shanhai-delivery` 保留旧目录并升级活动版本；新正式 Schema 只描述事实、血缘和质量，不包含 Provider 选择顺序、fallback、重试、停止或下一 Tool 指令 |
| A23-04 | `create_final_package` 与其他 formal Tool 均收到 Tool 专属 Skill context；Tool 成功结果必须在 `commitToolResult` 前通过对应 Skill Schema。删必填字段、错版本、额外字段或错误 Adapter 时保存 failed ValidationReport/Observation且 Artifact 为0 |
| A23-05 | Schema 原文和绝对路径不进入模型或 Provider 输入；上下文只携带 Tool 专属语义、合同身份和不可逆摘要。`guidance_only` 继续由 Tool 合同负责，不执行正式 Skill Schema |
| A23-06 | 运行时使用服务端直接依赖的 Draft 2020-12 Validator，不启动 Python 子进程；Schema 文件在读取前后复验 projection lock，冻结 Skill/Policy digest 不匹配时零 Tool 执行 |

## 6. R5、V1-9与发布

- R5必须形成R-A01至R-A18、R-U01至R-U06的真实桌面证据，外部Codex运行中编排介入为0。
- R5关闭后才执行唯一一次V1-9真实全链路；真实PPTX、MP4、课程锚点、ClassroomRunSpec和版本一致ZIP只在该阶段验证。
- V1-9通过后才进入教师签收与V1-10；`release`证据必须包含候选环境、回滚、当次授权切流和发布后复核。

## 7. 红态证据

`contract / expected red`：2026-07-14 首次执行以下 8 个新特征测试，Vitest 正常启动，结果为 `8 failed / 0 collected tests`。所有失败均来自预期的新边界模块尚不存在，不是 Provider、浏览器或 SQLite 问题；该记录不代表 `executor`、`model orchestration`、`product E2E` 或 `release` 已验证。

```text
conversation-message-contract
agent-event-envelope
task-intake-contract
pre-agent-control
execution-envelope-gateway
atomic-tool-result-commit
single-orchestrator-runtime
context-semantic-snapshot
```

该红态只证明测试先于实现存在；后续每个切片必须保留对应绿态命令和扩大回归证据。

`contract / executor / expected red (A17)`：2026-07-15 以单 worker 执行
`npx vitest run tests/artifact-route-execution-envelope.test.ts --maxWorkers=1`，结果为
`1 file failed / 3 tests failed`。失败分别证明：缺少 `ExecutionEnvelope` 时 Provider executor 仍被调用；
离线 image route 成功后数据库中 `ToolInvocationRecord` 为0；三条真实 artifact route 仍引用旧
`commitGenerationResult`/`resumeStagedGenerationResult`，且尚无共享 Gateway/原子提交边界。该红态没有发送真实 Provider 请求，
不构成 model orchestration、product E2E 或 release 证据。

`contract / executor / expected red (A18)`：2026-07-15 单 worker 首次执行终态、Snapshot 水位和安全链接特征测试，结果为
Vitest `3 files failed / 8 tests failed / 4 tests passed`；另行投影测试为 `1 failed / 4 passed`，Node Runtime 合同为
`1 failed / 2 passed`。失败分别复现 blocked 写成 `run_completed`、普通与事件 Snapshot 无共同提交水位、协议相对链接被放行、
blocked 投影成 failed，以及根页面缺少动态运行时边界；全程未发送 Provider 请求。

`contract / executor / expected red (A19)`：2026-07-15 使用单 worker 运行 Skill Runtime、Provider adapter、
MiniMax 图片桥和 Invocation 持久化特征测试，结果为 Vitest `6 files failed / 6 tests failed / 54 tests passed`。
六个失败分别证明：完整 `SKILL.md` 仍被作为 instructions 暴露而没有 Tool 专属 semantic slice/provenance；Registry 打开后
reference 可被替换并进入 Loader；绑定 preflight 不对账 consume/produce；Skill 加载失败发生在 Invocation 创建前；
图片 Prompt 仍硬编码“六年级数学百分数公开课”；图片成功结果仍使用 `provider=image_asset` 且缺少模型、尺寸、原始与
规范化文件双摘要。该红态只使用离线 fixture 和注入 executor，没有发送 Provider 请求，也不构成 model orchestration、
product E2E 或 release 证据。

## 8. 绿态与阶段交接证据

`contract / executor / passed`：2026-07-15完成六个P1、assistant-ui消息Runtime、A/B隔离、Skill Tool边界、PPT候选责任分层和失败诊断贯通。最终门为Director新合同`11/11`、Runtime/Capability/Observation定向`57/57`、Node`287/287`、Vitest`152 files / 1039 tests`、TypeScript、生产构建14页面、API台账独立校验和`git diff --check`全部通过；构建保留5条既有Turbopack动态文件模式警告。

上述绿态是独立审计前的历史证据，只作为演进记录。R5真实桌面在`test-results\m67-e2e-21008-1784056471438\`以`1 passed / 1 skipped`形成的产品证据保留且不重跑；A10-A23 的最终新鲜门见本节末尾。390px按V1前门禁不运行。

2026-07-15接管复核又关闭三项此前被closeout写重的边界：assistant-ui以持久`lastSequence`续接teacher-safe事件、文本事件进入typed Part、checkpoint恢复复用同一failed TurnJob且目标Runtime关闭固定轮询；V1-9 Skill manifest lock在应用懒加载时再次核对；Responses/Agents SDK A/B从生产Tool Registry投影同一三Tool合同，并绑定完整checkpoint与Observation持久回调。Agents SDK仍为`evaluation_only / productionEligible=false`，没有替换生产Responses Runtime。新鲜集成门为Node`294/294`、Vitest`162 files / 1106 tests`、TypeScript和14页面生产构建通过。

`contract / executor / passed (A17)`：2026-07-15 将可执行 `ToolRouter` 改为缺少或失效
`ExecutionEnvelope` 时失败关闭，并把 image、video、coze-ppt 三条真实 artifact route 收口到共享 Gateway/控制面提交边界。
明确离线 MiniMax fixture 验证当前 TaskAggregate/actor 绑定、零 TaskAggregate 时零 Job/Provider、以及成功时同一 Invocation 对应
Observation、Artifact、`artifact_committed` Event、ValidationReport 与 GenerationJob；三条路由不再引用
`commitGenerationResult` 或 `resumeStagedGenerationResult`。定向 Vitest 为 `6 files / 67 tests`，相关 Main Agent、Provider Adapter、
Capability 与 Gateway 扩大回归为 `5 files / 68 tests`，Node 路由合同 `1/1`，TypeScript 与 scoped `git diff --check` 通过。
以上只关闭仓内 contract/executor，不是 Provider、R5 或 V1-9 证据。

`contract / executor / passed (A18 scoped)`：2026-07-15 单 worker 定向转绿为 Vitest `4 files / 17 tests`、Node
`3/3`；assistant-ui 消息、游标、事件、提交与终态交叉回归为 Vitest `8 files / 28 tests`、Node `8/8`，
`git diff --check`通过。全量 `npx tsc --noEmit` 仍被并行 A16/A17 的4个已知类型错误阻断，未出现 A18 文件错误；
因此这里只关闭 A18 定向合同与执行器证据，不声明控制面整阶段、model orchestration、product E2E 或 release 通过。

`contract / executor / passed (A19 scoped)`：2026-07-15 将完整 `SKILL.md` 从业务 Tool 输入移除，按当前 Tool 编译
类型化 semantic slice，并绑定 entrypoint/reference/policy digest provenance；runtime projection 在每次入口和 reference
读取前后复验 lock；所有 Skill-bound policy 同时对账 Tool 与 Skill 两侧 consume/produce。Skill 加载失败已前移到
Invocation claim 之后，并原子保存 failed Invocation、`targetKind=tool_invocation` ValidationReport、Observation 和
`tool_observed` Event，Artifact 为0，终态重放不再次加载或执行。图片 Prompt 改由当前 TaskBrief、Tool 参数、Skill slice
和可信上游形成；MiniMax 图片保存原始与规范化两份文件、双 SHA-256、模型、尺寸和真实 Provider 身份。

原六文件红测转绿为 Vitest `6 files / 61 tests`；Skill、Runtime、Provider adapter、Gateway、control-plane 和 stage30
扩大回归为 `16 files / 147 tests`。真实 runtime projection 离线 preflight 为 `ready / 7 active Skills / 21 bindings`，
`generate_video_assets` 实际加载检查确认没有 raw instructions、Provider 顺序、fallback、重试或下一 Tool 指令。
该证据没有发送图片、视频、PPTX、ZIP、Main Agent 或 V1-9 Provider 请求，只关闭 A19 的仓内 contract/executor。

`contract / executor / expected red (A23 fixture alignment)`：2026-07-15 使用显式
`DATABASE_URL=file:./.tmp/test-workbench.db` 和单 worker 运行
`tests/agent-runtime/main-agent-tool-loop-config.test.ts`，结果为 `1 file failed / 3 tests failed / 23 tests passed`。
三个失败均为旧基础设施测试在调用正式 `generate_ppt_sample_assets` 时未注入 `businessSkillRuntime`，因此正确收到
`skill_runtime_config_missing`；生产 fail-closed 规则未放宽。

`contract / executor / passed (A23 final)`：为上述三个离线测试注入同一
`shanhai-imagegen 1.1 / shanhai-imagegen/v2` formal Runtime stub，`loadForSelectedTool` 返回
`generate_ppt_sample_assets` 专属语义合同，`validateSelectedToolResult` 返回绑定
`image-result-batch.v2` 的通过证据。单文件转绿为 `1 file / 26 tests`；A23 定向为
`9 files / 132 tests`，控制面扩大回归为 `24 files / 247 tests`。

最终仓内门：`npx tsc --noEmit` 通过；`VITEST_MAX_WORKERS=1 npm test` 为 Node `302/302`、Vitest
`185 files / 1343 tests`；`npm run build` exit 0并生成13个静态页面，保留12条既有Turbopack动态路径警告；
Skill suite `53/53`，`shanhai-imagegen-1.1`、`shanhai-video-generation-1.1`、`shanhai-delivery-1.3`
的UTF-8 `quick_validate`均通过；`git diff --check`通过。活动Runtime projection离线preflight为
`ready / 8 active Skills / 21 bindings`，projection digest为
`4d2158e8c0e01f96bd677c4bf46a3b5d5ac1caff6c17d849f7077f59028855aa`，binding policy digest为
`3dbabbcef958225c69bb68716230a12dab1bd05e6380bd6105d16663da78d62c`。

唯一V1-9 manifest的SHA-256在本轮前后均为
`a7bae74ce472f9826dae9e85ab096b787f77527a153df4defc73bce0d2db698c`，仍绑定旧Skill projection/policy lock；
本轮没有静默改写manifest，没有调用Main Agent、图片、视频、PPTX、ZIP或V1-9 Provider，也没有运行Playwright或390px。
因此A10-A23只关闭`contract`与`executor`；`model orchestration`、`product E2E`与`release`状态不因这些离线证据上移。
