# ShanHaiEdu 当前主线状态

更新时间：2026-07-17

## 1. 当前结论

- 最近完成主线：V1.0 Main Agent唯一编排与原子Tool控制面整改。
- 当前状态：**REMEDIATION VERIFIED / CONTRACT GO / PRODUCT E2E PARTIAL / RELEASE NOT STARTED**。
- 阶段A至E和8项P1、7项P2均通过本地整改门；完成计划已归档。
- 当前唯一活动阶段：项目开发门禁制度化。P0-05A入场审计已证明既有Provider ledger不是逐调用权威事实源；一次性capture bootstrap及脱敏逐调用事实源已提交到`main`，但P0-05A尚未激活。
- 当前阶段已形成clean提交并推送；GitHub Windows CI已通过Node门并在Vitest暴露无密钥TTS fixture和真实媒体二进制两个环境缺口。修复正在候选验证，尚未取得成功的clean manifest，真实Provider receipt仍未取得。
- 仓库已由所有者切换为公开；当前权威文档中的本机绝对路径正在改为仓库相对或环境中立说明，推送前同时执行不回显候选值的历史敏感信息审计。
- 已接受的唯一下一阶段候选是P0-05A“真实Provider连续性与V1-9就绪”；当前只完成roadmap规划，尚未取得活动阶段执行权。
- 整改前基线：`b4ad3849f6ae0953f3dfe856ce000e0def292023`，分支`main`；只本地提交，未push。
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

本轮审查确认的15项整改问题已关闭。防复发层已建立阶段路径、政策单调性、源码字符串合同、复杂度、SHA验证manifest和Provider receipt门；当前精确锁定26个源码字符串合同债务文件与31个复杂度债务文件，既存值只能收缩。真实Provider receipt尚不存在。新逐调用事实源已可记录SDK HTTP状态、timeout、哈希request ID、channel/model、usage和project/task/turn绑定，且不记录body、header、URL、凭据或错误原文；capture bootstrap仍明确返回`passed=false / deferred_capture_bootstrap`，release不接受。

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

## 6. 唯一下一动作

先完成全量本地验证，再审查并提交当前门禁阶段，在required CI中生成`dirty=false`且绑定候选SHA的manifest；没有clean manifest时不得关闭本阶段。之后只激活backlog `P0-05A`，先取得真实Provider连续性receipt并完成V1-9入口就绪审计；P0-05A Go后才允许进入P0-05B并创建新的V1-9 plan、manifest和runId。

## 7. 恢复入口

- 需求基线：`..\product\current-requirements-baseline.md`
- 设计基线：`..\architecture\V1.0 重构设计.md`
- 完成计划与测试证据：`..\archive\2026-07-17-agent-atomic-tool-remediation\README.md`
- 过期closeout：`..\archive\2026-07-17-remediation-baseline\v1-agent-atomic-tool-refactor-closeout.md`
- 当前门禁合同：`..\contracts\development-quality-gate.md`
- 当前门禁阶段：`..\stages\project-development-gates-plan.md`
- 下一阶段候选：`..\roadmap\product\p0-05a-provider-continuity-readiness-spec.md`
