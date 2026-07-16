# V1-9 唯一真实产品 E2E 计划

更新时间：2026-07-16

状态：`A23 new unique run authorized / immutable baseline contract and offline preflight in progress`

## 1. 目标

在 V1-9R0 至 R5 已关闭的基础上，只修复唯一一次真实产品全链路启动前仍可离线证明的仓内阻塞；仓内门全部通过后，由教师从产品 UI 提交一次完整材料包目标，产品 Main Agent 自主完成教案、可编辑 PPTX、课堂视觉图、独立创意导入视频、唯一最小课程锚点、`ClassroomRunSpec` 和版本一致 ZIP。

外部 Codex 只负责工程实现、证据审计和最终包只读黑盒验收，不选择 Tool、不批准创意、不机械点击中间产物、不手工补包或拼包。

## 2. 当前权威事实

- assistant-ui、MessagePart、AgentEventEnvelope、六个 P1、ExecutionEnvelope、原子 Tool 结果提交、单一编排者、跨轮语义快照和 Responses/Agents SDK 隔离 A/B 已通过仓内门。
- R5 真实桌面已通过；V1 发布前不运行新的 390px 黑盒。
- R5 只验收自主控制面和结构化候选，没有调用真实图片、视频、PPTX 或 ZIP Provider。
- 旧 `local-real-v1-v1-9-product-e2e-hardening-*` 是 FFmpeg 时间线硬化历史阶段，不是本次唯一真实运行的 runner 计划。
- 旧 M56 和 Stage 41 由外部脚本串联、路由替身或机械批准，不得作为产品 Main Agent 自主编排证据。
- 历史运行`v1-9-20260714212914-a036beb9`曾由教师UI提交一次目标并形成需求、教案、PPT大纲、视频脚本、57秒分镜、资产说明和真实旁白等Artifact，随后在旧合同与旧Provider状态下暂停。其manifest、runId、SQLite、Artifact、Observation和旧Skill/Provider lock只读保留为历史失败证据，不恢复、不改写，也不再寻找旧投影。
- 2026-07-15用户已授权按A23更新后的最新合同创建新的唯一运行。业务 Skill 权威源仍为集合根既有`shanhaiedu-技能系统`，未切换到`ShanHaiEdu-Conversion-Studio`；A23 Runtime Projection只是该源的冻结投影。新运行以启动时的当前`main`、最新需求基线、该源的活动Registry、A23 Runtime Projection、最新Binding Policy和Provider台账为执行基线；新manifest必须在任何产品/Provider请求前一次性冻结这些非敏感摘要及前序历史引用。
- 2026-07-15 仓内前置门已关闭：21 个高层业务 Tool 均有精确 `skill` 或 `exempt` policy；V1-9 强制 required Skill Runtime；`shanhai-video@1.2`、reference 最小集、projection lock digest 与 binding policy digest 已经由真实本地投影校验。

## 3. 启动前必须关闭的 P0（仓内已关闭）

### 3.1 TaskBrief 绑定预算与统一真实调用台账

- 删除全局固定 `3` 次外部 Tool 调用上限作为所有标准任务的共同预算。
- 预算估算由版本化标准生产 profile 根据 `TaskBrief.requestedOutputs`、标准页数和标准镜头上限生成；ActionPolicy 只执法，不自行推断业务规模。
- 预算披露和升级必须写回同一 `IntentGrant`；升级确认后不得在下一 Tool 重复提出同一升级。
- 只有 Provider Adapter 已真实提交外部请求才消耗预算；资格过滤、参数校验、HumanGate 阻断和未提交失败不计费。
- Native function-call loop 与兼容外层必须读取同一持久调用台账，不能一条路径只在内存计数、另一条路径跨轮归零。
- MiniMax TTS 不能藏在 `assemble_video` Package Adapter 内作为未计费内部动作；必须进入显式 Provider Tool/Adapter、Observation 和同一预算台账。

### 3.2 长任务分段与可恢复 checkpoint

- 完整材料包不能被固定 8 Tool 轮次变成人工“继续处理”流程。
- 仍保留每段有界轮次、同一 Tool 重复失败两次熔断、任务级费用上限和真实 HumanGate。
- 达到内部段预算时，必须把 `TaskAggregate.checkpoint`、plan revision、SemanticContextSnapshot、Observation refs 和事件序列原子持久化，再由同一产品 Orchestrator 自动续段；taskId、IntentEpoch、项目和幂等键不变。
- 进程重启后只允许从同一 SQLite、同一项目、同一 TaskAggregate 和同一 checkpoint 恢复；不得新建第二个完整任务或重复提交已接受的 Provider 单元。
- 重复失败、授权缺失、真实预算升级、外发/破坏性副作用仍诚实暂停，不自动循环。

