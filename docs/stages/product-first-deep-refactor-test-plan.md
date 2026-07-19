# 产品优先深度重构测试计划

更新时间：2026-07-20

## 1. 验收层级

本阶段只可关闭`contract`与`executor`重构门。未调用真实Provider时，`model orchestration`和`product E2E`最多保持既有partial，`release`保持not started。

## 2. 必须先失败的行为合同

| ID | 场景 | 预期 |
|---|---|---|
| DR-A01 | 项目写handler在wrapper前提前返回 | orchestration gate失败 |
| DR-A02 | 非`route.ts`的Next写入口绕过registry | orchestration gate失败 |
| DR-A03 | 成员新增、改角色、删除绕过统一actor/CSRF | 请求失败且业务handler不执行 |
| DR-A04 | attempted审计写入失败 | 业务handler调用次数为0 |
| DR-A05 | terminal审计写入失败 | 不返回业务成功并保留open attempt |
| DR-A06 | Observation、Event、Invocation终态错绑 | 提交事务拒绝 |
| DR-A07 | 重复terminal或terminal先于start | 提交事务拒绝 |
| DR-A08 | Observation-only成功没有Artifact | 合法成功，不被摘要误判 |
| DR-A09 | 声称产生Artifact但缺少正式绑定 | 提交或摘要失败 |
| DR-A10 | authority summary身份、ordinal、水位或digest篡改 | readyEligible=false |
| DR-B01 | 生产路径尝试读取或执行`toolPlan`/`deliveryPlan` | 编译或行为合同失败 |
| DR-B02 | deterministic结果尝试晋升为正式Artifact | 晋升失败 |
| DR-B03 | native turn之外的组件选择下一业务Tool | 行为合同失败 |
| DR-C01 | PendingDecision消息已更新，但事件或语义快照写入失败 | 不得对外形成部分确认；同一action可幂等恢复 |
| DR-C02 | 同一PendingDecision actionId以不同payload重放 | 冲突失败关闭，不覆盖首次提交事实 |
| DR-C03 | turn service拆分后执行讨论、单Tool、确认、取消、改道和恢复 | `createConversationTurnService`入口与外部行为不变 |
| DR-C04 | tool loop拆分后执行Tool资格、Envelope、结果提交和恢复 | `createMainAgentToolLoopOptions`入口与终态矩阵不变 |
| DR-C05 | Stage C目标文件或新职责模块超过500行，或函数超过150行 | complexity gate失败 |
| DR-D01 | 新增或扩大复杂度债务 | complexity gate失败 |
| DR-D02 | 债务减少但baseline尚未同步 | 报告可识别stale baseline，允许显式收缩 |
| DR-D03 | 新增源码字符串合同 | source-contract gate失败 |
| DR-D04 | 新增Lint warning | Lint失败 |
| DR-D05 | 动态路径可逃逸受限根 | 构建/路径合同失败 |
| DR-D06 | ConversationTurn同一幂等键携带不同消息、身份、metadata或控制动作 | 失败关闭，不复用旧Job |
| DR-D07 | 两个独立PrismaClient同时claim同一TurnJob | 只有一个running执行者，另一方返回null且不timeout |
| DR-D08 | 陈旧worker把queued、failed或succeeded GenerationJob标成submission_unknown | 状态不变并失败关闭 |
| DR-D09 | VideoShot完整计划移除旧shot或选择同项目错误shot/source片段 | 旧shot删除；错误血缘拒绝，正确血缘可选 |

## 3. 每切片验证

```powershell
node --test --test-concurrency=1 <相关Node测试>
npm test
npm run typecheck
npm run lint -- --max-warnings 0
npm run gate:development
git diff --check
git diff --cached --check
```

`npm test`是依赖数据库测试的权威入口，会为Node测试和Vitest分片初始化独立临时SQLite；不得裸跑依赖数据库的Vitest并复用真实库。每个切片都必须保持ESLint `0 error / 0 warning`；只有阶段D完成后才允许声称复杂度和源码字符串合同债务已清零。

## 4. 删除性验收

```powershell
rg -n "WorkflowNode|toolPlan|deliveryPlan|DeterministicRuntime" src
node scripts/development-gates/complexity.mjs --report-json
node scripts/development-gates/source-contracts.mjs
```

最终预期：第一条无生产命中，复杂度报告为`[]`，源码字符串合同报告无债务。

## 5. 阶段B新鲜证据

2026-07-20阶段B候选工作树已实际取得：

- 生产旧控制面符号扫描为0，活动写操作registry为16条。
- Node测试`427/427`，Vitest两个隔离分片`793/793`与`775/775`。
- TypeScript、ESLint `0 warning`、生产构建、standalone敏感文件检查通过。
- development gate通过，Provider结果为`deferred_provider_validation_during_offline_refactor`且`passed=false`。
- `verify:local`生成绑定当前HEAD与工作树的manifest，`gate:manifest:verify`及`desktop:smoke`通过。
- 复杂度债务为29个文件、源码字符串合同债务为21个文件，未上推为阶段D完成。

## 6. 阶段C切片验证

- C0：Provider continuity gate测试、wiring测试、development gate和`git diff --check`；Provider结果必须保持`passed=false`且请求数为0。
- C1：PendingDecision失败注入、幂等重放、冲突payload、错误actionId、确认/取消/改道和刷新恢复测试。
- C2：conversation turn service、streaming progress、structured intake、TaskBrief和控制回合回归。
- C3：main agent tool loop、Tool registry、ExecutionEnvelope、terminal replay、Observation/Artifact提交和GenerationJob恢复回归。
- 每个切片再运行TypeScript、零warning ESLint、complexity gate、source-contract gate和development gate。

C1新鲜证据：

