# P0-05A真实Provider连续性与V1-9就绪测试计划

日期：2026-07-17
状态：active / offline-readiness / no-live-run-authorized

## 1. 证据层目标

| 层 | 本阶段目标 | 不允许上推 |
|---|---|---|
| contract | live harness、evidence、receipt和fresh-run合同通过 | 真实Provider稳定 |
| executor | 隔离进程、持久事实、原子写和恢复通过 | Main Agent连续稳定 |
| model orchestration | 最终候选连续3组四场景通过 | 完整V1-9或任意媒体稳定 |
| product E2E | 保持partial，仅证明桌面文本与两个文本Tool局部链路 | 教案/PPTX/图片/视频/ZIP全链路 |
| release | not started | 教师签收、部署或发布 |

## 2. 离线合同测试

首批离线readiness提交`b013a96`和signer/v2提交`9a936ad`均已完成远端clean `quality-gates`，对应SHA-bound verification全部成功；证据均不包含真实Provider。VR-A13A提交`b2772a7`的本地证据为ingress/health Vitest `14/14`、路由/preflight/security Node `34/34`、stage/orchestration Node `16/16`、Provider合同`29 pass / 1 Windows symlink skip`、TypeScript和development gate通过。VR-A13B1当前本地候选的Tool authority与服务端summary隔离SQLite交叉回归为`105/105`，TypeScript和development gate通过；新增负例覆盖Observation/Invocation/Event状态漂移，正例覆盖Observation-only成功。B1仍须独立提交和clean CI，B2还必须生成自己的observer/closeout证据，均不能沿用A阶段结果。

全量本地测试只使用`run-tests.mjs`内生的单worker约束，不从外层覆盖`VITEST_MAX_WORKERS`。每次运行使用同一`test-workbench`族下带run token和角色后缀的独立Node/Vitest SQLite文件，初始化前和退出后清理`.db`、`-wal`、`-shm`；整个测试进程树通过唯一空dotenv文件阻止仓库`.env`回灌Provider凭据，成功或失败退出均清理该文件和数据库族。

测试运行器恢复事实：原单分片长寿worker连续两次在末段异常退出，其中一次表面落在`external-audit-evidence-ingress`初始化，但该文件隔离复跑`16/16`通过；后续Node全量在完整流程中一次失败而同命令隔离复跑`384/384`。不得把这类基础设施异常记作业务断言失败，也不得通过减少测试集合处理；当前Node固定单并发，Vitest分片策略保留完整测试集合并在分片间重启worker。

| ID | 场景 | 预期 |
|---|---|---|
| PC-A01 | 未显式指定ledger root/channel | 失败且不发请求 |
| PC-A02 | 没有费用授权或调用预算 | 失败且Provider调用为0 |
| PC-A03 | SQLite、Artifact或evidence路径逃逸/符号链接 | 失败 |
| PC-A04 | 目标evidence、manifest或receipt已存在 | 拒绝覆盖 |
| PC-A05 | manifest自引用或receipt未绑定manifest SHA | 失败 |
| PC-A06 | evidence缺字段、重复路径、额外文件或SHA不符 | 失败 |
| PC-A07 | receipt新但run/evidence过期 | 失败 |
| PC-A08 | candidate HEAD/tree/policy/stage/provider指纹变化 | 失败并清零连续计数 |
| PC-A09 | 原始5xx后SDK重试成功 | 该组失败 |
| PC-A10 | timeout、mock、fallback、degraded或placeholder | 该组失败 |
| PC-A11 | 失败、Ctrl+C或超时停止 | 先持久化失败事实，无本轮worker残留 |
| PC-A12 | 结构化JSON/YAML合同 | 使用解析器验证，不新增源码字符串断言债务 |
| PC-A13 | UI/runner自报状态与Provider边界事实不一致 | 失败，权威轨迹优先 |
| PC-A14 | 三组之间production server重启 | 整个campaign失败并从0重跑 |
| PC-A15 | 场景D使用新的teacherMessageId或turnJobId | 失败，不能冒充post-tool续轮 |
| PC-A16 | 新harness/verifier路径未进入Provider敏感bundle | 失败，所有连续性实现必须触发影响门并绑定subject |
| PC-A17 | subject缺verification manifest、policy/stage SHA、channel/model、费用授权或server实例 | 失败 |
| PC-A18 | run序号不从1开始、跨server拼接、存在失败attempt或run数不等于政策值 | 失败，不得挑选成功组重封装 |
| PC-A19 | status、timeout、mode、outcome和errorCategory不能逐调用对齐 | 失败，改用单条`providerCalls[]`事实 |
| PC-A20 | capture root穿过junction/reparse/symlink或配置无效 | preflight在启动前失败，Provider调用为0 |
| PC-A21 | 手工构造且内部SHA自洽的v1 receipt | P0-05A以`PROVIDER_RECEIPT_SCHEMA_UNSUPPORTED`拒绝 |
| PC-A22 | v2 source index无签名、key ID未被活动阶段预绑定或公钥摘要不符 | 失败，不得晋升passed receipt |
| PC-A23 | 签名source index遗漏capture目录中的失败attempt或额外文件 | 失败，必须逐文件精确枚举 |
| PC-A24 | intake临时taskId与TaskBrief taskId变化，或C/D共用turn身份 | ordinal按同一turn连续；仅intake允许精确临时taskId，D不得重复归1或重复引用call |
| PC-A25 | 相同工作树只改变untracked/staged/unstaged形态 | manifest摘要不变；实际文件字节、路径或删除状态变化时摘要必须变化 |
| PC-A26 | verification manifest目标为绝对路径、反斜杠、`.tmp/verification`外路径、reparse/symlink或非普通文件，或写入后改变subject | 在删除任何既有目标前失败；写后漂移时删除manifest并失败，不留下成功证据 |
| PC-A27 | trace recorder存在但Provider调用事实落盘失败 | 当前调用和campaign失败，不得返回可晋升成功结果 |
| PC-A28 | ledger-authority或capture signer使用非Ed25519、错误用途域、未知key、调用方自报attestation/自制index或未精确枚举capture/facts | 在capture签名和写入前失败；两个私钥均不进入仓库输出 |
| PC-A29 | 任一调用channel/model、预算、ledger、server或verification subject与阶段授权不同 | evidence和receipt均失败，不得混入其他有效trace |
| PC-A30 | v2 run数多/少、从2开始、重复、跳号、跨server或receipt字节在验签后变化 | 失败；成功结果原子返回实际`receiptSha256`和subject |
| PC-A31 | writer目标绝对化、逃逸、junction/symlink、非普通文件、已存在或并发发布 | 删除/覆盖前失败，只允许一个发布成功 |
| PC-A32 | capture attempt计数、eventId、timing、retry、usage/cost与独立签名ledger attestation不一致或超授权 | 失败，不能用缺失trace或runner自报补齐 |

