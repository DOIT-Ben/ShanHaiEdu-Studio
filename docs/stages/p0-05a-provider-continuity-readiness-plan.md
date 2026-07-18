# P0-05A真实Provider连续性与V1-9就绪实施计划

日期：2026-07-17
状态：active / offline-readiness-only / live-campaign-not-authorized

本阶段当前机器基线为已通过远端clean CI并由仓内verifier复核的 `916069497031519bff7cd530ea9c0743f0d9f2e3`；此前门禁阶段归档已退出活动例外，archive重新不可修改。当前执行权只覆盖离线 harness、证据来源绑定、隔离生命周期、失败关闭和 V1-9 入口就绪审计；`liveCallsAuthorized=false`且`liveAuthorization=null`。在用户另行批准 Provider channel、model fingerprint、总费用、最大调用次数和授权摘要，并完成受保护环境与ledger权威验证器前，任何真实入口必须在创建客户端和启动服务前以零 Provider 请求失败。

安全审查确认旧v1 receipt只能证明JSON自洽，不能证明真实来源。活动阶段已改为只接受未来的v2签名来源合同，并保持`trustedCaptureKeyIds=[]`；因此本轮离线实现不可能签发passed receipt。可信key必须由受保护环境持有私钥，活动阶段只预绑定非敏感key ID和公钥摘要。

## 1. 唯一路线

```text
当前门禁阶段clean提交与CI
-> Provider权威事实源/捕获bootstrap决策
-> 激活P0-05A
-> 红测试与证据合同
-> live harness和隔离生命周期
-> V1-9入口就绪审计与必要适配
-> 完整离线验证并冻结候选
-> 真实Provider连续3组
-> P0-05A Go/No-Go
-> 仅Go时规划P0-05B
```

各步骤严格串行。不得在连续性未关闭时并行启动完整V1-9，也不得在真实运行开始后继续修改候选代码并沿用旧证据。

## 2. 阶段0：关闭当前门禁阶段（已完成）

目标：形成可作为P0-05A基线的clean候选。

任务：

- 审查并提交当前门禁阶段，工作树必须clean。
- 在required CI运行`verify:ci`，下载并核验`dirty=false` manifest。
- 把当前阶段plan/test-plan按项目归档规则迁移并记录SHA-256；历史原文不改。
- 用clean HEAD建立新的P0-05A `active-stage.json`，只允许本计划明确文件。
- 已确认现有Provider adapter evidence不足；当前门禁阶段已建立精确capture bootstrap和脱敏逐调用事实源，包含HTTP状态、timeout、request-id摘要、channel/model、usage及project/task/turn绑定，且仍保持`passed=false`。首批离线readiness已在`b013a96`完成提交、推送和clean CI manifest核验。

验收结果：GitHub Actions run `29592707672` 的 artifact 与本机重算的 HEAD、tree、working tree digest、policy SHA、stage SHA 一致，五项检查退出码均为0；`quality-gates` 已成为 `main` required check。旧阶段原件已按逐文件 SHA-256 归档。

## 3. 阶段1：证据合同和红测试

状态：v2签名source index验证、capture全文件枚举、SHA重算、scenario绑定和Tool trace合同已实现；当前代码切片已完成独立ledger-authority attestation、capture signer、v2 receipt验证、trace落盘失败关闭、trust store和writer路径安全，未启动真实driver。

目标：先证明现有系统不能生成合格真实receipt，再实现。

任务：

- 为live harness参数、显式ledger binding、费用预算和隔离路径写合同测试。
- 为真实事件到scenario evidence的确定性映射写测试。
- 为Provider边界事实优先于UI/runner自报字段、场景C/D共享`teacherMessageId`和`turnJobId`写失败测试。
- 为manifest/receipt原子写、目录额外文件、路径逃逸、候选漂移和重封装旧run写失败测试。
- 给`package.json`新增唯一`gate:provider:live`命令合同测试。
- ledger-authority issuer必须从产品DB和只追加ledger自行导出完整事实并用独立key签名；capture signer不得接受调用方自报attestation，只能验证其campaign nonce、环境、server、run、全部文件SHA、eventId和成本后再生成index。
- capture signer必须自行枚举capture/facts并生成确定性index，只调用第二个受保护签名接口；两层只接受`Ed25519`和固定用途域，key ID与公钥摘要必须相互独立，私钥不得进入仓库、命令参数、日志、fixture输出或receipt。
- trace recorder存在时，任何落盘失败都必须使当前Provider调用/campaign失败，不能吞错后继续晋升。