### 3.3 Skill Runtime 强制预检与版本锁

- V1-9 profile 必须在启动 Next、创建任务或调用 Provider 前完成 Skill Runtime eager preflight。
- 缺少 `SHANHAI_SKILLS_RUNTIME_ROOT`，或direct-registry模式缺少成对`SHANHAI_SKILLS_REGISTRY_PATH + SHANHAI_SKILLS_ROOT`时失败关闭；runtime projection模式与direct-registry模式同时配置才属于双运行来源冲突。`SHANHAI_SKILLS_SOURCE_ROOT`只用于既有`shanhaiedu-技能系统`的血缘与冻结核对，不是第二个运行来源。
- 全部业务 Tool 绑定必须解析到 active Skill；Skill 只增强当前 Tool，不能返回下一 Tool 或接管 Main Agent。
- runtime projection lock 的 `contentDigest` 必须实际校验，不能只读取后丢弃。
- 普通开发环境可保持 Skill optional；V1-9 profile 必须 required，失败只返回稳定 reasonCode，不输出密钥或 sidecar 内容。

### 3.4 生产 Tool 可达性与质量信任边界

- 向 Main Agent 暴露当前实现且合格的课堂视觉图 Tool；最终包所需正式图片不能依赖 PPT asset bundle 冒充。
- Provider/Package Adapter 的可信输入判断必须与 `artifactQualityState` 一致：内部验证和独立 Critic 已通过、`downstreamEligibility=eligible` 的 `needs_review` 产物可以继续标准任务下游，但不等价于教师签收。
- 不允许 Adapter 再以 `status=approved && isApproved=true` 强制每个媒体节点人工批准。
- 最终视频的内部 Critic 通过证据必须独立于教师 approve 写入；最终包不得把内部质量通过重新绑定为机械教师审批。
- `ppt_design_draft` 候选仍只能进入 `production_design_expansion`；没有正式 `PptDesignPackage` 时媒体生产继续失败关闭。
- 最终 PPT 页数绑定 TaskBrief 目标；最终视频必须为 30 至 90 秒，不再接受 15 至 29 秒作为 V1-9 成片。

### 3.5 只观察型、可恢复的唯一运行 runner

- 复用 M67 的独立 SQLite、独立 Next app root、动态端口和单 worker 隔离壳，但新增稳定 run manifest 和恢复入口。
- start 只允许 UI 登录、新建一个项目并发送一次冻结的完整目标；运行期不允许 `page.route`、直接创建 Artifact、调用生成端点、选择 Tool、批准创意或点击中间审批。
- runner 的只读观察可以读取 snapshot、下载最终 ZIP 并保存脱敏证据；允许的 UI mutation 必须由 ledger 实际记录，`externalCodexOrchestrationCount` 不能硬编码为 0。
- resume 绑定同一 runRoot、SQLite、artifactRoot、projectId、taskId、IntentEpoch、prompt digest 和 checkpoint；新动态端口和新 app process 不代表新任务。
- 出现 typed PendingDecision 时 runner 停止并留证，不替教师作实质选择。

### 3.6 唯一真实运行与局部返修

- 仓内门通过后只启动一次完整目标，不做等价探针或第二个完整项目。
- Main Agent 动态选择 Tool，Director/Critic 只在存在可信审查目标时按需调用。
- Provider 或质量失败只返修受影响页面、镜头或版本；复用未受影响 Artifact、GenerationJob 和幂等提交。
- 最终包形成后，外部 Codex 只生成只读 `ExternalAcceptanceReport`。

### 3.7 Main Agent通道失败与同任务恢复

- V1-9 preflight必须按`AGENT_BRAIN_CHANNEL`验证实际选中的Responses通道，拒绝未知通道，并核对该通道的credential、Base URL、model、reasoning effort和非敏感配置digest；不能固定检查未选通道，也不能漏验fallback。
- Main Agent Adapter失败必须形成稳定分类，至少把phase、reasonCode、retryability和脱敏summary写入Assistant Message、AgentObservation、ConversationTurnJob和runner恢复证据；不能只写控制台后退化为通用`turn_failed`。
- `failed_retryable` TurnJob在`attempts < maxAttempts`时保持同一teacherMessageId、taskId、IntentEpoch、TaskBrief digest和幂等键。只有存在新的选中通道健康/配置证据时，产品恢复器才可重新入队；没有新证据时进程重启不得等价循环。
- 恢复由产品服务端拥有，不要求observer点击重试或再次发送目标。预算耗尽、不可恢复失败或相同健康证据再次失败时诚实暂停并保存恢复入口。

