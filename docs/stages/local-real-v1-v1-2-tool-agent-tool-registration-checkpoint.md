# ShanHaiEdu V1-2 Tool与Agent Tool实现检查点

更新时间：2026-07-13

状态：`production candidate under review / 126 of 134 focused tests passing / not closed`

## 1. 结论

V1-2已经形成可审查的Registry、调用信封、Router、Schema、默认授权和课程锚点独立Critic候选实现，但尚不能标记`done`，也不能宣称课程锚点已经由产品内部独立Critic闭环审查。审批状态一致性、前置Tool正向白名单、否定语义正例和部分结构化合同已经转绿；当前仍有8个Router自动化红灯，集中在Executor结果权威字段封闭、签名审查目标集合绑定和可执行返修报告。关闭后仍须完成最终diff复核、全量验证和closeout，才能进入V1-3 Main Agent同轮受控ReAct。V1-2结束时三个Agent Tool仍保持生产不可执行，真实Critic Executor与运行时闭环属于V1-3/V1-7。

本检查点只记录真实代码和测试事实，不调用真实图片、视频或PPT Provider，不制作新交付包。

## 2. 基线

- 工程：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main`
- 分支：`main`
- 本次文档收口父提交为`d694d87a42d7d28fd96af6e99d1edb9cbd732b60`；当时上游`origin/main`为`c85c49f65d0fb6a438c06dba76e5e81ad271dbbc`，本地ahead 3、behind 0。下一会话必须重新执行`git status --short --branch`，不得把本段当作动态状态。
- `v1`与`v1.1.0-alpha`均为不可移动历史标签；当前V1-1/V1-2工作树成果不在这两个标签内。
- V1-1编排归因审计已完成，当前固定DeliveryPlan、规则Resolver与人工离线决策不能被归因为Main Agent同轮自主编排。

## 3. 已实现候选

| 能力 | 当前事实 | 能否视为生产闭环 |
|---|---|---|
| Agent Tool类型与Registry | 已注册`ppt_director.plan_or_repair`、`video_director.plan_or_repair`、`delivery_critic.review` | 否，Executor与Main Agent生产接线留给后续阶段 |
| Main Agent白名单 | 已区分高层业务Tool、Agent Tool与底层Provider能力 | 仅合同可见性候选 |
| 调用信封 | 已包含执行身份、projectId、IntentEpoch、sourceMessageId、输入hash、action digest、已批准输入和待审Artifact引用；默认数据库授权19/19通过 | 生产组合入口仍需在V1-3/V1-7复核租约、fence、重放和TOCTOU |
| Agent Tool Router | 已执行名称解析、输入输出Schema、权限、独立Critic策略、无产物副作用与无Executor时fail-closed | 仍须封闭Executor未知顶层字段、完整绑定签名目标集合并拒绝不可执行返修报告 |
| 课程锚点独立Critic候选 | `delivery_critic.review(domain="video", stage="course_anchor")`可返回六硬门、结构化返修和下游策略结果 | 注入Executor固定为`unverified_injected`且`productionEligible=false`，不能代替生产Critic |
| 测试 | 当前Agent Tool专项8个文件、134项中126项通过 | 8个Router合同红灯未关闭，不能形成closeout |

三个Agent Tool当前应继续保持：

```text
contractReady=true
executorReady=false
mainAgentExecutable=false
implemented=false
```

不得为了“看起来接通”把Fake Executor或deterministic结果接入生产Main Agent。

## 4. 新鲜验证

2026-07-13实现检查点曾执行：

```text
npx vitest run tests/agent-tools tests/tool-registry.test.ts tests/tool-router.test.ts
```

结果：7个测试文件、69项测试通过，失败0。

```text
npm test
```

结果：Node 259/259通过；Vitest 102个文件、692/692项通过，失败0。

```text
npm run build
```

结果：exit 0，Next.js生产构建、TypeScript检查和13个静态页面生成通过；保留3条既有动态文件模式过宽的Turbopack性能警告，不属于V1-2新增失败。

```text
git diff --check
```

结果：exit 0；仅有Git提示后续触碰时会按工作区规则转换LF/CRLF，没有空白错误。以上均为封板红测写入前的检查点证据，不代表当前工作树绿色。

当前工作树已有未提交的V1-2生产候选与测试改动，生产文件范围为：

```text
src\server\tools\agent-tool-invocation.ts
src\server\tools\agent-tool-registry.ts
src\server\tools\agent-tool-router.ts
src\server\tools\agent-tool-types.ts
src\server\tools\json-schema-value-validator.ts
src\server\tools\video-course-anchor-gate.ts
```

测试改动位于`tests\agent-tools\`，包括新增`agent-tool-router-default-authorization.test.ts`。这些改动属于用户工作树，下一会话不得回退、覆盖或通过放宽断言伪造绿色。

2026-07-13 03:02新鲜执行：

```text
npx vitest run tests/agent-tools --maxWorkers=1
```

2026-07-13 03:15重新执行扩大后的专项命令：

```text
npx vitest run tests/agent-tools tests/tool-registry.test.ts tests/tool-router.test.ts --maxWorkers=1
```

结果：exit 1；8个测试文件中1失败、7通过，121项中2失败、119通过。证据/理由充分性和blocking finding优先级红测在该历史检查点已转绿；当时两个红灯是默认数据库授权仍接受`needs_review + isApproved=true`与`approved + isApproved=false`的自相矛盾review target。

随后已修正默认授权测试夹具与既有`runtime-quality.test.ts`类型债务。2026-07-13 03:58重新执行扩大专项：8个文件中1失败、7通过，134项中8失败、126通过；8项全部位于`agent-tool-router.test.ts`。04:02默认数据库授权单文件19/19通过；课程锚点Gate 36/36通过；`npx tsc --noEmit --pretty false`为exit 0；按第6节引用的`.tmp`隔离命令连续两次`db:init`均exit 0；`git diff --check`为exit 0，仅有LF/CRLF提示。当前候选尚未重新执行全量测试和生产构建。

## 5. 封板缺口

| 优先级 | 缺口 | 直接风险 | 封板要求 |
|---|---|---|---|
| P0 | Executor可夹带`qualityDecision`、`teacherApproved`、`humanGateApproval`等未声明顶层字段 | Executor越权伪造Router、HumanGate或QualityDecision权威事实 | Router按状态白名单重建结果；未知顶层字段稳定拒绝，不能通过对象展开透传 |
| P0 | Critic输入、输出或finding locator只要求“至少一个”匹配签名review target | 签名目标A可被用来审查B，或混入其他Artifact | 所有locator必须属于签名目标集合；任一逃逸或混合目标稳定拒绝 |
| P1 | `rework_required/blocked`可缺finding或把责任指向下游媒体阶段 | Main Agent没有可执行上游返修依据 | 报告必须含finding、非空minimalFix和允许的上游责任阶段；否则`agent_tool_output_invalid` |
| 已覆盖/待复核 | 审批状态19/19、前置Tool正向白名单、否定语义正例、证据/理由和blocking finding | 局部绿色不等于最终diff已审完 | 保留现有通过测试，关闭当前8项后做最终diff审查和全量回归 |
| V1-3/V1-7 | 授权查询与Executor/持久化之间仍有TOCTOU、重放和最新版本唯一性风险 | 生产接线后可能消费过期审查 | 在项目写租约和fencing下二次复核IntentEpoch、sourceMessage、目标version/full digest、Rubric digest和调用幂等；测试注入`authorize`不得进入生产组合根 |

## 6. V1-2封板任务

1. 保留当前全部生产候选与测试，不修改真实Provider Adapter，不放宽断言绕过缺口。
2. 按状态白名单重建Executor结果，拒绝伪造的Router/HumanGate/QualityDecision顶层字段。
3. 所有Critic输入、输出和finding locator完全绑定签名review target；混入任一其他Artifact立即失败。
4. `rework_required/blocked`缺finding、空修复或指向下游媒体阶段时返回`agent_tool_output_invalid`。
5. 保留否定语义及不过度约束正例，确保儿童或教室有独立叙事理由时可以通过。
6. 保持注入Executor为`unverified_injected`、`productionEligible=false`；六门通过只允许进入后续Guard，不等于Provider、HumanGate或QualityDecision授权。
7. 运行专项测试、`npm test`、`npm run build`、SQLite连续初始化和`git diff --check`；SQLite按V1-2 test-plan第4节使用`.tmp`隔离库，不读取`.env`数据库。
8. 审查diff后新增V1-2 closeout；只有closeout明确全部退出标准通过，才把主线切换到V1-3。

## 7. 禁止事项

- 不调用真实图片、视频、PPT或最终包Provider。
- 不制作新的外部Codex编排验收包。
- 不由外部Codex替智能体选择创意、批准课程锚点或决定返修。
- 不提前改固定DeliveryPlan、生成强度UI或双用户阶段。
- 不移动`v1`或`v1.1.0-alpha`标签，不擅自push或部署。
- 不把全量测试绿色解释成尚未覆盖的产品语义已经成立。