验收：新增特征测试因入口缺失或证据不完整而红；现有provider verifier测试保持绿。

## 4. 阶段2：live harness与隔离生命周期

状态：离线授权匹配、隔离目录和四场景状态机已实现；当前授权为空，真实产品Playwright driver、受保护环境验证器和ledger绑定验证器未实现、未运行。

目标：通过真实产品入口驱动四场景，并安全保存原始事实。

任务：

- 建立独立进程生命周期：隔离端口、SQLite、Artifact root、evidence root和超时终止。
- 运行capability-scoped preflight，只校验实际文本能力和显式ledger channel。
- 通过desktop Playwright登录、新建隔离项目并顺序提交四场景。
- 捕获原始HTTP状态、事件cursor、ToolInvocation、Observation、Artifact和IntentEpoch前后值。
- 三组campaign共用同一production server进程；任何服务重启都使campaign失败。
- 正常、失败、Ctrl+C和超时都先落失败事实，再停止子进程；不得遗留worker。

验收：离线生命周期测试通过；没有Provider授权时命令失败关闭且不产生passed receipt。

## 5. 阶段3：证据与receipt生成

状态：双签名signer合同、签名source index验证、capture全文件枚举、SHA重算、scenario/Provider call对齐builder、v2重建verifier和安全writer均已实现；builder最多输出`source-verified`。主verifier已消费v2结果并原子返回实际receipt字节SHA与subject；当前capture与ledger-authority可信key均为空，仍不能签发真实passed receipt。

目标：只从实际持久事实确定性生成verifier可接受的两文件证据。

任务：

- 每组运行写一个不可覆盖evidence文档，包含四场景和候选subject。
- evidence只接受运行时Provider轨迹中的status/timeout/mode；Playwright或runner提供的不一致值必须失败。
- manifest只描述subject、期望场景与evidence路径，不引用自身。
- manifest绑定clean verification manifest、subject、policy/stage SHA、授权channel/model、预算、ledger、server实例和精确run数。
- receipt绑定manifest SHA和精确`1..N` campaign；verifier必须重新验签source index、重建evidence并返回它实际读取字节的`receiptSha256`与已验证subject，baseline不得二次重读receipt计算摘要。
- 写入使用临时文件加原子rename；目标存在时拒绝覆盖。
- 生成后立即调用现有verifier，验证失败则整组失败。

验收：篡改任一字段、文件、时间、SHA或目录内容均失败；日志和JSON不含凭据。

## 6. 阶段4：V1-9入口就绪审计与最小适配

状态：第1个串行切片fresh/baseline已由`9160694`和GitHub Actions run `29642751018`关闭。VR-A13A/B已由`b2772a7`、`a1c170c`、`db5af68`和最终重锚`781af1f`关闭，`quality-gates #29651142001`及其SHA-bound artifact已通过仓内verifier。当前唯一实现切片切换为VR-A14/A16 DB recovery与恢复身份精确绑定；仍为offline-only，不与真实Provider、V1-9或媒体测试并行。矩阵见`p0-05a-v1-9-readiness-matrix.md`。

目标：让P0-05B拥有当前合同入口，而不是恢复整改前运行。

最小适配拆成三个严格串行切片：

1. fresh/baseline：`prepare-v1-9-run`、preparation transaction、单一prompt合同、可空predecessor和baseline lock v2；
2. 产品audit：服务端持久记录项目写attempt与Main Agent编排authority，observer只消费权威摘要；
3. DB recovery：产品启动从精确绑定的TurnJob、task、epoch、message和checkpoint派生恢复动作，runner不再传恢复布尔。

DB recovery采用唯一数据流：