### 3.8 选中通道健康证据合同

- V1-9恢复证据必须由专用探针直接复用产品`pickOpenAICompatibleConfig`和Provider ledger，不能继续以读取`.env`直配的通用`openai-smoke.mjs`作为恢复依据。
- 探针在任何Provider请求前先核对当前run manifest中的`providerLock`；channel、model、Responses endpoint category、reasoning effort、credential source或config digest任一不一致时请求数必须为0。
- 探针只提交一次最小严格结构化文本Responses请求，`maxRetries=0`且`retryCount=0`。成功证据写入API台账的不可覆盖evidence目录，并只保存非敏感身份字段；不得记录credential或原始Base URL。
- fresh run离线preflight不要求Provider健康证据。只有同一冻结run因暂时Provider故障进入`paused_recovery/failed`后的resume preflight，才必须读取`V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID`对应台账证据，验证ID、Provider身份、冻结配置、成功状态、请求/重试计数，并确认`testedAt`晚于该run最近一次失败或暂停时间。
- 通用smoke、不同channel/model/config digest的成功、手写任意ID、旧于本次403的结果或失败证据一律只作诊断，不得触发TurnJob重新入队。

### 3.9 Provider台账配置修复与锁历史

- 项目`.env`不是产品Runtime真源。若用户更新的通道配置尚未同步到`API台账系统\PRIVATE-LOCAL-SECRETS`，必须先通过不回显值的原子同步器写入台账；只同步明确选择的channel字段，保留其他Provider和未选择通道。
- 历史运行曾允许在严格授权失败条件下轮换Provider lock；该机制只保留历史证据，不适用于A23新运行。
- 新run一旦创建，Provider lock和各媒体Provider非敏感配置摘要不可修改。凭据、Base URL、模型、通道、reasoning、模式或运行时合同任一实质变化都终止当前run并创建显式后继，不在同一manifest写`providerLockHistory`继续执行。
- fresh run离线preflight不要求恢复健康证据；只有未发生任何冻结配置变化、同一run因暂时Provider故障进入`paused_recovery/failed`时，才可用晚于停止点且完全匹配原锁的新健康证据恢复同一任务。

### 3.10 TaskBrief语义优先与合同修复恢复

- 新配置真实运行证明：项目元数据为空时，业务Tool的grade/subject/topic不能回退到“未命名项目”等UI标题；必须先从当前TaskBrief goal解析，再使用安全默认。该语义解析由对话入口和Main Agent Tool执行边界共享，不能各自实现不同规则。
- PPT候选校验必须把`grade_mismatch`、`subject_mismatch`、`topic_mismatch`、`target_slide_count_mismatch`或投影校验issues写入ToolObservation和Main Agent continuation；不得把不同原因压成同一`ppt_design_candidate_semantics_invalid`后盲目等价重试。
- 历史运行的`contract_repair`加额机制不再用于A23新run。若仓内合同或执行代码发生实质修复，当前run终止为历史证据，修复通过仓内门后创建显式后继；只有合同与源码摘要均未变化的暂时执行故障才允许同run恢复。

### 3.11 外部审核轮次与产品内定点返修

- `ExternalAcceptanceReport`按`auditRound`版本化、不可覆盖保存。每轮必须绑定同一run、冻结manifest、正式package Artifact ID、package版本与ZIP SHA-256；外部Codex业务Tool调用、Artifact修改、教师批准和手工重打包计数必须均为0。
- 首轮可审查完整package。若存在P0，不丢弃报告、不关闭active pointer，也不重跑整条任务；run-state进入typed `external_acceptance_repair_required`，持久保存report digest、open finding IDs、责任层、设计/漏洞反馈及由locator确定性推导的affected units。
- repair handoff只包含同一审核报告中的open findings、affected units和“保留未列出版本”约束。关闭器不得选择或调用业务Tool，不得生成第二条教师消息，也不得把外部Codex变成返修编排者。
- 产品控制面通过专用external-audit evidence ingress验证run/project/task/IntentEpoch/TaskBrief/TurnJob绑定，并原子持久化同一Observation、TaskAggregate checkpoint、SemanticSnapshot/Event引用和同一TurnJob恢复入口。随后仍由原产品Main Agent读取Observation，自主选择合法Tool、repair或Replan。
- 进程启动恢复必须使用独立的v2 external-audit authority：只读交叉验证active pointer、manifest SHA、run-state、不可变repair handoff及数据库中已排队的同一TurnJob；handoff文件SHA、handoff digest、actor/project/task/IntentEpoch/TaskBrief、teacherMessage、TurnJob和已提交plan revision任一漂移都失败关闭。该分支只负责drain ingress已经排队的原Job，不借用Provider健康证据、不再次requeue、不新增教师消息或完整任务。
- Main Agent只能修改affected units指向的页面、镜头或Artifact版本；未列出的版本、GenerationJob和Provider提交保持不变。形成新的正式package版本与SHA-256后，才能开启下一audit round。
- 第二轮及以后只允许复验上一轮仍open的P0 finding IDs及其affected units；不得把targeted recheck扩张为全包重做。只有当前轮P0=0且全部历史P0均有closure evidence时，run-state才可进入`completed`并最后关闭active pointer。