## 3. 四场景真实合同

每组运行创建一个新隔离project/task；组内按顺序执行：

| 顺序 | 场景ID | 教师行为 | Tool合同 | Artifact合同 | IntentEpoch |
|---:|---|---|---|---|---|
| 1 | `ambiguous-discussion` | 讨论是否改为视频但尚未决定 | 0次业务Tool | 0 | 不变 |
| 2 | `single-requirement-spec` | 明确只做需求规格 | 仅1次`create_requirement_spec` | 1 | 按policy只推进一次 |
| 3 | `requirement-spec-and-ppt-outline` | 明确需求规格和PPT结构候选 | 只允许`create_requirement_spec`与`create_ppt_outline`，不得出现范围外Tool | 2 | 同task内满足policy |
| 4 | `main-agent-continuation` | 不发送新教师消息，观察场景C同一`teacherMessageId`/`turnJobId`的post-tool续轮 | 不重复业务Tool | 0个新增Artifact | 不变且终态可恢复 |

每场景还必须有真实HTTP状态、非空观测证据、持久消息/事件顺序和可追溯task/turn标识。测试只读取教师可见文本和持久事实，不读取思维链。

## 4. 连续性规则

- development门需要连续3组完整序列；不是累计3个成功组。
- 第1、2组成功后第3组失败，结果为0组连续通过，不能保留前两组进入下一候选。
- 代码、prompt、policy、schema、Provider channel/model或费用授权版本变化，旧组全部失效。
- 同一组内任何实际5xx或timeout均失败，即使SDK随后成功。
- 三组必须由同一production server进程顺序完成；服务重启、并行执行或跨campaign拼接均失败。
- 不允许人工删除失败evidence、复制成功run或修改时间戳组成receipt。

## 5. V1-9就绪测试