```text
Next instrumentation启动
-> 读取当前v2 pointer、v2 manifest、v3 run-state与同run SQLite
-> SQLite精确匹配project/task/epoch/teacher message/TurnJob/checkpoint/actor/auth/session/plan
-> 产品派生唯一typed disposition：none / interrupted_running / checkpoint / provider_health / contract_repair / external_audit
-> 仅验证该disposition需要的typed evidence；env最多提供证据locator
-> repository事务内原子requeue或claim
-> 获取新project lease与fencing token
-> 只drain该精确project/job
```

runner可以传冻结路径、run身份、Provider配置和可选证据locator，但不得传恢复布尔、恢复类型、待恢复job或“取latest”提示。没有恢复事实时返回`none`；存在恢复声明但身份、checkpoint或证据错误时，instrumentation必须在服务ready前失败关闭，不允许只写日志后继续启动。

实现严格拆为两个串行切片：

1. VR-A14：移除`SHANHAI_RECOVER_RETRYABLE_TURNS_ON_START`控制权，新增DB-first typed disposition与真实SQLite行为测试；证明interrupted running只在exact TurnJob锁过期、无其他active job时由现有lease/fence路径接管。
2. VR-A16：把Provider-health、contract-repair、external-audit与checkpoint全部绑定当前v2 manifest、v3 run-state和同一DB身份；`turnJobId`与`teacherMessageId`不得同时为空，legacy v1只读兼容不能进入活动恢复。

本轮假设当前SQLite字段足够表达恢复身份，不新增schema；若红测试证明必须改schema，先更新架构与阶段合同并单独批准，不能在实现中静默扩表。

产品audit内部只走一条路线：VR-A13A关闭HTTP ingress与SQLite边界；VR-A13B1关闭Tool selector、实际action、连续ordinal、强终态与完整服务端summary；VR-A13B2再让run-state、observer、runner和closeout消费并独立复算该summary。B2不得复制摘要算法或信任浏览器自报值。

VR-A13采用唯一事实链，不复用普通`AuditLog`：

- 认证与CSRF通过后、业务handler执行前，服务端先追加写attempt；attempt写入失败则不得执行业务写。
- 业务返回、拒绝或失败分别追加不可覆盖终态；只有attempt没有终态视为中断异常，不能被解释为成功或零违规。
- 审计只保存服务端操作枚举、路由模板、身份快照和必要digest，不保存body、query、header、Cookie、原始session、凭据、完整ExecutionEnvelope或错误原文。
- Main Agent Tool claim与持久`ToolInvocation`、冻结TaskAggregate/TurnJob身份和selector authority同事务；artifact route、runner、Skill、Director、Critic或兼容层不能声明`main_agent`。
- `actionDigest`必须由服务端从实际`toolName + request`重算；Tool ordinal、started/terminal事实和plan身份必须连续并交叉绑定。
- Invocation、Observation、AgentEvent与resolved audit必须按同一终态矩阵绑定；状态冲突在写事务和summary复算两层失败关闭。只有`needs_input + decision_pending`表示Tool执行成功但业务等待教师；被策略阻断写`blocked/rejected`，执行或验证失败写`failed`。
- Artifact要求由真实终态事件和持久引用决定；合法Observation-only成功不得被伪判为缺Artifact，`artifact_committed`也不得逃避Artifact交叉绑定。
- 产品侧从完整SQLite事实生成脱敏摘要和摘要digest；observer不得传入可裁剪窗口，不得从浏览器监听或run-state自造count、authority或零值。
- 成员管理等绕过统一workbench wrapper的现存写入口必须并入同一审计边界；新增写route由机器门禁扫描并失败关闭。

已关闭的VR-A13切片明确不再修改。当前VR-A14/A16排除schema、Tool选择、authority摘要、真实Provider、真实V1-9、PPT、图片、视频、PPTX、ZIP和390px验证；只允许活动阶段列出的恢复入口、持久身份、测试和权威文档。

