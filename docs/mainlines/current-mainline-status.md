# ShanHaiEdu 当前主线状态

更新时间：2026-07-18

## 1. 当前结论

- 最近完成主线：V1.0 Main Agent唯一编排与原子Tool控制面整改。
- 当前状态：**REMEDIATION VERIFIED / CONTRACT GO / PRODUCT E2E PARTIAL / RELEASE NOT STARTED**。
- 阶段A至E和8项P1、7项P2均通过本地整改门；完成计划已归档。
- 项目开发门禁制度化阶段已关闭并归档；GitHub Windows clean CI artifact的HEAD、tree、工作树摘要、policy SHA、stage SHA和五项退出码均已逐字段复核一致。
- GitHub `main` 已将`quality-gates`设为required check；未要求PR review，`enforce_admins=false`，普通受保护写入禁止force-push和删除。管理员仍可绕过，不能表述为绝对不可绕过。
- 当前唯一活动阶段是P0-05A“真实Provider连续性与V1-9就绪”。本轮只实施离线readiness，`liveCallsAuthorized=false`，真实Provider receipt仍未取得。
- P0-05A离线readiness首批出口已落地：精确延期门、零请求授权preflight、物理隔离campaign目录、四场景顺序合同、来源绑定evidence builder、不可覆盖写入和失败关闭seal入口。旧v1 receipt已在活动阶段被禁止晋升。
- P0-05A本地`verify:local`只作为提交前dirty候选证据；最新候选仍须由同一工作树manifest、clean提交和远端`quality-gates`共同形成阶段证据，不能据此提升真实Provider、V1-9或release状态。
- P0-05A的fresh/baseline入口切片已由`9160694`完成并通过GitHub Actions run `29642751018`；远端artifact经仓内verifier复核为`dirty=false / checkCount=5`，HEAD `9160694`、tree `4cb8f70`、policy/stage SHA和五项退出码全部匹配。该证据不包含真实Provider、V1-9或媒体调用。
- 当前第2个串行切片是VR-A13产品服务端持久编排audit。A阶段已由`b2772a7`建立append-only schema/health、18个统一写入口、成员路由接入和AST门。B1已由`a1c170c`完成本地提交：Main Agent与artifact route使用固定authority入口，实际Tool/request反向核对action digest，claim与唯一running TurnJob、Invocation、ordinal和attempted audit同事务，terminal以running CAS与Observation/Event/resolved audit同事务；产品summary从完整SQLite窗口派生并拒绝状态漂移，同时允许合法Observation-only成功。B2的observer、runner与closeout新鲜复算仍blocked。
- 仓库为公开状态；当前权威文档和生产媒体解析中的本机绝对路径已清理。历史仍含非密钥旧本机路径，未获历史重写授权，不影响当前树口径。
- 整改前基线：`b4ad3849f6ae0953f3dfe856ce000e0def292023`，分支`main`；该提交现已进入`origin/main`历史。
- 目标架构仍是`..\architecture\V1.0 重构设计.md`；当前代码已通过本轮审查问题对应的本地合同与执行验证，但不能据此宣称完整产品E2E或release完成。
- R5整体尚未关闭。既有桌面单Tool成功和双Tool部分成功只证明局部产品链路；一次Main Agent续轮`502`仍是连续多轮稳定性缺口。
- V1-9、教师签收和发布均未开始；未调用本轮范围外的图片、视频、PPTX、ZIP或整包Provider，未运行390px真实黑盒。

## 2. 已实现事实

- assistant-ui已经接入项目MessagePart和AgentEventEnvelope，固定五阶段rail与legacy会话切换已退出生产入口。
- 生产消息路由使用native function-call控制面；外层`toolPlan`/`deliveryPlan`不在native turn执行下一Tool。
- TaskBrief、IntentEpoch、ExecutionEnvelope、ToolInvocation、ValidationReport、Observation、Artifact和事件已有持久化与测试基础。
- 明确“只做需求规格”的真实桌面回合只调用`create_requirement_spec`并产生真实文本Artifact；模糊“是否改视频”对话没有调用业务Tool或提升IntentEpoch。
- 最终包下载存在正式package asset反向绑定边界，没有发现已确认的现场拼包路径。