- 失败注入红测先观察到Snapshot失败后消息错误变为`confirmed`，修复后同一故障会回滚Aggregate、授权元数据、消息和事件，旧快照保持`pending`。
- 同一`actionId`同payload重放只保留一个事件；改为不同终态时失败关闭且不覆盖首次事实。
- Node测试`427/427`；Vitest隔离分片`793/793`与`777/777`。
- TypeScript、ESLint `0 warning`、生产构建、standalone敏感文件检查和development gate通过。
- Provider保持离线延期、`passed=false`且请求数为0；复杂度债务仍为29个文件、源码字符串合同债务仍为21个文件。

C2新鲜证据：

- `createConversationTurnService`、`MessageTurnResponse`和`capabilityTeacherLabel`继续从原模块导入；没有新增竞争入口。
- Node测试`427/427`；Vitest隔离分片`793/793`与`777/777`，覆盖讨论、单Tool、流式进度、TaskBrief、确认、取消、改道、失败与双用户隔离。
- TypeScript、ESLint `0 warning`、生产构建、standalone敏感文件检查和development gate通过。
- `conversation-turn-service.ts`为115行，新职责模块均低于500行且无函数超过150行；复杂度债务由29降至28，源码字符串合同债务仍为21。
- Provider保持离线延期、`passed=false`且请求数为0。

C3新鲜证据：

- `createMainAgentToolLoopOptions`和`CreateMainAgentToolLoopOptionsInput`继续从原模块导出；生产消费者仍只有`conversation-turn-agent-context.ts`，没有新增竞争dispatch入口。
- `npm test`通过：Node测试`427/427`，Vitest隔离分片`793/793`与`778/778`；覆盖Tool资格、ExecutionEnvelope、HumanGate、Skill合同、terminal replay、Observation/Artifact提交、GenerationJob恢复及PPT/视频编排。
- TypeScript、ESLint `0 warning`和生产构建通过，standalone检查`forbidden=[]`；`main-agent-tool-loop-config.ts`为97行，15个职责模块均低于500行且无函数超过150行。
- V1-9 contract repair evidence的默认SHA闭包包含全部15个拆分模块，定向合同`2/2`通过。
- development gate通过；复杂度债务由28降至27，源码字符串合同债务仍为21。Provider保持离线延期、`passed=false`和0请求，未把离线回归上推为连续性通过。

D1新鲜证据：

- 红测先复现两种幂等入口静默吞掉异payload、双PrismaClient claim timeout、queued GenerationJob被降级、VideoShot旧计划残留和错误片段绑定。
- `createPrismaWorkbenchRepository`为29行；全部内部模块低于500行且函数低于150行，复杂度债务由27降至26。
- 无生产消费者的staged result promotion及其自动stage写入已删除；迟到结果隔离继续由当前control-plane行为测试覆盖。
- `npm test`通过：Node`427/427`，Vitest隔离分片`801/801`与`773/773`；匹配ValidationReport与Artifact原子保存、摘要不匹配时零新增事实的迁移测试已恢复；TypeScript和ESLint `0 warning`通过。
- 当前source gate仍报告21文件/301次，但该数字已确认有漏报和误报，只能作为旧检测器输出，不能作为最终债务总数。

D2新鲜证据：

- 红测先证明repository/service仍暴露直接`regenerateArtifact`、前端仍导出mock选择器且按钮缺少标准消息转换。
- 重做提交使用真实Artifact ID和标准`POST /messages`；路由行为验证提交后只有教师消息与queued ConversationTurn，Artifact版本保持1、IntentEpoch保持0；产物动作策略不清空composer草稿，也不绑定待确认HumanGate。
- 专用regenerate写入口、development adapter、mock selector和四份seed已删除；旧阶段测试中的版本递增、项目隔离和唯一批准指针合同已迁入当前主线行为测试，错误直接regenerate断言已删除；写操作registry由16降至15。
- `npm test`通过：Node`424/424`，Vitest隔离分片`782/782`与`786/786`；TypeScript和development gate通过，复杂度债务由26降至25。
- 按用户要求未运行PPT浏览器验收；Provider请求数为0。

D3新鲜证据：

- 数据库行为红测先以`2`项失败证明新库仍创建`StagedArtifactCommit`且旧表会被初始化脚本的旧索引假设阻断；修复后全新库无该表/字段，旧库遗留表和数据保留并被health忽略。
- Stage41 runner/spec/alias、runtime A/B、`orchestrator-runtime`、专属测试和`@openai/agents`依赖已删除；活动源码与依赖零引用。
- 定向数据库与control-plane回归`92/92`；`npm test`通过：Node`423/423`，Vitest隔离分片`778/778`与`773/773`。
- TypeScript、ESLint `0 warning`、生产构建、standalone `forbidden=[]`和development gate通过；复杂度债务保持25，源码合同门由21文件/301次收缩为20文件/293次。
- Provider保持离线延期、`passed=false`且请求数为0；未运行PPT浏览器验收、390px或任何真实媒体/整包流程。

## 7. 最终全量验证

```powershell
npm test
npm run typecheck
npm run lint -- --max-warnings 0
npm run build
npm run gate:development
npm run verify:local
npm run gate:manifest:verify
npm run desktop:smoke
```

随后从最终HEAD启动隔离本地实例，验证：health、登录、新建项目、普通讨论不触发Tool、单一需求规格只触发对应Tool、刷新后状态不漂移、失败只出现一次恢复入口。浏览器使用桌面视口。

## 8. 明确不执行

- 不运行`gate:provider:live`、Provider seal或release gate。
- 不调用图片、视频、PPTX、ZIP或整包Provider。
- 不创建V1-9 runId，不执行教师签收或部署。
- 不运行390px真实黑盒。

这些项目必须在最终报告列为“未验证/需另行授权”，不能写成通过。