fresh/baseline切片只修改`v1-9-e2e-contract`、`v1-9-baseline-lock`及其候选证据模块、`v1-9-run-preparation-transaction`、prepare/runner入口及行为测试。当前验收事实：fresh输入不含旧run身份且active pointer不存在时可准备；opaque history保持原字节，任何既有active pointer都失败关闭，新manifest写`predecessor: null`；部分predecessor输入在任何写入前失败；fresh事务覆盖journal、manifest、state、staged、run publish、最终pointer窗口和pointer publish故障恢复；successor不覆盖并发history，也不覆盖遵守共享prepare锁的仓内pointer writer；closeout同字节双pointer可前滚、异字节失败关闭，活PID不因TTL接管，termination与closeout共用run-state cooperative CAS；所有I/O拒绝仓外junction/reparse；新baseline只产生`v1-9-baseline-lock.v2`并绑定clean verification、policy/stage、Provider manifest/receipt、签名evidence root摘要和同一候选subject，facts与trace由source-index SHA传递绑定，正常提交与崩溃恢复均在pointer发布前后重验；旧v1只读解析且活动入口拒绝执行，签名campaign自身受TTL约束；prepare和runner不再保存prompt全文。

fresh/baseline与VR-A13预算均已关闭且不结转。VR-A14/A16从`781af1f`重新计算，预算为最多24个实际变更文件、`+2200/-800`、零二进制；活动路径已收窄为31个恢复相关文件。超出时拆分后续切片，不提高阈值、不恢复旧audit路径。

必须回答：

- fresh run是否仍被硬编码历史predecessor或历史manifest SHA阻塞；
- runner是否仍通过M67兼容入口、阶段进度或环境变量取得第二编排权；
- observer是否只观察产品Main Agent，且不固定Tool顺序；
- `externalCodexOrchestrationCount === 0`是否绑定产品侧权威事件，而不只是浏览器“未观察到”；
- TaskBrief、IntentEpoch、ExecutionEnvelope、Provider binding和package asset是否使用当前合同；
- baseline lock是否纳入clean verification manifest、policy SHA、stage SHA和Provider continuity receipt；
- 重复冻结prompt是否已收敛为单一合同；完整媒体preflight是否与本阶段capability-scoped preflight分责；
- 中断、恢复和合同升级是否终止旧run并创建显式后继。

只做进入P0-05B所必需的最小适配。每个切片先写行为测试并独立验证；不得伪造genesis predecessor、默认authority为零、用observer自报替代产品audit，或用mock改run-state冒充真实SQLite恢复。

验收：形成`reuse / adapt / retire / blocked`矩阵；所有`adapt`已有绿测试，所有`blocked`都会使P0-05A No-Go。

## 7. 阶段5：完整离线验证与冻结

状态：首批离线readiness提交`b013a96`及GitHub Actions run`29630858178`已通过。signer/v2切片提交`9a936ad`及GitHub Actions run`29634821620`也已通过，远端manifest为`dirty=false`且SHA-bound verification完整成功；两次证据均不包含真实Provider调用或passed receipt。

目标：在真实费用发生前冻结唯一候选。

命令：

```powershell
npm run gate:development
npm run typecheck
npm run lint -- --max-warnings 150
npm test
npm run build
npm run verify:local
npm run gate:manifest:verify
```

本地验证曾连续两次在单个长寿Vitest worker末段异常退出，隔离复跑未发现业务测试失败；后续全流程还出现一次Node并发瞬时失败，同命令隔离复跑通过。测试入口现把Node固定为单并发，并把Vitest拆为两个顺序分片，每片单worker、禁止文件并行、独立SQLite并重启worker，不减少测试集合。最终工作树验证通过、clean提交和CI通过后，再记录candidate HEAD、tree、working tree clean状态、policy SHA、stage SHA、provider channel、model fingerprint、合同版本和费用授权版本。此后任何字节变化都终止本轮连续性计数。

提交前manifest摘要必须只绑定工作树内容，不绑定文件处于untracked、staged或unstaged的Git形态；仅执行`git add`不得改变`workingTreeDigest`，实际字节、路径或删除状态变化必须改变摘要。runner与verifier必须调用同一实现，防止双口径。

提交前独立审查发现的verification输出路径P1已修复：runner只接受仓库相对`.tmp/verification/**`目标，在任何删除或写入前逐段拒绝绝对路径、反斜杠、路径逃逸、junction/reparse/symlink、非目录父级和非普通文件目标；manifest原子写入后必须重新采集subject，若输出本身改变候选工作树则删除manifest并失败，不能留下伪成功证据。

