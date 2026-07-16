# V1-9R 浏览器验收环境阻塞记录

更新时间：2026-07-15

状态：`closed by real desktop / R5 passed / 390px deferred until after V1 / V1-9 unique real Provider E2E is next`

> 当前权威口径：R5验收自主控制面，不要求Director机械必经，也不执行PPTX、图片、MP4、ZIP或production内容门。下文保留的502、180秒超时和旧Director恢复切片仅作历史诊断证据；凡与本段及R5 plan/test-plan冲突，以当前权威文档为准。

> 当前收敛结论：仓内`contract`与`executor`通过，fallback真实桌面`1 passed / 1 skipped`。一句话PPT已经形成可信`ppt_design_draft`，B侧局部视频脚本、自然语言改道、重复失败恢复和双用户隔离通过；R5关闭。390px按V1前门禁未运行，下一步只允许唯一一次V1-9真实产品全链路。

## 已知事实

- 2026-07-15最新真实桌面目录为`test-results\m67-e2e-70188-1784054013274\`，根summary为`test-results\v1-9r-two-user-summary.json`。运行显式选择fallback、独立SQLite、独立Next app root、动态端口、单worker、`M67_E2E_DETERMINISTIC=0`和`chromium-desktop`，结果`1 failed / 1 skipped`；外部Codex编排介入0、GenerationJob 0、无403、无真实媒体调用。
- B侧局部视频脚本由Main Agent动态完成`create_requirement_spec -> generate_intro_creative_themes -> generate_intro_video_script`，只形成需求、创意和脚本Artifact，没有扩张到教案、PPT、图片、分镜、成片或整包。A侧完整材料包依次完成需求、教案和PPT大纲；PPT设计与可选Director失败后，Main Agent改走创意、脚本和其他不依赖文本路径，并在Tool轮次预算耗尽时保存checkpoint、诚实暂停。
- 同轮一句话PPT动态完成`create_requirement_spec -> create_ppt_outline`，随后`create_ppt_design_draft`失败、可选Director失败、再次选择PPT设计后触发精确重复失败熔断；最终缺少`ppt_design_draft`，因此浏览器断言失败。该轨迹不是固定Tool顺序，未进入HumanGate，也没有fallback成果。
- 该次失败把具体PPT候选缺陷压成`validation + tool_execution_not_succeeded`。仓内已补齐`AgentRuntimeFailure`、`CapabilityRunResult`、`ToolExecutionResult`、`ToolObservation`和`ValidationReport`的`reasonCode/reasonDetails`贯通，并映射Runtime输出缺失、JSON、Markdown、structured content和PPT候选缺失/语义无效等分类；字段级details可保留`page_count_mismatch`、`page_number_not_contiguous`或`page_semantics_incomplete`等定位。
- 同时完成PPT责任边界分层：模型输出`ppt-design-semantic-candidate.v1`，服务端从有效ExecutionEnvelope、TaskBrief和当前可信`ppt_draft`投影`ppt-design-candidate.v2`；历史v1只读兼容。模型不再复制TaskBrief digest、Artifact ID/version/digest或candidate digest，Director也只声明`source_artifact_kind`，所有权威血缘由Invocation Envelope绑定。
- 2026-07-15最新仓内门为Director新合同`11/11`、Runtime/Capability/Observation定向`57/57`、Node`287/287`、Vitest`152 files / 1039 tests`、TypeScript、生产构建14页面、API台账独立校验和`git diff --check`全部通过；无残留当前仓Vitest/Playwright worker。构建仍只有5条既有动态文件模式警告。
- 上述绿灯只关闭仓内`contract`与`executor`；`model orchestration`仍为部分证据，`product E2E`仍失败，`release`未开始。下一次桌面若返回具体语义reasonCode，只修对应合同责任层；若通过则才映射R-A/R-U并创建R5 closeout。R5关闭前禁止V1-9真实全链路。

- 当前应用选择primary，primary与fallback均为已配置GPT系列模型；凭据和URL只在本地环境文件中维护，未写入证据或文档。
- 最新primary桌面`test-results\m67-e2e-47140-1784026423599\`中，一句话PPT的Main Agent在约`8.6k-10.2k tokens`输入下持续于`4.7-6.5s`响应，自主完成需求Tool并选择PPT大纲Tool；业务文本Runtime随后单次180秒timeout。Observation已保存`timeout/tool_execution_not_succeeded`、`repair_upstream`和恢复入口，0媒体GenerationJob、0外部Codex编排介入。该结果排除上下文窗口和Main Agent检查点压缩是本次180秒超时原因。
- fallback最小Responses成功后显式选择fallback运行`test-results\m67-e2e-61104-1784027400662\`；A/B两条真实Main Agent首轮请求各携带1个合格业务Tool、约`8.7k tokens`，均在约1.0-1.1秒返回`403 Your request was blocked`。独立`evidence\`目录保存TaskBrief、IntentGrant、请求遥测、空Artifact和空GenerationJob；根summary记录`providerChannel=fallback`与外部Codex编排0。最小探针因此不足以证明R5通道健康。
- 当前最新仓级门：PPT候选定向`3 files / 35 tests`、控制面扩大回归`16 files / 203 tests`、Node`284/284`、单worker排除独立互动课件Stage7在途冲突后Vitest`127 files / 960 tests`、TypeScript、生产构建14页面和`git diff --check`通过；构建仍为既有5条动态文件模式警告。Runner证据隔离回归`8/8`。
- `test-results\v1-9r-responses-concurrency-health.json`证明primary在`maxRetries=0`下可同时完成两条`function_call -> Observation -> strict structured finish`轨迹，四个请求约2.4至4.4秒完成。该证据只关闭基础双并发Responses门，不证明业务Runtime、真实浏览器Main Agent或R5通过。
- 新健康证据后的第一轮真实桌面中，B侧局部视频脚本全链文本Tool通过，A侧在Director失败后合法换到`create_ppt_design_draft`，业务Runtime和随后Main Agent continuation均timeout。完整隔离目录为`test-results\m67-e2e-27480-1784012085099\`，脱敏归档为`test-results\archive\v1-9r-desktop-20260714-150535\`。
- R5的PPT设计责任边界已按红绿测试收缩：模型只生成`ppt-design-candidate.v1`，绑定当前TaskBrief digest与可信Artifact digest；服务端计算candidate digest并投影最低可下游结构。production校验仍只在真实PPTX/媒体边界执行，没有候选或绑定不一致时不保存Artifact。相关扩大回归`10 files / 143 tests`、TypeScript、生产构建14页面和`git diff --check`通过。
- 合同修复后的第二轮真实桌面中，A侧形成五个可信文本Artifact后，`create_ppt_design_draft`仍以`reasonCode=timeout`失败；B侧`creative_theme_generate`也以`reasonCode=timeout`失败，A随后Main Agent continuation再次timeout。完整隔离目录为`test-results\m67-e2e-67896-1784014241036\`，脱敏归档为`test-results\archive\v1-9r-desktop-20260714-154239\`。该结果没有进入候选本地Schema校验，剩余阻塞归于Provider业务文本Runtime稳定性。
- 两次新桌面均为0 GenerationJob、0外部Codex编排介入，未调用图片、视频、PPTX、ZIP或整包Provider。桌面未通过，因此`chromium-narrow`未运行，R-A/R-U矩阵未关闭，也未创建R5 closeout。
- 历史诊断：fallback ledger上的`gpt-5.6-terra`最小Responses探针一次成功、SDK重试0后，旧403健康门解除；随后没有重复探针，直接恢复真实桌面。
- 历史诊断（随后已切回primary）：用户替换fallback配置后，曾修正误填的`AGENT_BRAIN_CHANNEL`并确认应用选择fallback。一次`maxRetries=0`多轮Responses验证中，首个function call在3668ms成功；第一次Observation回传后的第二个function call失败，未进入第三段严格结构化结束。证据为`test-results\v1-9r-responses-multiturn-health.json`。
- 第一轮真实桌面证据归档于`test-results\v1-9r-desktop-20260714-132238\`。A侧`create_requirement_spec`成功后Main Agent Responses continuation在180秒超时；B侧真实选择`create_requirement_spec`，创意Tool超时后换到知识锚点并诚实暂停。0 GenerationJob、0外部Codex编排介入。
- 第二轮加入脱敏Tool轨迹后，A侧真实轨迹为`create_requirement_spec -> create_lesson_plan -> Responses continuation超时`；刷新集合依次从`[create_requirement_spec]`变为`[create_lesson_plan, create_ppt_outline, create_video_course_anchor, generate_intro_creative_themes]`。B侧真实轨迹为`create_requirement_spec -> generate_intro_creative_themes -> generate_intro_video_script失败 -> video_director_plan_or_repair -> generate_intro_video_script失败`，两次失败reasonCode分别包含`timeout`和`missing_field`，最终诚实暂停且无`ask_teacher`。
- 上述轨迹同时暴露仓内资格缺陷：成功后的`create_lesson_plan`和`generate_intro_creative_themes`仍被重复暴露。现已以红绿测试关闭已完成非重复前段Tool的重复暴露，并保留页面/镜头返修类Tool的可重复能力；Tool集合刷新、累计Observation历史和最多32条脱敏`mainAgentToolExposureTrace`均已持久化。扩大回归`8 files / 137 tests`、TypeScript、生产构建14页面和`git diff --check`通过。
- 两次真实桌面都未调用图片、视频、PPTX、ZIP或整包Provider，GenerationJob均为0；桌面未通过，因此`chromium-narrow`未运行，R-A/R-U矩阵未关闭，也未创建R5 closeout。
- R0-R4及R5仓内控制面合同回归、TypeScript与生产构建均已执行；TaskBrief、IntentGrant、typed PendingDecision、ExecutionEnvelope、队列自治、连续ReAct、旧结果隔离与双用户隔离回归均通过。R5真实Main Agent浏览器门尚未通过。
- R-A08/R-A09 已补齐任务级费用披露：当前没有可靠积分计量时不虚构积分，`IntentGrant` 持久化 `budgetPolicyVersion=v1-standard` 与 `maxExternalProviderCalls=3`。一次 `budget_disclosure` 确认后，同一 project/task/IntentEpoch/强度内的不同外部 Tool 不再逐 Tool 创建 actionId；达到调用上限后产生唯一 `budget_upgrade`，确认前新增外部调用为 0。ActionPolicy、ConversationControl、PlanGuard 和 Main Agent Tool loop 使用同一授权判断。
- R-A14 已将内部质量和教师签收分开：通过的 QualityDecision 持久化为 `final_candidate + continue_downstream`；审查后 Artifact 仍为 `needs_review/isApproved=false`，同时保存独立 `artifactQualityState` 供内部下游使用。视频课程锚点内审通过后，`video_script_generate` 可继续，但教师批准仍是单独状态和动作。
- R-A02/R-A11 的本地控制面续接审计发现并修复两项阻断：自主业务循环不再用 3 轮截断 19 阶段完整材料包，当前按 22 个已注册能力加 5 轮返修余量形成 27 轮有界预算；Main Agent 函数 Tool 循环从 3 轮提升为 8 轮，同时保留重复调用熔断。
- ActionPolicy 现在只把真实 Provider adapter 或 `external_call` 计入外部调用预算；本地可逆的 PPT/视频组装与最终打包不再消耗 `maxExternalProviderCalls`，无任务授权仍由 PlanGuard fail closed。
- 完整材料包输入中“独立创意”曾被两份重复的 deterministic 探索分类器误判为只聊创意；现已收敛为单一`isExplorationOnlyRequest`。明确交付物或“请做/制作/生成/完成”请求不会降级为空探索；后续离线fixture又发现“改道，仍然只做局部视频脚本”同类误判，已把视频脚本、分镜、资产说明、片段规划、需求规格和课程锚点纳入显式交付物，并以红绿回归关闭，未给legacy planner新增固定视频Tool路径。
- `scripts\run-m67-e2e.mjs` 已使用独立 app root、独立 Next dist、动态端口和隔离 SQLite 成功进入两名邀请教师的工作台；原 3100/3117 Next dev lock 阻塞已解除，未停止用户现有进程。
- 两名教师通过真实密码认证、各自创建项目并从 UI 同时发送任务；TaskBrief 与 IntentGrant 均持久化且项目 snapshot 可读。
- 产品 Main Agent 主通道与已配置 fallback 通道分别实测一次，均在 `agent_tool_loop` 收到 `502 Upstream request failed`。两条路径均诚实失败，artifact 数为 0，没有 deterministic fallback、付费媒体 Tool 或外部 Codex 编排介入。
- 2026-07-14 续接时使用项目自带 `scripts\openai-smoke.mjs` 对主通道执行了一次最小 Responses 结构化输出探针，仍返回 `openai_smoke_failed`；没有出现可支持重新运行完整浏览器黑盒的 Provider 状态变化，未继续重复 fallback 或媒体调用。
- 显式 deterministic fixture 已在 `chromium-desktop` 与 `chromium-narrow` 两个项目通过，验证两名受邀教师的登录、项目隔离、TaskBrief/IntentGrant、强度刷新、改道、刷新恢复、窄屏滚动锚点和外部 Codex 编排计数 0；该 fixture 不替代真实 Main Agent 或真实 artifact 验收。
- 2026-07-14 最新验证：V1-9R 控制面定向 7 文件 119/119；单 worker 排除独立互动课件 Stage7 固定节点列表后 123 文件 879/879；Node 测试 277/277；`npx tsc --noEmit` 通过；`npm run build` 通过并生成 14 个页面，保留 5 条既有动态文件模式警告。两用户 deterministic 浏览器黑盒已改为 A 侧完整材料包、B 侧局部视频脚本，并在桌面和 390px 共 2/2 通过；外部 Codex 编排计数为 0。
- 2026-07-14 R-A06 续接修复已把 `CapabilityToolPlan.inputDraft` 贯通到 ToolRouter、Internal Capability Adapter、Capability Runtime 和 Responses 请求；TaskBrief、强度、目标页数与可靠默认不再只参与哈希而在执行前丢失。Capability Runtime 同时要求 `taskGuidance.requiredFields` 逐字作为二级标题输出，避免同义标题被本地严格质量门误拒绝；没有降低校验门或增加文本 fallback。
- 同次修复把 Main Agent 默认超时从 60 秒对齐到业务 Runtime 的 180 秒，并只在 `fix_inputs + 已有可靠项目默认` 时发起受限失败修复请求；真实缺输入、权限、费用和不可逆动作仍保持 HumanGate。新增定向回归后 6 文件 128/128 与 `npx tsc --noEmit` 通过。
- 第二次真实桌面双用户黑盒中，A 侧 `requirement_spec`、`lesson_plan`、`ppt_outline`、`knowledge_anchor_extract`、`creative_theme_generate` 均由真实 Runtime 生成并通过内部验证与审查；`ppt_outline` 已使用已知五年级、数学、百分数和约 10 页可靠默认继续，没有再追问教材版本、页码或例题照片。B 侧完整通过最短脚本链并只形成 `requirement_spec`、`lesson_plan`、`knowledge_anchor_extract`、`creative_theme_generate`、`video_script_generate`，未生成 PPT、图片、成片或包。
- A 侧 `ppt_design` 在相同可信输入下连续两次达到 180 秒 Runtime 超时。产品 Main Agent 没有第三次原样重试，而是转向不依赖的导入视频文本分支，并在首个图片外部调用前停止；没有调用真实图片、视频或 PPTX Provider。该轮仍缺 `ppt_design_draft`，所以桌面 R-A02 未通过，390px 真实 Main Agent 黑盒未运行。
- 随后执行一次无浏览器、无双用户并发的独立 `ppt_design` 延迟探针，复用同类五年级百分数教案、约 10 页大纲、TaskBrief 和可靠默认；结果仍在 180034ms 以 `runtimeKind=openai / failure.category=timeout` 失败，且没有 Artifact。该证据排除了 UI、SQLite 隔离和双用户并发是本次超时的必要条件，不再对同一 Provider/输入做等价重试。
- 同轮发现 Tool 后 Replan 的 PendingPlan 丢失 TaskBrief，导致费用提示与 actionId 已形成但 typed `PendingDecision` 为空；现已传回同一 `replanTaskBrief`，新增“内部 Tool 成功后进入首个外部 Tool”回归证明 `budget_disclosure`、taskId、projectId 和 reasonCode 被持久化。该修复尚未再次消耗 15 分钟真实黑盒复验。
- 2026-07-14 最新静态门禁：Node 279/279；单 worker 排除独立互动课件 `stage7-mainline-contract.test.ts` 固定节点列表后 Vitest 123 文件 901/901；TypeScript 通过；生产构建通过并生成 14 个页面，保留 5 条既有动态文件模式警告；`git diff --check` 通过。未排除时唯一失败仍是独立互动课件 Stage7 固定节点列表与其在途需求变更冲突，不属于 V1-9R 实现范围。
- 2026-07-14 `ppt_design` 恢复切片已经完成：`ppt_director.plan_or_repair` 冻结为完整逐页 Director 合同；`create_ppt_design_draft` 只在可信 `ppt_draft` 和真实 Runtime 上下文存在时向产品 Main Agent 可见；服务端只接受同一 ReAct 轮、当前 project/IntentEpoch 的 Director 结果，并逐项核对签名输入的 Artifact ID 与 digest。Adapter 机械转换为 `ppt-design-package.v1`，同时执行结构门和 Provider-production 门，失败不保存 Artifact。旧通用 `runCapabilityWithAgentRuntime(ppt_design)` 已失败关闭，不再做 180 秒等价调用。
- 新增合同/Adapter/同轮接线回归覆盖完整 10 页、页码连续、组合层、无障碍、通用占位页、Director 自检、证据 digest、原子 Artifact 和无旧 Runtime fallback。相关扩大回归 24 文件 301/301 通过。
- 单节点真实恢复探针保存在 `test-results\v1-9r-ppt-director-probe.json`。第一次使用完整权威响应 Schema，在 3066ms 以 `agent_tool_model_failed` 失败；离线发现 Agent Tool 响应 Schema 未经过项目既有 OpenAI strict 兼容投影，修复为“Provider 使用兼容投影、Router 仍使用完整权威 Schema 二次校验”。该投影定向回归和 TypeScript 通过。
- 只复验受影响节点后，通道仍在 2554ms 返回明确 `502 Upstream request failed`，Artifact 为 0。当前权威 Schema 约 10856 bytes，Provider 投影约 10440 bytes；没有证据表明继续缩短超时或重复同一通道会成功，因此停止等价请求。该失败没有调用图片、视频、PPTX 或整包 Provider。
- 本切片最新本地门禁：Node 279/279；单 worker 排除独立互动课件 `stage7-mainline-contract.test.ts` 后 Vitest 124 文件 912/912；`npx tsc --noEmit` 通过；生产构建通过并生成 14 个页面，保留相同 5 条既有动态文件模式警告；`git diff --check` 通过。
- 2026-07-14 续接审计补齐非 actionable Director 决策门：`decision=needs_input/blocked` 即使返回了结构完整的逐页数据，也必须以 `ppt_director_not_actionable` 失败关闭，不能保存为 `ppt_design_draft`。新增定向回归 9/9；R5 控制面扩大回归 28 文件 334/334；单 worker 排除同一 Stage7 在途冲突后 Vitest 124 文件 914/914；Node 279/279；TypeScript、生产构建 14 页面和 `git diff --check` 均通过，仍只有相同 5 条既有动态文件模式警告。
- 同次只读通道审计确认：当前配置文件在两次 Director 失败前已保持不变；仅既有 primary 与 fallback 两条 Main Agent 通道可用配置存在，third 未配置，且两条既有通道此前均已有 502 证据。没有出现配置变更、健康结果或新的结构化输出能力证据，因此本轮没有重复 Provider 请求，也没有调用图片、视频、PPTX 或整包 Provider。
- 2026-07-14 R5接管纠偏后，服务端不再隐藏`ppt_design`、自动选择最早上游或固定DeliveryPlan下一Tool；重复失败改为`ValidationReport.reasonCode + Observation + RunCheckpoint`，默认暂停而非`ask_teacher`。`ppt_design`可直接走真实Runtime；同轮Director结果仅在Main Agent主动选择时复用，且只执行R5结构门。`validatePptDesignPackageForProviderProduction`仍保留在真实媒体Provider边界。
- 当前合格Tool资格已收缩为事实判断：无可信领域输入时不向Main Agent暴露Director/Critic；有PPT大纲时同时开放PPT Director和直接设计Tool；Critic只在存在可审产物时开放。相关回归`8 files / 136 tests`、控制面交叉回归`18 files / 195 tests`、资格过滤回归`3 files / 90 tests`和TypeScript均通过。
- 真实桌面黑盒执行两条不同路径：第一轮含当前全部错误标记为合格的Agent Tool时，两项目均在`agent_tool_loop`返回403；修正资格过滤后，第二轮无Tool的Main Agent direct response仍返回403。随后同一网关最小Responses JSON Schema探针也返回403，证明阻塞位于当前Main Agent Provider授权/风控，不是Tool数量、Director内容Schema、UI、SQLite或双用户并发。
- 独立DeepSeek配置最小探针返回404，表明该端点不支持产品当前Responses API；不能把先前Director诊断通道直接映射为Main Agent Runtime。上述探针均未产生Artifact，也未调用图片、视频、PPTX或整包Provider；外部Codex运行中编排介入为0。
- 本次桌面隔离运行的脱敏诊断已固化到`test-results\v1-9r-desktop-isolation-diagnostic.json`。Tool暴露轨迹为：无可信领域输入时曾错误暴露`ppt_director_plan_or_repair`、`video_director_plan_or_repair`、`delivery_critic_review`并在`agent_tool_loop`返回403；资格修正后初始Tool集合为空，两个教师回合均在`direct_response`返回403。相同403跨越有Tool和无Tool路径，因此责任层归为当前Main Agent Responses通道的访问/风控边界；Provider没有返回可进一步区分账号授权、上游策略或WAF规则的证据。
- B侧“已有五年级、数学、百分数和机械信标情境仍要求补充”并非真实缺输入。Main Agent先返回403，随后`ConversationControlResolver`按“视频脚本”关键词把失败回合改写成服务端选择的`video_script_generate`，再被前置可用性转换为`blocked_by_policy + ask_teacher`。现已移除该forced-next-tool：关键词只用于识别并作废旧pending intent，不再合成下一Tool；Provider失败保持诚实失败，Main Agent选择的合法前置Tool保持不变。相关R5定向回归按SQLite写测试串行执行，8文件126/126通过，`npx tsc --noEmit`、`npm run build`（14页面、5条既有动态文件模式警告）和`git diff --check`通过。
- 2026-07-14最终仓内收敛已关闭初始空Tool集合、ExecutionEnvelope只停留在类型层、requestedOutputs硬编码逐页PPT、双控制面、视频知识中心化依赖、artifact approve自动推进旧M2、无package asset仍现场拼ZIP等残余。明确交付任务首轮至少可发现`create_requirement_spec`；Main Agent原生function-call循环是唯一业务Tool编排权所有者；Observation先持久化再由同一Main Agent决策；deterministic、placeholder和degraded结果均不能成为生产成功产物。
- 显式离线fixture由当前spec先取得桌面与390px`2 skipped / 0 passed`红态，再新增独立`V1-9R offline control-plane contract fixture`转为`2 passed / 2 skipped`。证据文件`test-results\v1-9r-offline-control-plane-chromium-desktop.json`和`...-chromium-narrow.json`写明`doesNotProve=[real-main-agent,R5-complete,real-provider,production-artifact]`；覆盖一句话PPT、局部视频脚本TaskBrief、无pending改道、IntentEpoch、两用户权限隔离、0 GenerationJob、无fixed/degraded fallback和外部Codex编排0。真实Main Agent测试继续skip。
- 最新完整门禁：单worker排除独立互动课件`stage7-mainline-contract.test.ts`后Vitest`125 files / 939 tests`；Node`279/279`；`npx tsc --noEmit`通过；`npm run build`通过并生成14个页面，保留相同5条既有动态文件模式警告。该Stage7排除来自用户在途`interactive_courseware_spec`与固定节点列表冲突，不属于V1-9R，未覆盖或回退。

## 已关闭的历史 V1-9R 阻塞清单

> 以下条目保留2026-07-14真实失败时的原始措辞和恢复入口，已被本文顶部2026-07-15 R5通过结论关闭，不代表当前仍需重跑R5或390px。当前未关闭项只有唯一V1-9运行的选中Main Agent Provider健康门。

- R-A01一句话PPT、R-A02完整材料包规划和R-A18双用户隔离的真实Main Agent桌面黑盒仍被Provider完整通道健康阻塞：primary有业务文本Tool 180秒timeout，fallback在两条真实带Tool Main Agent首轮请求上同时403。不得用最小Responses成功、deterministic fixture、固定DeliveryPlan或外部Codex手工选Tool替代；390px已退出V1发布前门禁。
- R5代码合同已覆盖动态Tool可见性、无Director直达真实设计Runtime、可选Director复用、证据digest绑定、失败Observation/Replan、重复失败checkpoint和无默认`ask_teacher`；仍需在Provider恢复后用真实模型证明动态轨迹和可信`ppt_design_draft`。
- 本轮已关闭B侧forced-next-tool假`ask_teacher`，但没有用离线回归冒充真实Main Agent通过；Provider恢复后仍需重新证明局部视频脚本由Main Agent自主选择合法前置并完成动态轨迹。
- R-U01至R-U06中不依赖真实Provider的桌面与既有窄屏UI/隔离证据已由明确标识的离线fixture收集；它们只证明UI/隔离合同，不能单独关闭R5。V1发布前不再新增390px真实黑盒。
- 在真实Main Agent桌面、R-A01至R-A18、R-U01至R-U06全部映射完成前，不创建R5 closeout，不执行V1-9唯一真实媒体整包；390px不属于该退出门。

## 本次未做

- 未停止或重启现有 3100 服务，因为其来源并非本轮启动，可能承载用户在途工作。
- 本轮先在primary执行一次合同变化后的真实桌面，保存业务文本Tool timeout、Observation、Tool暴露轨迹和恢复入口；随后只因fallback最小Responses出现新健康证据而显式选择fallback执行一次非等价桌面，保存两条真实带Tool请求的403。现已停止Provider尝试；未调用真实图片、视频、PPTX、ZIP或整包Provider。
- 未部署、未写入生产环境、未移动标签、未提交或推送。
- 完成当前桌面运行的证据固化后未进入下一阶段，未执行V1-9真实Provider全链路。

## 最小恢复入口

1. 先取得同一通道的完整健康变化证据：该通道必须能接受带合格业务Tool与strict structured output的Main Agent Responses，并能完成随后结构化文本业务Tool。无Tool最小Responses、单段JSON、仅模型名变化或仅凭据存在均不足以触发重跑。
2. 新证据成立后不再单独重复最小探针，只运行隔离runner桌面项目：`M67_E2E_SPEC=tests/e2e/v1-9r-two-user-main-agent.spec.ts`、`M67_E2E_PROJECTS=chromium-desktop`。不运行`chromium-narrow`，不锁定Director顺序；断言Main Agent从全部当前合格Tool中形成合法动态轨迹，并在该次隔离run的`evidence\`目录保存Tool暴露、Observation与reasonCode。
3. 一句话PPT只验收到真实模型来源、任务语义完整、证据绑定、最低结构有效且可下游使用的`ppt_design_draft`；完整材料包只验任务范围、规划、授权、Observation/Replan和无串线，真实媒体GenerationJob必须为0。
4. Provider阻塞期间继续完成单元/集成、全量、构建和明确标识的UI fixture证据；这些证据不得填写真实Main Agent编排或R5整体通过。
5. R5全部关闭后才执行唯一一次V1-9真实Provider全链路；V1-9通过后再进入V1-10教师签收与发布授权门。

## 已撤销的旧恢复切片（历史记录）

以下“Director固定前置 + R5执行production门”的切片已被当前R5权威口径撤销，仅保留为历史诊断，不得继续执行：

1. `ppt_director.plan_or_repair` 返回完整逐页 Director 结果，字段沿用已冻结的 `ppt-director-response` / `page-spec` 语义，并补齐当前 `PptDesignPackage` 已要求的可执行组合层、可编辑层、无障碍和样张计划。
2. 产品 Main Agent 在同一受控 ReAct 轮内先调用 Director，再调用高层业务 Tool `create_ppt_design_draft`。Main Agent 只决定调用顺序，不自行生成 PageSpec，也不接收 PPT 领域 Prompt。
3. 服务端只接受本轮、当前 project/IntentEpoch 下已通过 Agent Tool Router 合同校验的 Director 结果；模型参数不能覆盖这份服务端绑定。业务 Tool 将其机械转换为 `ppt-design-package.v1`，同时执行 `validatePptDesignPackage` 与 `validatePptDesignPackageForProviderProduction`。
4. 页数不一致、页码不连续、缺组合层、缺无障碍语义、通用占位页、重复教学动作、Director 自检失败或没有同轮 Director 结果时均失败关闭，不调用旧通用 `ppt_design` Runtime，不生成 deterministic fallback，也不保存半成品 Artifact。
5. 只有完整转换和全部门禁通过后，才原子保存一个 `ppt_design_draft`；失败只形成 Observation/Report，恢复入口仍绑定原 TaskBrief、IntentEpoch 和可信 `ppt_draft`。

本切片先以红测试冻结以上行为；定向测试和 TypeScript 通过后，只执行一次单节点真实恢复验证。该验证出现新证据后，才恢复桌面两用户黑盒；V1发布前不运行新的390px真实黑盒。