### 3.12 Frozen Next app唯一运行合同（仓内P0）

- A23 runner不得从运行期间仍可变化的仓库源码直接启动Next或observer。每个fresh run必须冻结实际执行依赖闭包；当前最小闭包包括`src/`、`public/`、`config/`、运行所需`fixtures/`、`package.json`、`package-lock.json`、`tsconfig.json`、`next-env.d.ts`、`postcss.config.mjs`、本次`M67_E2E_SPEC`指向的实际V1-9 observer spec、`tests/e2e/support/feedback.ts`及其相对依赖`tests/e2e/support/redline.ts`、`scripts/lib/v1-9-e2e-contract.mjs`、`scripts/lib/evidence-sanitizer.mjs`和`scripts/lib/v1-9-final-package-selection.mjs`，另在冻结树内生成专用`next.config.mjs`。闭包必须随真实import/执行依赖增减，不能只冻结页面源码或直接import文件而漏掉传递依赖、runner合同模块、配置或fixture。
- root `fixtures/`同时必须进入manifest的`baselineLock.runtimeSourceDigest`，不能只在freeze复制时才出现。Coze及其他运行时会通过相对路径读取其中真实fixture；创建manifest后任一fixture字节、路径或类型变化都必须使只读preflight报告baseline drift，并在Next、Main Agent和全部Provider请求数为0时失败关闭。
- fresh freeze必须先计算`source-before`摘要，在同一canonical runRoot下创建唯一owned staging并复制闭包，再计算`source-after`和staging copy摘要；三者必须满足`source-before = source-after = staging copy`。生成专用`next.config.mjs`后再计算完整frozen tree摘要，任何不等都失败关闭。
- staging的父目录必须显式创建；staging完整校验并以`wx`写入marker后，才允许通过同卷原子rename发布为最终`next-app-frozen`。目标已存在、复制失败、摘要漂移、marker失败或rename失败时只清理由本次拥有的staging，不得留下或覆盖半成品final，也不得污染既有runRoot内容。
- marker固定使用`m67-frozen-app.v3`，只接受`schemaVersion`、`runId`、`manifestSha256`、`frozenAt`、`copiedEntries`、`sourceEntriesDigest`、`copiedEntriesDigest`、`frozenEntries`和`frozenEntriesDigest`；全部摘要为`sha256:<64hex>`。marker必须同时绑定当前runId、不可变manifest SHA、源码闭包摘要、复制摘要和完整冻结树摘要，resume不能只凭目录存在或旧marker继续。
- `start-new`与`resume`只能由显式`V1_9_RUN_MODE`和同一`v1-9-run-state.v2`决定，outer runner还必须把manifest身份作为`V1_9_E2E_RUN_ID`与`V1_9_E2E_MANIFEST_SHA256`传入冻结harness；禁止通过SQLite是否存在推断恢复。`start-new`拒绝既有final；`resume`要求run-state状态合法、同runId/manifest SHA的marker、同一SQLite/Artifact root/task合同和未漂移冻结树，不得再次提交教师目标。
- Windows路径必须先做词法owned-child检查，再沿runRoot、staging、final及闭包条目的每一级祖先执行`lstat`，拒绝junction、symlink或其他reparse跳转；目录创建后还必须以`realpath`复核canonical containment。任何路径逃逸、canonical根变化或不可判定reparse均失败关闭，不能依靠字符串前缀判断所有权。
- configured frozen模式启动Next时，child process的`cwd`必须是最终frozen app根，不能继续使用live repository root；因此服务端通过`process.cwd()`读取的Node Contract、PPT fixture及其他相对资源只能来自同一冻结`config/fixtures`。Playwright仍通过冻结observer spec绝对路径观察，不能因cwd切换回读live source。
- outer V1-9 runner必须显式传入`SHANHAI_V1_9_REPOSITORY_ROOT=<canonical repo root>`。V1-9 conversation startup recovery只允许以该显式根解析active pointer、run manifest和run-state，不能拿frozen app cwd或任意进程cwd推断authority；非V1普通环境未设置该变量时继续兼容现有`process.cwd()`入口。
- 每次启动Next前必须从marker重新计算并核对冻结树；Playwright结束、Next停服后再次复核，二者任一失败都使本次证据无效并阻止后续Provider/验收推进。`.next-m67`是该冻结app唯一owned的非证据dist cache，每次启动前隔离清理并重新生成，不得复用仓库`.next`或其他run的cache，也不得纳入或反向改写冻结源码摘要。
- Playwright必须从冻结树中的实际observer spec绝对路径运行，不能在freeze后回读仓库原spec。observer spec及其显式支持文件与业务源码接受同一pre-start/post-stop摘要验证；因此外部Codex观察逻辑也被绑定到同一run合同。

