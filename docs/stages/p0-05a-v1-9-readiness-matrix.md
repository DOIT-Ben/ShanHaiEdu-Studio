# P0-05A V1-9入口就绪矩阵

日期：2026-07-17
结论：NO-GO / ADAPTATION REQUIRED

本矩阵只做当前合同适配审计，不创建V1-9 runId，不运行旧runner，不调用任何Provider。`reuse`表示责任边界可保留；`adapt`表示必须先通过行为测试修复；`retire`表示退出P0-05A入口但可在P0-05B另行复用；`blocked`表示未修复前P0-05A不能Go。

| 入口或责任 | 裁决 | 当前事实 | 进入P0-05B前的最小动作 |
|---|---|---|---|
| `scripts/prepare-v1-9-run.ts` | blocked / adapt | 仍绑定历史manifest SHA、`V1_9_PREDECESSOR_RUN_ID`、旧pointer和predecessor；完整目标prompt与runner重复定义 | fresh run去除历史predecessor硬前置；prompt收敛到单一合同源；冻结当前verification、policy、stage和Provider continuity subject |
| `scripts/lib/v1-9-e2e-contract.mjs` | blocked / adapt | predecessor仍是manifest必填字段，旧运行身份进入新run合同 | 把predecessor改为仅恢复路径的显式可选事实；fresh run不得依赖旧run |
| `scripts/lib/v1-9-baseline-lock.mjs` | blocked / adapt | 当前lock包含branch、HEAD、runtime、requirements、Registry、Provider ledger和projection，但缺clean verification manifest、policy SHA、stage SHA、Provider continuity receipt，且未强制工作树clean | 扩展baseline lock并用行为测试证明任一候选漂移失败 |
| `scripts/run-v1-9-e2e.mjs` | adapt | 隔离生命周期可复用；但目标prompt重复，整段委托M67兼容入口，并由env决定启动时恢复重试 | 只保留监督和启停壳；恢复决策改为读取产品持久状态，不由runner取得第二编排权 |
| `scripts/run-m67-e2e.mjs` | reuse lifecycle / retire control entry | 隔离server、SQLite、Artifact、Playwright、IPC停机和失败后核验可复用；M67命名与兼容入口不应继续成为V1-9控制面 | 抽取受控生命周期能力，由唯一V1-9入口调用；不得决定Tool、下一步、重试或恢复 |
| `scripts/v1-9-product-preflight.ts` | retire from P0-05A / reuse in P0-05B | 固定检查PPT、图片、视频、TTS、文本Provider及全部媒体二进制，与P0-05A只验证文本/Main Agent的capability-scoped preflight冲突 | P0-05A不调用；完整媒体preflight保留给P0-05B并重新冻结 |
| `tests/e2e/v1-9-unique-real-product.spec.ts` | reuse observer / adapt authority | 只提交一次完整目标，后续以轮询观察，不固定Tool顺序；但external Codex计数仍依赖浏览器请求监听和本地ledger，未绑定产品侧权威持久事件 | 保留观察方式；把无第二编排者证明改为产品持久事件/状态合同 |
| TaskBrief、IntentEpoch、IntentGrant、plan、package asset | reuse / adapt | 现有observer合同已绑定任务、epoch、授权、预算和plan；package选择器骨架可复用，但合同自证、ExecutionEnvelope与当前continuity subject未完整进入冻结链 | 补ExecutionEnvelope、verification、policy/stage、receipt及正式package asset反向血缘绑定，不恢复旧宏阶段 |
| Provider lock | blocked / adapt | 旧合同允许`channel=fallback`，只比较config digest和credential source，未绑定model fingerprint与continuity receipt；视频preflight还可能因残留Evolink key覆盖显式选择 | 只接受显式ledger channel，禁止silent fallback；绑定model、receipt和费用授权，并增加残留key不得覆盖显式mode的负例 |
| checkpoint与失败恢复 | blocked / adapt | observer按项目全局读取latest checkpoint/failed turn，未证明属于冻结task、message、job和epoch | 恢复查询与冻结身份精确绑定；不匹配即失败，不跨任务拼接 |
| package验真 | blocked / adapt | 合同主要信任调用者传入的id/version/SHA/turn绑定；observer对ZIP仍存在扩展名和非零字节层验证 | 回到正式package asset、当前project/task/epoch、文件结构与内容manifest验真 |
| 直接合同测试 | adapt | 多项测试通过读取实现源码和正则匹配证明接线，属于已登记源码字符串债务 | 新适配必须写行为测试；既存债务只能收缩，不新增命中 |

## 明确可复用

- 隔离SQLite、Artifact root、server端口、Playwright单worker、IPC监督、超时终止和停机后核验。
- observer一次提交目标后只观察产品Main Agent，不固定`create_requirement_spec`、`create_ppt_outline`或其他Tool顺序。
- TaskBrief、IntentEpoch、IntentGrant、预算和plan revision的既有持久合同；正式package asset选择骨架可复用，但文件与当前任务血缘仍须补强。

## 明确废弃

- fresh run强制历史predecessor、历史manifest SHA或旧pointer。
- runner用环境变量决定产品是否恢复重试。
- M67作为第二个V1-9控制入口。
- P0-05A执行完整媒体preflight。
- 浏览器“没有观察到请求”替代产品侧无第二编排者权威事实。
- `fallback` channel或残留Provider key覆盖显式ledger选择。
- 按项目全局latest恢复checkpoint/failed turn，或只按扩展名与非零字节验收ZIP。

## 当前阻塞

P0-05A仍是NO-GO。下一代码子阶段必须先完成fresh-run合同、baseline lock扩展、恢复权归位和observer权威来源四项适配；每项先写行为红测试，并且不得运行真实V1-9或媒体Provider。v2签名Provider receipt与可信capture key仍是独立阻塞，不能由本矩阵替代。
