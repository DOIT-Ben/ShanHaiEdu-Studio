# P0-05A V1-9入口就绪矩阵

日期：2026-07-17
结论：NO-GO / ADAPTATION REQUIRED

本矩阵只做当前合同适配审计，不创建V1-9 runId，不运行旧runner，不调用任何Provider。`reuse`表示责任边界可保留；`adapt`表示必须先通过行为测试修复；`retire`表示退出P0-05A入口但可在P0-05B另行复用；`blocked`表示未修复前P0-05A不能Go。

| 入口或责任 | 裁决 | 当前事实 | 进入P0-05B前的最小动作 |
|---|---|---|---|
| `scripts/prepare-v1-9-run.ts` | adapted / contract-go | fresh与显式合同升级后继已分支；无predecessor环境可创建fresh，部分输入写前失败，旧history不进入新事实 | 仍不得实际创建V1-9 run；等待其余入口阻塞关闭后再冻结真实候选 |
| `scripts/lib/v1-9-e2e-contract.mjs` | adapted / contract-go | `predecessor`可显式为`null`；新manifest只接受baseline v2；旧baseline v1只读解析；prompt只有一个合同源 | 继续保持旧v1不能成为当前baseline |
| `scripts/lib/v1-9-baseline-lock.mjs` | adapted / contract-go | baseline v2绑定clean verification原始字节SHA、working tree、policy、stage、Provider manifest/receipt、签名evidence root摘要和subject digest；facts/trace由source-index SHA传递绑定，verification原始字节与receipt binding交叉校验 | 当前仓库没有真实passed receipt，因此真实baseline创建仍按设计失败关闭 |
| `scripts/run-v1-9-e2e.mjs` | partial / adapt | 冻结prompt重复已关闭；B2已让runner在M67完全停机后只读复算SQLite authority并与run-state投影比对；但启动时恢复重试仍由env决定 | 只保留监督和启停壳；恢复决策改为读取产品持久状态，不由runner取得第二编排权 |
| `scripts/run-m67-e2e.mjs` | reuse lifecycle / retire control entry | 隔离server、SQLite、Artifact、Playwright、IPC停机和失败后核验可复用；M67命名与兼容入口不应继续成为V1-9控制面 | 抽取受控生命周期能力，由唯一V1-9入口调用；不得决定Tool、下一步、重试或恢复 |
| `scripts/v1-9-product-preflight.ts` | retire from P0-05A / reuse in P0-05B | 固定检查PPT、图片、视频、TTS、文本Provider及全部媒体二进制，与P0-05A只验证文本/Main Agent的capability-scoped preflight冲突 | P0-05A不调用；完整媒体preflight保留给P0-05B并重新冻结 |
| `tests/e2e/v1-9-unique-real-product.spec.ts` | committed / CI pending | ready/completed重入已先登录、选择绑定项目并读取fresh snapshot；final download后再次读取并投影ready summary；浏览器ledger只保留操作轨迹 | 完成clean CI；不得据此运行真实V1-9 |
| 产品服务端持久编排audit | committed / CI pending | VR-A13A已由`b2772a7`建立专用append-only事实，B1已由`a1c170c`实现Tool authority与完整服务端summary；B2已由`db5af68`提交run-state v3投影、observer fresh snapshot、runner停机复算和closeout双重复算 | 完成B2 clean CI；未通过前不标记VR-A13关闭 |
| TaskBrief、IntentEpoch、IntentGrant、plan、package asset | reuse / adapt | 现有observer合同已绑定任务、epoch、授权、预算和plan；package选择器骨架可复用，但ExecutionEnvelope与正式package asset尚未反向绑定已冻结的baseline/receipt subject | 补ExecutionEnvelope及正式package asset反向血缘绑定，不恢复旧宏阶段 |
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

P0-05A仍是NO-GO。fresh-run与baseline lock合同出口已由`9160694`及clean CI关闭；VR-A13A已提交，VR-A13B1已由`a1c170c`本地提交。VR-A13B2已由`db5af68`提交并进入clean CI验收；通过后才处理恢复权归位与恢复身份精确绑定。不得运行真实V1-9或媒体Provider。v2签名Provider receipt与可信capture key仍是独立阻塞，不能由本矩阵替代。

第1个串行切片fresh/baseline已关闭VR-A01、VR-A02、VR-A11、VR-A12的合同出口；VR-A13A已关闭VR-A13-01、02、06、09及HTTP侧03出口；VR-A13B1由`a1c170c`关闭Tool侧03、04、05和服务端07，VR-A13B2由`db5af68`提交消费侧07与08并等待clean CI。恢复权归位、恢复身份和真实receipt继续等待。该切片只处理产品持久authority事实，不是PPT或真实V1-9运行。

## 二次审查增补

- 历史发现：fresh曾被transaction的journal、history和predecessor evidence强制绑定，closeout与接管还存在崩溃/竞争窗口。现已拆成fresh与显式合同升级后继两条分支，不伪造genesis predecessor；fresh不得覆盖任何active pointer；prepare/closeout使用共享锁、no-replace发布、双pointer前滚和统一run-state cooperative CAS，并在恢复/提交时复验evidence。
- 历史发现：baseline曾缺少候选证据绑定且legacy v1仍可进入活动执行。现已升级为v2，绑定clean verification、policy/stage、Provider manifest/receipt和签名evidence root摘要，facts/trace由source-index SHA传递绑定；receipt SHA只来自verifier实际验签的同一原始字节，旧v1仅保留只读解析，签名campaign不能用新wrapper重封装规避TTL。
- 浏览器ledger仅保留本页操作轨迹，不再证明authority或零违规；B2由产品服务端持久mutation audit、Tool authority和完整SQLite summary派生完成资格，并在observer、runner与closeout分别复验。
- runner当前通过`V1_9_RUN_MODE`和`SHANHAI_RECOVER_RETRYABLE_TURNS_ON_START`取得恢复决策权。恢复必须改为产品启动读取精确SQLite身份后决定drain、requeue或停止；mock改run-state不构成恢复证据。
- checkpoint与failed TurnJob不得从项目全局latest拼接，必须绑定冻结project/task/epoch/teacherMessageId/turnJobId，缺失或冲突即失败关闭。