## 3. 当前未完成门

本轮审查确认的15项整改问题已关闭。防复发层已建立阶段路径、政策单调性、源码字符串合同、复杂度、SHA验证manifest和Provider receipt门；当前精确锁定26个源码字符串合同债务文件与31个复杂度债务文件，既存值只能收缩。真实Provider receipt尚不存在。新逐调用事实源已可记录SDK HTTP状态、timeout、哈希request ID摘要、channel/model fingerprint、usage和project/task/turn绑定，且不记录body、header、URL、凭据、完整模型名或错误原文；开发门明确返回`passed=false / deferred_readiness_implementation`，release不接受该延期。

产品层未完成项仍是连续多轮Provider稳定性、唯一V1-9真实全链路、教师签收与release；不得把开发门通过或bootstrap延期上推为这些事项完成。

## 4. 五层状态

| 证据层 | 当前状态 | 当前可声称 | 当前不可声称 |
|---|---|---|---|
| `contract` | go | 15项整改合同与全量回归通过 | V1-9和release合同通过 |
| `executor` | go | HumanGate、抢先控制、持久授权、逐Provider submission、原子事实、Artifact route TaskBrief、Provider安全失败和schema readiness通过 | 真实媒体与整包执行通过 |
| `model orchestration` | partial | 同task HumanGate checkpoint授权重绑定通过合同测试；单Tool真实桌面成功 | 连续多轮稳定、任意局部任务不扩张 |
| `product E2E` | partial | 桌面文本、范围、Tool、Observation和Artifact局部链路可见 | 双Tool及以上稳定、V1-9通过 |
| `release` | not started | 无 | 教师签收、部署或发布完成 |

## 5. 当前验证事实

- 整改前最近一次`npm test`：Node `383/384`，失败1项，Vitest未进入。
- 独立SQLite Vitest：`1509/1511`，195个测试文件，失败2项，分别暴露无pending改道和旧quick reply action问题。
- TypeScript在整改前审查时通过。
- 整改前`/api/health`虽返回200但只检查少量表；阶段D已修复，阶段E从最终工作树启动后返回200并证明关键schema与Artifact storage ready。
- 曾有一次未显式隔离的Vitest可能写入默认SQLite；未查询、未清理。`.tmp`测试库均不纳入Git。

以上数字只记录整改起点，不是当前通过证明；完成后以本轮实际命令结果替换。

阶段A新鲜证据：隔离SQLite单worker Vitest `167/167`，assistant-ui/composer Node合同`11/11`，TypeScript和`git diff --check`通过。该证据只证明阶段A contract/executor局部关闭，不上推为产品E2E、R5或release完成。

阶段B新鲜证据：隔离SQLite单worker合并Vitest `284/284`，补充TaskBrief/范围/conversation回归`107/107`和`99/99`，TypeScript与`git diff --check`通过。该证据只证明阶段B contract/executor局部关闭；未调用真实媒体Provider，不上推为连续多轮model orchestration、产品E2E、R5或release完成。

阶段C新鲜证据：隔离SQLite单worker合并Vitest `141/141`，assistant-ui event route与M58 Node合同`5/5`，TypeScript与`git diff --check`通过。该证据只证明Observation/ValidationReport身份、消息sequence、等待态和失败去重的contract/executor局部关闭，不上推为产品E2E、R5或release完成。

阶段D新鲜证据：隔离SQLite单worker合并Vitest `110/110`，production preflight Node合同`13/13`，TypeScript与`git diff --check`通过。该证据只证明Provider未配置安全失败与SQLite schema readiness的contract/executor局部关闭；未调用真实Provider，不上推为连续多轮model orchestration、产品E2E、R5或release完成。

