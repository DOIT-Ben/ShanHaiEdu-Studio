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

当前首批定向结果：相关Node合同`40/41`，唯一跳过项为当前Windows不允许创建测试符号链接；Provider边界相关Vitest `125/125`；TypeScript通过。修复前候选的全量Vitest采用两个顺序分片、单worker、禁止文件并行和独立SQLite，第1分片`770/770`、第2分片`794/794`；其`verify:local`五项检查全部返回0。提交前独立审查触发新的P1修复后，新增签名来源、capture全枚举、授权匹配、turn-global ordinal、D续轮和Tool phase/channel定向合同已通过；最终全量结果以提交前当前manifest和clean提交的远端CI manifest为准。

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
| VR-A01 | fresh run创建 | 不要求旧runId或硬编码历史manifest SHA |
| VR-A02 | 历史证据 | 只读、字节不变，不复制为新run事实 |
| VR-A03 | Main Agent控制权 | runner/observer不选Tool、不强制下一步、不外部编排 |
| VR-A04 | TaskBrief/Intent | 当前digest、epoch、revision和ExecutionEnvelope全绑定 |
| VR-A05 | Provider lock | 显式ledger来源且禁止silent fallback |
| VR-A06 | observer | 只通过desktop产品入口提交一次冻结目标并观察持久事实 |
| VR-A07 | 中断恢复 | 保存submission/checkpoint，恢复不重复调用或扣费 |
| VR-A08 | package边界 | 最终包只认正式当前package asset，不现场拼装 |
| VR-A09 | 合同升级 | 终止旧run并建立显式后继，禁止同run静默升级 |
| VR-A10 | M67兼容入口 | 只保留受控启停/隔离能力，不恢复旧阶段控制口径 |
| VR-A11 | 连续性证据绑定 | baseline lock绑定clean manifest、policy/stage SHA和有效receipt |
| VR-A12 | 唯一冻结目标 | prompt只有一个权威合同源，不在prepare/runner重复定义 |

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

当前没有真实执行命令。只有活动阶段写入完整且未过期的授权合同、trusted capture key、公钥摘要和ledger摘要，并接入受保护环境及ledger权威验证器后，才允许文档化真实命令。P0-05A不运行`gate:release`，不运行完整V1-9 runner，不运行390px，不调用媒体或整包Provider。

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