## 8. 阶段6：真实连续运行

目标：最终候选完成连续3组真实四场景序列。

规则：

- 每组使用新project/task和独立证据目录，不复用上组Artifact。
- 三组使用同一production server进程且严格串行；不接受并行、进程重启或跨campaign拼接。
- 组内四场景按policy顺序执行并绑定同一隔离task语义。
- 任一5xx、timeout、禁用模式、范围外Tool、重复Tool、Artifact/Observation缺失或IntentEpoch错误，整组失败。
- 失败后先保存证据并定位根因；修复会产生新候选，连续计数从0重启。
- SDK最终成功、人工补JSON或挑选成功组都不能修复失败计数。

验收：连续3组全部通过，receipt verifier在最终候选上返回passed。

## 9. 阶段7：收口

输出：

- P0-05A closeout，分别记录contract、executor、model orchestration、product E2E和release状态；
- Provider manifest、receipt和evidence artifact索引；
- V1-9就绪矩阵；
- P0-05B是否可启动的单一Go/No-Go结论。

P0-05A Go只关闭真实文本/Main Agent连续性与入口就绪，不创建V1-9 runId、不调用媒体Provider、不进入教师签收或release。

## 10. 任务拆分

| 任务 | 主要文件上限 | 验收 |
|---|---:|---|
| A1 激活与基线 | 4 | clean CI manifest与新active stage一致 |
| A2 harness合同红测试 | 4 | 缺入口、越界、伪证据均红 |
| A2b Provider事实源 | 5 | UI自报不可覆盖运行时status/timeout，C/D关联强制 |
| A3 进程与隔离实现 | 5 | 正常/失败/中断无残留且不污染默认DB |
| A4 四场景真实driver | 5 | desktop产品入口和原始状态完整 |
| A5 evidence/receipt writer | 5 | 原子写、不可覆盖、现存verifier通过 |
| A6 V1-9 fresh-run合同 | 5 | 不依赖旧predecessor且历史证据只读 |
| A7a DB disposition红测试 | 5 | env不能选择恢复；SQLite身份错绑、其他active job和非过期running均失败 |
| A7b typed recovery实现 | 5 | 只返回唯一disposition，对应evidence与v2/v3/DB同源绑定 |
| A7c startup/runner归权 | 5 | runner不传恢复布尔；非法恢复阻止ready；exact job用新lease/fence drain |
| A8 冻结与真实3组 | 文档/证据 | 同一候选连续通过，失败从0重启 |
| A9 收口 | 4 | 五层口径和P0-05B Go/No-Go一致 |

## 11. 风险与回退

| 风险 | 门禁 | 回退 |
|---|---|---|
| 502被SDK重试掩盖 | 保留全部原始HTTP状态 | 本组失败，修复后新候选从0开始 |
| 测试脚本自报real-provider | Provider边界append-only事实源 | 字段不一致即失败，不生成receipt |
| 默认SQLite或Artifact污染 | 每组唯一绝对路径并验证 | 停止运行，保留失败证据，不清理用户数据 |
| 旧V1-9 predecessor复活 | fresh-run红测试和就绪矩阵 | 标记blocked，不创建runId |
| harness成为第二编排者 | 只提交教师输入和观察事实 | 删除强制Tool/next-step逻辑 |
| 费用失控 | IntentGrant与阶段总预算双门 | 达上限立即失败并保存恢复点 |
| receipt伪造或重封装 | subject、时间窗、文件集和SHA重算 | verifier失败，receipt不得晋升 |
| nonce被解释为跨历史一次性凭证 | 当前只保证同一receipt内唯一，真实issuer尚未接线 | live切片必须决定是否增加预发challenge与持久消费账本，不得沿用本阶段口径上推 |
| Provider门禁巨型模块继续增长 | 当前`provider-continuity.mjs`仍超过500行且`scripts`未进入复杂度扫描 | 后续新增职责前先拆出v1/v2路由与阶段合同，并单独规划scripts复杂度ratchet |

回退只撤销P0-05A新增代码和接线；不恢复旧runner控制权，不覆盖历史证据，不删除真实失败记录。