| ID | 关注点 | Go条件 |
|---|---|---|
| VR-A01 | fresh run创建 | 不要求旧runId或硬编码历史manifest SHA；active pointer必须不存在且最终发布为create-if-absent |
| VR-A02 | 历史证据 | 只读、字节不变，不复制为新run事实 |
| VR-A03 | Main Agent控制权 | runner/observer不选Tool、不强制下一步、不外部编排 |
| VR-A04 | TaskBrief/Intent | 当前digest、epoch、revision和ExecutionEnvelope全绑定 |
| VR-A05 | Provider lock | 显式ledger来源且禁止silent fallback |
| VR-A06 | observer | 只通过desktop产品入口提交一次冻结目标并观察持久事实 |
| VR-A07 | 中断恢复 | 保存submission/checkpoint，恢复不重复调用或扣费 |
| VR-A08 | package边界 | 最终包只认正式当前package asset，不现场拼装 |
| VR-A09 | 合同升级 | 终止旧run并建立显式后继，禁止同run静默升级 |
| VR-A10 | M67兼容入口 | 只保留受控启停/隔离能力，不恢复旧阶段控制口径 |
| VR-A11 | 连续性证据绑定 | baseline lock交叉绑定clean verification、policy/stage、Provider manifest/receipt同字节SHA、签名evidence root摘要和有效subject；facts/trace由source-index SHA传递绑定 |
| VR-A12 | 唯一冻结目标 | prompt只有一个权威合同源，不在prepare/runner重复定义 |
| VR-A13 | 产品编排audit | 外部写attempt和Tool authority由服务端持久事实派生；缺失、断序或非Main Agent authority失败 |
| VR-A14 | 产品恢复权 | startup动作只由精确SQLite状态和typed evidence决定，runner/env不能选择恢复 |
| VR-A15 | prepare事务安全 | 正常提交和恢复均重验baseline；successor history/pointer对遵守共享prepare锁的仓内writer执行协作式CAS；所有I/O拒绝junction/reparse路径逃逸 |
| VR-A16 | 恢复身份 | checkpoint、TurnJob、task、epoch、message任一跨任务或缺失绑定均失败，不取项目全局latest |

VR-A13细分为以下行为门，全部通过前保持blocked：

| ID | 场景 | Go条件 |
|---|---|---|
| VR-A13-01 | 认证写入attempt | handler前已追加attempt；审计写失败时业务零写入 |
| VR-A13-02 | attempt终态 | committed、rejected、failed分别追加唯一终态；open attempt、中断、重复终态均失败 |
| VR-A13-03 | 完整性与身份 | 序号、digest、actor、project、task、epoch、message、TurnJob、plan任一缺失、断序、篡改或跨域均失败 |
| VR-A13-04 | Tool selector authority | Main Agent claim与Invocation、实际action digest、连续ordinal和started事实同事务；非Main Agent selector失败 |
| VR-A13-05 | Tool终态 | terminal与Invocation、Observation、Artifact/Event和plan revision交叉绑定；状态矩阵冲突、缺失、提前或错绑失败；Observation-only成功不伪造Artifact要求 |
| VR-A13-06 | 入口覆盖 | 所有认证项目写route经统一边界；第二次message、approve、generate、regenerate、成员写或未知入口形成violation |
| VR-A13-07 | 产品摘要 | 服务端按完整窗口生成脱敏摘要与digest；observer只验证和投影，不得自报零值或裁剪窗口 |
| VR-A13-08 | 重入与closeout | ready重入仍复验新鲜摘要；缺摘要、watermark回退、同水位digest变化或任一violation拒绝完成 |
| VR-A13-09 | SQLite readiness | 专用表、唯一约束、索引和append-only trigger缺一即health失败，不使用旧库fallback |

VR-A13B1通过只表示产品服务端已持久记录并可按冻结身份生成编排summary；VR-A13-08仍由B2关闭。完整VR-A13 contract-go也不表示恢复权、真实Provider连续性、V1-9、媒体链路或release通过。

任何一项`blocked`都使P0-05A No-Go；不以“将在P0-05B修复”绕过入口门。

## 6. 实际验证命令

实现期：

```powershell
node --test tests/development-gates/provider-continuity*.test.mjs
npm run gate:development
npm run typecheck
npm run lint -- --max-warnings 150
npm test
npm run build
npm run verify:local
npm run gate:manifest:verify
```

当前授权前失败关闭检查：

```powershell
npm run gate:provider:live -- --mode development --preflight-only
npm run gate:provider:verify -- --mode development
```

当前没有获授权的真实Provider调用命令。只有活动阶段写入完整且未过期的授权合同、trusted capture key、公钥摘要和ledger摘要，并接入受保护环境及ledger权威验证器后，才允许文档化真实命令。P0-05A不运行`gate:release`，不运行完整V1-9 runner，不运行390px，不调用媒体或整包Provider。

## 7. Go/No-Go

### Go

- clean候选和完整离线验证manifest有效；
- 真实receipt绑定最终候选并通过现存verifier；
- 连续3组四场景全部通过；
- V1-9就绪矩阵无`blocked`；
- 费用、凭据、日志和证据均符合安全边界；
- 当前主线只提升model orchestration口径。

### No-Go

- 任一5xx、timeout、重试掩盖、范围扩张、重复Tool或证据缺失；
- 只能通过旧run、旧predecessor、fixture、手工JSON或fallback完成；
- candidate或Provider binding与receipt不一致；
- V1-9入口仍含第二编排者、固定Tool顺序或无法创建fresh run；
- 无法证明隔离、费用上限或失败恢复。

No-Go时保存失败证据和最小恢复入口，回到对应实现任务；不得自动进入P0-05B。