阶段E最终证据：`npm test`中Node `387/387`、隔离SQLite单worker Vitest `1558/1558`；TypeScript通过；ESLint 0 error、150 warning；生产构建通过并保留13条动态文件追踪warning；desktop smoke通过；隔离实例health 200；1440x900真实浏览器完成登录、新建项目、普通讨论、局部需求规格和刷新终态，控制台0 error/0 warning。模糊讨论没有Tool/Artifact/IntentEpoch提升；局部回合仅1次`create_requirement_spec`和1个`requirement_spec` Artifact。未运行390px，未调用图片、视频、PPTX、ZIP或整包Provider。

工程残余：依赖安装审计报告6个moderate项；Lint 150条warning；Turbopack 13条动态文件追踪warning；首次子智能体隔离命令错误曾初始化默认`dev.db`，此后未读取或清理。以上不阻塞本地整改合同Go，但在release门必须重新评估。

项目开发门禁阶段新鲜证据：门禁专属Node测试59项中58项通过、1项因当前Windows不允许创建测试符号链接而跳过；生产门仍拒绝符号链接。`verify:local`中的开发门、TypeScript、Lint、全量测试和生产构建5项均返回0，并生成绑定当前HEAD、Git tree、dirty工作树摘要、政策SHA与阶段SHA的manifest。Lint保持150条既存warning，构建保持13条动态追踪warning。Provider开发门只返回`passed=false / deferred_bootstrap`；release模式因缺少真实receipt返回`PROVIDER_RECEIPT_MISSING`，未执行真实Provider连续性或release。

Provider capture入场新鲜证据：门禁/策略定向Node测试31项通过、1项Windows符号链接用例跳过；Provider trace、GPT协议、Main Agent和conversation turn相关Vitest `125/125`；标准全量`npm test`为Node `387/387`、Vitest `1562/1562`（197个文件）；TypeScript和生产构建通过，构建仍保留13条既存动态追踪warning。第一次全量入口暴露并修复旧源码字符串合同兼容表达；第二次因新增独立Prisma夹具导致共享SQLite锁冲突，删除重复夹具并把断言并入既有queued recovery用例后全量测试通过。以上均未调用真实Provider，不能上推为连续性receipt或model orchestration Go。

clean CI新鲜证据：`d03fdc1`对应的`quality-gates #29581139816`已通过开发门、TypeScript、Lint和Node `387/387`，Vitest为`1555/1562`。7项失败全部发生在环境前置：3项因`tts_minimax` fixture漏声明`MINIMAX_TTS_VOICE_ID`，4项因runner不存在真实`ffmpeg`/`ffprobe`/`soffice`。当前修复补齐fixture声明并安装、解析真实工具；在下一次clean CI成功前，本阶段继续保持open。

`2cfd0d1`对应的`quality-gates #29584259746`已真实通过FFmpeg、FFprobe、LibreOffice安装与解析，但继续暴露Poppler缺失、TTS显式ambient env未绑定仓内fixture根，以及health隔离schema初始化超过默认5秒。当前修复安装并解析真实Poppler、固定TTS fixture根，并仅把该health真实集成用例上限设为15秒；在新的clean CI成功前本阶段仍保持open。

`a902fff`对应的`quality-gates #29585541992`确认Chocolatey Poppler安装成功，但没有生成`pdfinfo.exe`/`pdftoppm.exe`命令shim，因此在测试前失败。当前workflow改从Chocolatey受控包目录解析并验证实际二进制；新的clean CI成功前本阶段继续open。

`cd4c0a4`对应的`quality-gates #29586316465`证明当前Chocolatey `poppler 26.6.0`实际只部署源码，受控目录内不存在两项Windows可执行文件。经检查版本化nupkg，workflow将Poppler固定为明确包含两项二进制的`22.11.0.20240421`；新的clean CI成功前本阶段继续open。