### 3.13 `node_modules` installed-tree健康门与隔离残余（仓内P0/P1）

- 本次A23运行合同不复制或物化完整`node_modules` installed tree；Next、Playwright及其依赖仍从仓库已安装依赖树加载。`package-lock.json`已同时进入manifest的runtime source摘要和frozen app复制闭包，lockfile漂移会失败关闭，运行期间禁止执行install、update或其他依赖变更。
- 启动前仓内P0必须由产品preflight在有界超时内执行并严格解析`npm ls --all --json`。一般extraneous不能直接放行；仅当该包在`package-lock.json`中有同版本记录、标记为`optional`或`devOptional`，且同时具备`integrity`或`inBundle`证据时，才允许作为当前平台安装残余，并只在脱敏报告中记录总数，不记录包名、版本或路径。未锁定、版本不符、非optional的extraneous，以及missing、invalid、peer dependency错误、超时/启动错误、非法JSON、非法`problems`结构或非零退出，均在Next和Provider请求数0时失败关闭。该门只证明当前安装图与包管理合同一致，不等于冻结整个installed tree。
- `package-lock.json`冻结与R27 installed-tree健康门通过仍不能证明`node_modules`每个已安装文件的字节级不可变。该限制必须在V1-9 closeout中保留为P1残余边界，不得把当前证据表述为“完整依赖树已隔离”；后续若进入发布级可复现构建，再单独评估content-addressed installed tree或不可变构建产物，不在本轮仓促扩大范围。

## 4. 五层验收

| 层级 | V1-9 证据 |
|---|---|
| `contract` | TaskBrief 预算 profile、Skill lock、Artifact 信任、30-90 秒、run manifest、fixture baseline、frozen Next app闭包、installed-tree健康和恢复合同测试 |
| `executor` | Provider 提交后原子计费、ToolResult/Observation/Artifact 原子提交、checkpoint 与幂等恢复测试 |
| `model orchestration` | Main Agent 动态 Tool 轨迹、跨段续跑、Observation/Replan、无固定顺序和外部编排介入 0 |
| `product E2E` | 单一桌面项目真实完成 PPTX、图片、MP4、ClassroomRunSpec 和 ZIP |
| `release` | 本阶段不完成；教师签收、候选环境、部署和切流只在 V1-9 通过后进入 V1-10 |

低层通过不得上推为真实全链路通过。

## 5. 实施切片

1. 先写预算、Skill preflight、信任边界、课堂图 Tool、TTS 外部调用、30-90 秒、checkpoint 和 runner authority 的红测试。
2. 实现 TaskBrief 预算 profile 与单一持久调用台账，将 TTS 纳入显式 Provider 执行边界。
3. 实现有界自动续段和 TaskAggregate/SemanticSnapshot 原子 checkpoint。
4. 实现 V1-9 Skill eager preflight、binding 完整性和 lock digest 校验。
5. 收敛媒体 Adapter 信任边界，暴露课堂视觉图 Tool，分离内部质量与教师签收并修正页数/时长合同。
6. 建立 start/resume 同源 runner、mutation ledger、frozen Next app原子发布和真实证据输出。
7. 运行定向测试、R27 installed-tree严格JSON/lockfile健康门、控制面扩大回归、TypeScript、全量测试、生产构建、API 台账校验和 `git diff --check`。
8. 先关闭新运行合同缺口：显式`start-new + predecessorRunId`、旧manifest哈希不变、源码/需求/Registry/Projection/Policy/Provider及root fixture摘要冻结、frozen Next app闭包与复制期三摘要一致、fresh run不误用恢复健康门、首次TaskBrief/IntentGrant/预算/强度/计划一次绑定及恢复前漂移校验。
9. 仓内preflight全绿后原子生成新的runId、不可变manifest和active pointer，再以`chromium-desktop`、单worker、deterministic关闭执行新的唯一真实全链路。
10. 最终包进入版本化只读audit round；P0>0时持久化repair handoff并经产品external-audit ingress恢复同一Main Agent，只返修affected units。
11. 新package版本形成后只复验open finding IDs及其affected units；全部历史P0关闭且当前轮P0=0后，才关闭V1-9 active pointer。

