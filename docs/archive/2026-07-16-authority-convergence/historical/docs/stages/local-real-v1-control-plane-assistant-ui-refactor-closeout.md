# V1 控制面与 assistant-ui 定向重构收尾

日期：2026-07-15

状态：`A10-A23 contract and executor passed / R5 historical pass retained / A23 start-new decision formed / unique V1-9 preflight pending`

> 本 closeout 同时保留第一轮实现证据和独立审计后的 A10-A23 最终关闭结果。离线合同与执行器通过不等于真实模型、V1-9产品全链路或发布通过；当前恢复边界以 plan、test-plan 和 `current-mainline-status.md` 为准。

## 1. 收尾结论

第一轮实现关闭了原接管审计中的六个仓内P1并完成assistant-ui消息Runtime前移；独立审计重开的事件恢复、A/B控制权、同任务恢复、Envelope、原子提交、Provider台账和Skill Runtime问题现已通过A10-A23关闭。R5真实桌面历史证据保留且不重跑；旧V1-9只读保留，A23新run等待全量仓内回归与只读preflight。

已关闭：

- 控制消息先持久化，再允许Main Agent或Tool执行；无pending plan的自然语言改道同样递增IntentEpoch或等价revision。
- 结构化TaskBrief、IntentGrant、强度、授权、计划revision和幂等键进入强制ExecutionEnvelope与ToolExecutionGateway。
- ToolInvocation、ValidationReport、Observation、Artifact与教师安全事件通过原子结果提交边界持久化。
- Main Agent原生function-call循环是唯一业务Tool编排者；兼容层不再选择、强制或执行下一Tool。
- 跨轮语义快照保留目标、约束、排除项、IntentEpoch、计划revision、可信Artifact和Observation引用。
- assistant-ui `ExternalStoreRuntime`成为目标对话Runtime；项目自有九类MessagePart和AgentEventEnvelope仍是数据库/API合同，旧UI只作互斥回退。
- Responses Runtime与OpenAI Agents SDK完成隔离A/B；SDK不拥有业务状态、Gateway、重试或停止权。
- 业务Skill通过项目自有Registry、Resolver和Invocation Gateway增强高层Tool；Skill不能接管Main Agent，也不能绕过ExecutionEnvelope、权限、费用、质量和副作用门。
- 六个`formal_contract`业务Tool在成功提交前通过明确Adapter形成Skill payload并执行Draft 2020-12 Schema；合同失败原子保存ValidationReport、Observation和Event，Artifact为0。
- 活动正式合同为`shanhai-imagegen 1.1 / shanhai-imagegen/v2`、`shanhai-video-generation 1.1 / shanhai-video-generation/v2`和`shanhai-delivery 1.3 / shanhai-delivery/v2`；Skill只增强当前Tool，不拥有Provider选择、重试、下一Tool或停止权。

## 2. 五层验收

| 证据层 | 结论 | 证据边界 |
|---|---|---|
| `contract` | passed through A23 | 六个P1、消息/事件、PPT候选分层、Provider/Skill lock、正式Schema和四个Tool产物Adapter均有自动化合同 |
| `executor` | passed through A23 | SQLite持久化、Gateway、强制Envelope、原子提交、单一编排者、assistant-ui Adapter、恢复、A/B与正式Schema失败关闭通过 |
| `model orchestration` | R5 historical pass / V1-9 pending | 既有R5真实桌面证明动态Tool、Observation/Replan、局部任务和一句话PPT候选；本轮未新增模型证据 |
| `product E2E` | R5 historical pass / old V1-9 read-only failed / A23 new run not started | 旧任务、旧manifest和旧锁只保留历史证据；新run尚无PPTX、MP4或ZIP |
| `release` | not started | V1-9、教师签收、V1-10切流均未完成 |

## 3. 最新验证

```text
npx vitest run tests/agent-runtime/main-agent-tool-loop-config.test.ts --maxWorkers=1
  isolated red: 1 file / 3 failed / 23 passed
  green: 1 file / 26 passed

A23 focused
  9 files / 132 tests / 0 failed

control-plane expanded
  24 files / 247 tests / 0 failed

VITEST_MAX_WORKERS=1 npm test
  Node 302/302
  Vitest 185 files / 1343 tests

npx tsc --noEmit
  exit 0

npm run build
  13 static pages / exit 0
  12 existing Turbopack dynamic-path warnings; exit 0

ShanHai Skill suite and quick validation
  unittest 53/53
  imagegen 1.1 / video-generation 1.1 / delivery 1.3 valid

git diff --check
  exit 0; line-ending warnings only
```

测试结束后未发现属于当前仓的Vitest、Jest、Next build或Playwright残留worker；PID 79188和35572为本轮前已存在、未绑定当前仓命令行的Playwright CLI daemon，未终止。

## 4. R5历史证据与V1-9交接

R5最终真实桌面证据：

```text
test-results\m67-e2e-21008-1784056471438\
test-results\v1-9r-two-user-summary.json
```

该运行使用真实Main Agent、独立SQLite、独立Next app root、动态端口、单worker、`M67_E2E_DETERMINISTIC=0`和`chromium-desktop`。B侧局部视频脚本、一句话PPT可信设计候选、改道、重复失败恢复和双用户隔离通过；外部Codex编排介入0、GenerationJob 0、无真实媒体调用。390px按V1前门禁未运行。

R5关闭后唯一V1-9真实运行已经启动，`runId=v1-9-20260714212914-a036beb9`保持`paused_recovery`。不可变manifest仍绑定旧projection `1d3e8b3285322a732df1af9571dfd467f3f7f9dc5b0b2a806b4f9cc43cd4bc5c`与旧policy `4b37a569f1f3407cce76b4bb086fc8d78ac99ebc31dae033cb4c6c04ec0c8ed9`；活动A23候选分别为`4d2158e8c0e01f96bd677c4bf46a3b5d5ac1caff6c17d849f7077f59028855aa`与`3dbabbcef958225c69bb68716230a12dab1bd05e6380bd6105d16663da78d62c`。manifest SHA-256在本轮前后均为`a7bae74ce472f9826dae9e85ab096b787f77527a153df4defc73bce0d2db698c`，没有被静默改写。

最新决定：不恢复或改写本节记录的旧run；先按当前`main`、需求基线、原`shanhaiedu-技能系统`活动Registry、其A23冻结投影、Binding Policy与Provider台账完成新run仓内preflight，再显式创建后继run。不得重跑R5/390px，也不得在preflight前创建第二个完整任务。

## 5. 回退与残余风险

- assistant-ui回退只切换UI Runtime，不回滚消息、Artifact或控制面状态。
- 数据库变更为加法迁移；不得删除旧Message content或历史候选v1。
- Agents SDK A/B只证明隔离评估合同，仍为`productionEligible=false`；生产默认保持Responses Runtime。
- 唯一V1-9恢复仍受冻结Skill/Policy/Provider lock、同任务身份和匹配健康证据共同约束；旧manifest不得静默迁移。V1-9通过后才进入教师签收与V1-10授权门。
- 本轮没有调用Main Agent、图片、视频、PPTX、ZIP或V1-9 Provider，没有运行Playwright或390px；因此没有新增`model orchestration`、`product E2E`或`release`证据。