`0e86bcc`对应的`quality-gates #29587676121`已通过五种原生工具安装、路径解析和`npm ci`，Vitest继续暴露TTS缺配置分支漏绑fixture、`health-readiness`默认5秒，以及关键样张真实转换的命令阶段不透明。当前修复统一fixture根、给三个health readiness真实集成用例15秒上限，并为LibreOffice使用唯一profile和稳定阶段错误码；新的clean CI成功前本阶段继续open。

`49b13a6`对应的`quality-gates #29589384837`证明TTS和两组health已关闭，唯一失败为`ppt_sample_pdf_render_failed`。相同旧Poppler二进制在本机通过，但hosted runner真实转换失败；workflow现改用WinGet固定并校验的`oschwartz10612.Poppler 25.07.0-0`，安装到runner临时根并先真实执行两项版本命令。新的clean CI成功前本阶段继续open。

`38f38d6`对应的`quality-gates #29590674850`已全绿并上传`dirty=false` artifact；HEAD、tree与五项退出码匹配，但跨机器复核发现policy/stage SHA不一致。根因是这两个manifest输入尚未固定LF checkout；当前已把它们纳入`.gitattributes`和政策门强制检查，新的artifact跨机器SHA一致前本阶段继续open。

`88dae43`对应的`quality-gates #29592707672`最终成功。artifact绑定HEAD `88dae43c3cd2d71b792388ad15b93a74d4ac7bac`、tree `f627885628a763af1583d8a30af329ac19c69c66`、`dirty=false`、policy SHA `139e5d3173e23a3be9c914a3273764084b1f4d4d36fc3289d08d7923f18c363a`和stage SHA `2b20aca14f795832a57fae8317d923869e4482c513c86c8a3f76766c5051d637`；development-gates、typecheck、lint、test、build五项退出码均为0。仓内严格校验器返回`ok=true / checkCount=5`。项目开发门禁阶段据此关闭，但该证据不包含真实Provider连续性。

阶段切换提交`336e6b3`对应的`quality-gates #29594958239`成功，证明归档和新活动阶段合同在clean Windows checkout下通过唯一CI入口。由于`enforce_admins=false`，该提交直推时由管理员绕过事前required check，CI在push后运行；这项设置仍是治理残余，不得表述为管理员不可绕过。

P0-05A离线readiness定向证据：Provider trace、GPT协议、conversation turn与Main Agent Vitest `125/125`；相关门禁Node合同`40/41`，唯一跳过项为当前Windows不允许创建测试符号链接；TypeScript通过。实际`gate:provider:impact`返回`impacted=true`，`gate:provider:verify`返回`passed=false / deferred_readiness_implementation`；无授权live preflight退出1且`CAMPAIGN_CREATED=false`，无证据seal退出1。`gate:development`对43个变更文件的路径和行数预算检查通过，26个源码字符串债务文件和31个复杂度债务文件均未增长。以上均未调用真实Provider。

P0-05A全量验证曾连续两次在单个长寿Vitest worker末段出现`Worker exited unexpectedly`；其中一次表面落在`external-audit-evidence-ingress`初始化，但该文件隔离复跑`16/16`通过。测试入口已改为两个顺序分片，每片单worker、禁止文件并行、使用独立SQLite并在分片间重启worker，不减少测试集合。独立报告为第1分片`770/770`、第2分片`794/794`，合计Vitest `1564/1564`；后续全流程又出现一次Node并发瞬时失败而同命令隔离复跑`384/384`，Node入口也已固定`--test-concurrency=1`。所有最终证据以当前manifest和clean CI为准。未发现残留Vitest、Jest或Playwright worker。