## 6. 不纳入范围

- 不重做 R0-R5，不重跑 390px。
- 不引入 LangChain 或 LangGraph 作为第二编排器。
- 不调用 mock、placeholder、deterministic fallback 或 degraded 产物冒充完成。
- 不使用旧 M56、Stage 41 或外部 Codex 业务串联作为证据。
- 不执行部署、生产写入、教师签收、公网切流或 V1-10 发布动作。
- 不 commit、push、移动历史标签或清理用户在途改动。

## 7. 风险与回退

- 预算 profile 过小会制造例行 HumanGate，过大则扩大费用范围。回退方式是保留版本化 profile 和已持久 IntentGrant，不在运行中静默改值。
- 自动续段可能形成循环。通过任务总预算、每段轮次、重复失败熔断、幂等键和 typed stop reason 同时约束。
- 信任边界放宽可能绕过教师签收。只接受验证和独立审查均通过的明确 eligible Artifact；签收事实保持独立。
- Skill 投影内容变化会导致 lock digest 失败。失败时停止真实运行，切换到经过重新物化和校验的投影版本。
- 新唯一运行中断时不删除runRoot；恢复只绑定同一manifest及全部冻结摘要。任何实质合同漂移都先把当前run终止为历史证据，再以显式前序关系创建新run；不得自动、静默或就地迁移。
- frozen app复制期源码变化、root fixture漏锁、半成品final、Windows reparse路径或observer回读仓库源码会破坏运行证据。通过baseline fixture摘要、owned staging、原子rename、canonical containment和启动前/停服后双重摘要复核失败关闭；`node_modules`先以严格JSON与lockfile证据解析关闭安装图健康门，未实现字节级隔离的P1残余仍须单独披露，不能用lockfile或依赖图健康掩盖。

## 8. 完成标准

- 全部启动前 P0 都有红绿测试和仓内证据。
- 预算、调用台账、checkpoint、Skill lock、Artifact 信任和 runner 身份均持久且可恢复。
- manifest runtime source覆盖root fixture，frozen Next app覆盖实际运行依赖与observer，fresh复制三摘要一致，marker绑定run/manifest，resume显式且启动前/停服后无漂移；半成品、reparse逃逸和跨run dist cache均失败关闭，R27 installed-tree健康门通过且报告只含允许残余的脱敏计数。
- 桌面唯一运行由产品 Main Agent 自主完成；外部 Codex 编排介入实测为 0。
- 真实可编辑 PPTX、课堂视觉图、30-90 秒完整 MP4、唯一最小课程锚点、`ClassroomRunSpec` 和版本一致 ZIP 全部通过反向验证。
- 没有 mock、placeholder、deterministic fallback 或 degraded 成果冒充完成。
- V1-9 closeout 形成后才允许进入教师签收和 V1-10 授权门。
- 外部审核P0不会丢失报告或触发整链重跑；版本化round、产品Observation/checkpoint、局部返修和targeted recheck均有持久证据。

## 9. 2026-07-15 离线门证据

