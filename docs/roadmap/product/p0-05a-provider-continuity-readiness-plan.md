# P0-05A真实Provider连续性与V1-9就绪实施计划

日期：2026-07-17
状态：proposed / depends-on-clean-gate-baseline

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

## 2. 阶段0：关闭当前门禁阶段

目标：形成可作为P0-05A基线的clean候选。

任务：

- 审查并提交当前门禁阶段，工作树必须clean。
- 在required CI运行`verify:ci`，下载并核验`dirty=false` manifest。
- 把当前阶段plan/test-plan按项目归档规则迁移并记录SHA-256；历史原文不改。
- 用clean HEAD建立新的P0-05A `active-stage.json`，只允许本计划明确文件。
- 已确认现有Provider adapter evidence不足；当前门禁阶段已建立精确capture bootstrap和脱敏逐调用事实源，包含HTTP状态、timeout、request-id摘要、channel/model、usage及project/task/turn绑定，且仍保持`passed=false`。剩余动作是完成全量验证、clean提交和CI manifest。

验收：HEAD、tree、policy SHA、stage SHA和CI manifest一致；任何不一致均不进入阶段1。

## 3. 阶段1：证据合同和红测试

目标：先证明现有系统不能生成合格真实receipt，再实现。

任务：

- 为live harness参数、显式ledger binding、费用预算和隔离路径写合同测试。
- 为真实事件到scenario evidence的确定性映射写测试。
- 为Provider边界事实优先于UI/runner自报字段、场景C/D共享`teacherMessageId`和`turnJobId`写失败测试。
- 为manifest/receipt原子写、目录额外文件、路径逃逸、候选漂移和重封装旧run写失败测试。
- 给`package.json`新增唯一`gate:provider:live`命令合同测试。

验收：新增特征测试因入口缺失或证据不完整而红；现有provider verifier测试保持绿。

## 4. 阶段2：live harness与隔离生命周期

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

目标：只从实际持久事实确定性生成verifier可接受的两文件证据。

任务：

- 每组运行写一个不可覆盖evidence文档，包含四场景和候选subject。
- evidence只接受运行时Provider轨迹中的status/timeout/mode；Playwright或runner提供的不一致值必须失败。
- manifest只描述subject、期望场景与evidence路径，不引用自身。
- receipt绑定manifest SHA、subject bundle、每个evidence SHA和连续run列表。
- 写入使用临时文件加原子rename；目标存在时拒绝覆盖。
- 生成后立即调用现有verifier，验证失败则整组失败。

验收：篡改任一字段、文件、时间、SHA或目录内容均失败；日志和JSON不含凭据。

## 6. 阶段4：V1-9入口就绪审计与最小适配

目标：让P0-05B拥有当前合同入口，而不是恢复整改前运行。

审计范围仅限：

- `scripts/run-v1-9-e2e.mjs`
- `scripts/prepare-v1-9-run.ts`
- `scripts/v1-9-product-preflight.ts`
- `scripts/lib/v1-9-e2e-contract.mjs`
- `tests/e2e/v1-9-unique-real-product.spec.ts`
- 它们的直接测试和类型声明

必须回答：

- fresh run是否仍被硬编码历史predecessor或历史manifest SHA阻塞；
- runner是否仍通过M67兼容入口、阶段进度或环境变量取得第二编排权；
- observer是否只观察产品Main Agent，且不固定Tool顺序；
- `externalCodexOrchestrationCount === 0`是否绑定产品侧权威事件，而不只是浏览器“未观察到”；
- TaskBrief、IntentEpoch、ExecutionEnvelope、Provider binding和package asset是否使用当前合同；
- baseline lock是否纳入clean verification manifest、policy SHA、stage SHA和Provider continuity receipt；
- 重复冻结prompt是否已收敛为单一合同；完整媒体preflight是否与本阶段capability-scoped preflight分责；
- 中断、恢复和合同升级是否终止旧run并创建显式后继。

只做进入P0-05B所必需的最小适配。任何适配先写行为测试；无法在5个文件内完成的任务继续拆分，不做顺手重构。

验收：形成`reuse / adapt / retire / blocked`矩阵；所有`adapt`已有绿测试，所有`blocked`都会使P0-05A No-Go。

## 7. 阶段5：完整离线验证与冻结

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

通过后记录candidate HEAD、tree、working tree clean状态、policy SHA、stage SHA、provider channel、model fingerprint、合同版本和费用授权版本。此后任何字节变化都终止本轮连续性计数。

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
| A7 V1-9 observer/runner适配 | 5 | 无第二编排者、无固定Tool顺序 |
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

回退只撤销P0-05A新增代码和接线；不恢复旧runner控制权，不覆盖历史证据，不删除真实失败记录。