提交前独立审查进一步阻塞了原候选：capture路径未位于campaign、调用序号会随recorder重建归1、evidence可省略失败trace且scenario仍由runner自报、D没有真实post-tool调用、live授权只校验格式、Tool调用缺显式phase/channel、archive例外未撤销。当前实现已把阶段基线固定到`336e6b3`并撤销archive例外；trace严格写入匹配campaign、序号按同一turn跨recorder连续、Tool使用`tool` phase与显式channel；campaign evidence只接受阶段预绑定公钥验证过的v2 source index，枚举capture目录全部文件并校验四场景Tool/Artifact/Observation/Intent与D的真实`post_tool`调用，最多输出`source-verified`。首批离线readiness提交`b013a96`及`quality-gates #29630858178`已通过，clean manifest全部字段匹配。当前切片已在本地完成双签名signer、v2 receipt重建验证、trust store、trace落盘失败关闭和writer路径安全：独立ledger-authority key先绑定受保护环境、campaign nonce、server、run、全部facts/capture SHA、eventId和成本，capture key才可签最终index；主verifier集成测试证明其从真实trust-store返回实际验签receipt字节SHA与当前Git subject。当前阶段仍保持`liveCallsAuthorized=false`、`liveAuthorization=null`、空capture key和空ledger-authority key，因此真实证据继续失败关闭。

精确暂存复核又发现旧`workingTreeDigest`会因“未跟踪文件变为已暂存”而漂移，即使文件字节完全不变。runner与verifier现共用内容摘要模块，按相对路径、当前文件SHA或删除标记计算，staged/unstaged/untracked只要工作树内容相同就保持同一摘要，实际字节变化仍会改变摘要；相关manifest脚本已纳入Provider敏感路径，后续修改必须触发continuity门。

提交前独立安全复核还发现verification runner会在完成物理路径检查前删除配置目标。当前只允许仓库相对`.tmp/verification/**`输出，并在任何删除前逐段拒绝绝对路径、反斜杠、路径逃逸、junction/reparse/symlink、非目录父级和非普通文件目标；manifest写入后重新采集subject，若输出导致候选漂移则删除manifest并失败。对应合同为`PC-A26`。

V1-9入口二次只读审查及提交前并发审查确认fresh/baseline合同出口已经关闭：fresh只允许active pointer不存在并使用no-replace hard-link发布；successor保护history并对遵守共享prepare锁的仓内pointer writer执行协作式CAS；closeout在同字节双pointer时幂等前滚、异字节失败关闭，活PID不因TTL被接管；termination与closeout共用exact-byte run-state cooperative CAS；legacy v1仅可只读解析，不能进入活动执行；签名campaign自身受TTL约束。baseline v2绑定clean verification、policy/stage、Provider manifest/receipt及签名evidence root摘要。产品持久编排audit的B1服务端事实层已由`a1c170c`提交，但B2消费与复算层仍未关闭。P0-05A仍为NO-GO，剩余阻塞是B2、runner恢复权、恢复身份精确绑定和真实receipt。完整媒体preflight退出P0-05A，只保留给P0-05B。

## 6. 唯一下一动作

当前唯一动作是以`a1c170c`为新基线进入B2：run-state保存服务端summary投影；observer每次重新登录读取fresh snapshot；runner停机后独立读取SQLite；closeout直接复算SQLite并与投影比对。缺摘要、水位回退、同水位digest变化、新violation或open attempt全部拒绝。B2完成独立验证与clean CI后才进入DB recovery与恢复身份精确绑定。真实Provider连续3组仍等待用户另行批准。

## 7. 恢复入口

- 需求基线：`..\product\current-requirements-baseline.md`
- 设计基线：`..\architecture\V1.0 重构设计.md`
- 完成计划与测试证据：`..\archive\2026-07-17-agent-atomic-tool-remediation\README.md`
- 过期closeout：`..\archive\2026-07-17-remediation-baseline\v1-agent-atomic-tool-refactor-closeout.md`
- 当前门禁合同：`..\contracts\development-quality-gate.md`
- 已归档门禁阶段：`..\archive\2026-07-17-project-development-gates\README.md`
- 当前P0-05A规格：`..\product\p0-05a-provider-continuity-readiness-spec.md`
- 当前P0-05A计划：`..\stages\p0-05a-provider-continuity-readiness-plan.md`