- Skill 专项：Vitest `6 files / 33 tests`；runner 合同 `5/5`；外部 `shanhai-video 1.2` `17/17`，suite `43/43`。
- 控制面扩大回归：Vitest `15 files / 34 tests`，assistant-ui Node 合同 `4/4`。
- 全量：Node `294/294`；Vitest `162 files / 1106 tests`；`npx tsc --noEmit` exit 0。
- 生产构建：14 个静态页面生成完成；保留 6 条 Turbopack 文件追踪警告，exit 0。
- API 台账：公开校验与 `--include-private` 均通过；Provider ledger 定向 `3 files / 7 tests`。
- `git diff --check` exit 0；没有残留 Vitest worker。两个既有 Playwright CLI daemon 属于此前浏览器会话，未由本轮创建，未终止。
- `test-results\v1-9-product-e2e-active.json`当前仍指向历史`paused_recovery`运行；新runner定向合同已经通过，但在全量仓内回归与只读preflight全绿、并由新运行准备器原子创建新run前仍禁止真实执行。准备器必须先验证旧runId和旧manifest哈希，再保留历史索引并原子切换到全新runId，不得修改旧manifest。
- 选中通道专用探针合同已红绿关闭。2026-07-15 07:05（Asia/Shanghai）使用产品Provider ledger对冻结的`primary / gpt-5.5 / high / configDigest=ac4819...94f`执行一次严格结构化Responses探针；`providerRequestCount=1`、`maxRetries=0`、`retryCount=0`，结果为`authorization`失败。证据ID为`agent-brain-health-20260714230547-97f623bd-dd8`，已同时写入API台账和唯一run目录；该失败证据不能触发恢复。
- 历史`gpt-5.6-terra`通用smoke和旧恢复健康证据继续为`diagnostic_only`，不得绑定到fresh run。fresh run的离线preflight只验证当前台账与冻结摘要，不要求伪造恢复健康ID；只有该新run之后进入`paused_recovery/failed`时，恢复才要求晚于停止点且完全匹配冻结Provider lock的新健康证据。

## 10. 2026-07-15 唯一运行后的 Provider 合同修复

唯一运行已证明 Main Agent 能自主选择 `generate_video_narration`，但同时暴露了业务语义与 Provider 执行配置混用：模型生成的 `videoNarrationScript.voiceId` 是声音风格偏好，不是经过台账验证的 MiniMax `voice_id`。Provider Adapter 必须在执行边界把脚本语义与 API 台账中的 `MINIMAX_TTS_VOICE_ID` 绑定，实际请求只使用台账音色；Artifact 的脚本 digest 保持不变，Provider evidence 同时记录脚本偏好和实际音色，不允许 Main Agent 或 Skill 覆盖密钥、端点、模型或真实音色。

TTS 失败必须按阶段分类并进入 Observation：请求前配置缺失、HTTP 授权/限流、Provider 业务拒绝、音频响应无效、字幕地址无效、字幕下载失败和字幕 timing 无效不得统一压成 `provider_unavailable`。Observation 必须携带稳定 reasonCode、脱敏原因、是否已提交 Provider 和可执行恢复动作；输入/响应合同问题返回 Main Agent `fix_inputs` 或 Replan，不进入例行 HumanGate。只有网络、限流或 Provider 暂时不可用才允许 `wait_for_provider`；提交事实必须计入同一 TaskBrief 预算。

修复按非等价顺序完成：先用历史 Artifact 和离线夹具形成红绿证据，再执行短文本、零 SDK 重试的真实 MiniMax TTS 探针并保存台账证据；随后独立收缩`generate_video_storyboard`的输入与输出责任。TTS与分镜专项问题均已关闭，不再作为当前恢复前置，也不得用这些历史证据替代现有Main Agent Provider lock的健康证据。

第一次绑定修复探针已证明请求到达 MiniMax，但在 HTTP 200 业务响应层被拒绝，`requestCount=1/retryCount=0`。本机 `mmx-cli 1.0.5` dry-run 使用 `subtitle=true`、32k 单声道；第二次非等价探针据此成功获得音频，但 MiniMax 忽略该非合同字段，未返回字幕 URL。MiniMax 结构化 SDK 合同和现有响应模型共同确认请求字段应为 `subtitle_enable`，响应为 `data.subtitle_file`。因此最终合同固定为台账音色、`subtitle_enable=true`、`sample_rate=32000`、`channel=1`；不得继续使用 CLI 的 `subtitle` 别名。两次失败证据均保留，不覆盖、不归因于随机波动。

`generate_video_storyboard` 的两次历史失败均发生在专项 Responses Runtime：第二次严格 180 秒超时。根因是旧输入复用教师完整材料包消息并投影全部可信 Artifact，而Main Agent Tool call中的具体分镜指令只留在`taskInput`。现已改为非空Tool `userInstruction`优先，模型上下文只投影`requiredArtifactKinds`对应的可信Artifact；TaskBrief、IntentGrant、强度和Skill继续保留，`resolvedArtifacts`只留在服务端执行边界供血缘校验。该收缩未改变业务Tool顺序、Provider、Artifact或质量合同。

上下文收缩后的 high 与 medium 隔离请求仍分别在约 167.5 秒和 162.4 秒由上游 Provider 失败；两次输入均为 12,890 字符、1 个 Artifact、请求1/重试0。由此排除上下文窗口不足，继续收敛输出责任：`storyboard_generate` 不再要求模型同时写完整教师 Markdown并把同一分镜二次编码进 `structuredContentJson`。模型只返回严格 `videoStoryboardManifest` 单一事实源，服务端完成 digest、校验和教师 Markdown 确定性投影。投影不得补造镜头、旁白、资产或连续性事实，不属于 fallback/degraded 成果。

单一事实源 A/B 已在约 95.1 秒返回结构化分镜，证明 Provider 能完成该业务调用；仓内校验以两处 `shot_reference_asset_unresolved` 拒绝。根因是同一资产绑定被要求双向生成：镜头 `referenceAssetIds` 与资产 `applicableShotIds` 可能不一致。新合同只让模型在 `references[].applicableShotIds` 声明绑定，服务端确定性反向填充镜头 `referenceAssetIds`；不存在的镜头、缺失资产、required 镜头无绑定和真实文件 hash 仍失败关闭。

## 11. 2026-07-15 恢复一致性收口与当前健康门

- 外层Adapter按`actionKey`累计失败并机械暂停的第二停止权已删除；相同调用预算只由原生ReAct loop拥有，停止前持久化包含最新Observation的checkpoint。
- `create_ppt_design_draft`新增严格`repairIssues`参数，Main Agent可把`evidence_binding_page_refs_invalid`、`learning_progression_missing`等具体Validation问题传回同一高层Tool；最低结构、血缘和生产设计包门未降低。
- checkpoint基础摘要不再绑定会变化的完整request.input，而绑定project/task/TaskBrief digest/IntentEpoch/强度/授权；plan revision只允许单调前进，旧v1 checkpoint仅在任务身份完全一致时迁移。
- V1-9观察器现在优先采用明确的失败TurnJob errorCode，避免旧message checkpoint覆盖新的Provider失败。旧run最终停在`planRevision=20 / paused_recovery`，最新reasonCode=`main_agent_provider_unavailable`，上游为`502 Upstream request failed`；该状态只作历史失败证据，不再是当前执行入口。
- 当前停止条件：在新运行manifest合同、Provider台账、强度映射和只读preflight全部通过前，不执行Responses、真实媒体或浏览器全链路；R5与390px不重跑，V1-9通过前不进入V1-10。

## 12. 2026-07-15 A23新运行冻结规则

- 新运行使用显式`start-new`模式并要求`predecessorRunId=v1-9-20260714212914-a036beb9`；默认入口在存在active pointer时仍不得擅自创建第二个run。
- 新manifest必须包含前序runId、前序manifest SHA-256、`main`分支/HEAD、当前未提交运行源码摘要、需求基线摘要、活动source Registry与Projection Registry的独立摘要、Projection ID/digest、Binding Policy digest、全部活动Skill版本、Provider台账manifest摘要，以及Agent Brain、Coze PPT、MiniMax图片、视频和MiniMax TTS的非敏感配置摘要。source Registry与Projection Registry不一致时失败关闭。
- 新manifest是只读合同文件；运行状态采用`v1-9-run-state.v2`，project/task身份、checkpoint、mutation ledger、PendingDecision、恢复信息与`packageAcceptance`只写入独立`run-state.json`。`packageAcceptance`冻结正式package Artifact ID/version、课程版本、ZIP SHA-256、审核轮次、当前open P0、affected units及repair handoff摘要。
- 每轮报告不可变保存为`external-acceptance/round-NNNN/report.json`；P0轮同目录保存`repair-handoff.json`。生成最终包并下载后只进入`package_ready_for_external_acceptance`；P0轮进入`external_acceptance_repair_required`并保持active pointer，只有新package定点复验关闭全部历史P0且当前轮P0=0后才进入`completed`并最后关闭pointer。
- 创建后preflight只读验证manifest，不补写或轮换任何冻结字段。源码、需求、Registry、Projection、Policy、Provider或Task合同任一漂移时，Provider请求数必须为0。
- UI首次提交后一次绑定TaskBrief digest、IntentEpoch、强度、IntentGrant/预算profile digest和初始plan revision；这些字段不得在同一run内改写，计划仅允许revision单调推进。
- 启动Next前必须按第3.12节从manifest已锁定且包含root fixture的runtime source物化`m67-frozen-app.v3`树；只有baseline fixture无漂移、R27 installed-tree严格解析通过、owned staging原子发布、runId/manifest SHA/源码与复制摘要绑定、实际observer冻结和pre-start校验全部通过后才能启动，停服后还须复核同一树。该步骤是同一A23运行合同的一部分，不形成第二条runner流程。
