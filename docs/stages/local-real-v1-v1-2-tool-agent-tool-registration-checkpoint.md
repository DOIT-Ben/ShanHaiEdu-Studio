# ShanHaiEdu V1-2 Tool与Agent Tool实现检查点

更新时间：2026-07-13

状态：`production candidate under review / 119 of 121 focused tests passing / not closed`

## 1. 结论

V1-2已经形成可审查的Registry、调用信封、Router、Schema、默认授权和课程锚点独立Critic候选实现，但尚不能标记`done`，也不能宣称课程锚点已经由产品内部独立Critic闭环审查。当前候选仅剩2个已知自动化红灯：默认数据库授权未拒绝两类审批状态自相矛盾的review target；修复后仍须完成最终diff复核、全量验证和closeout，才能进入V1-3 Main Agent同轮受控ReAct。V1-2结束时三个Agent Tool仍保持生产不可执行，真实Critic Executor与运行时闭环属于V1-3/V1-7。

本检查点只记录真实代码和测试事实，不调用真实图片、视频或PPT Provider，不制作新交付包。

## 2. 基线

- 工程：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main`
- 分支：`main`
- 本次审计父基线：本地HEAD为`2fef018e5518b03118d509cf454356a602aba7cd`，上游`origin/main`为`c85c49f65d0fb6a438c06dba76e5e81ad271dbbc`，当时本地ahead 2、behind 0；下一会话必须重新执行`git status --short --branch`，不得把本段当作动态状态。
- `v1`与`v1.1.0-alpha`均为不可移动历史标签；当前V1-1/V1-2工作树成果不在这两个标签内。
- V1-1编排归因审计已完成，当前固定DeliveryPlan、规则Resolver与人工离线决策不能被归因为Main Agent同轮自主编排。

## 3. 已实现候选

| 能力 | 当前事实 | 能否视为生产闭环 |
|---|---|---|
| Agent Tool类型与Registry | 已注册`ppt_director.plan_or_repair`、`video_director.plan_or_repair`、`delivery_critic.review` | 否，Executor与Main Agent生产接线留给后续阶段 |
| Main Agent白名单 | 已区分高层业务Tool、Agent Tool与底层Provider能力 | 仅合同可见性候选 |
| 调用信封 | 已包含执行身份、projectId、IntentEpoch、sourceMessageId、输入hash、action digest、已批准输入和待审Artifact引用；默认数据库授权18项中16项通过 | 当前先关闭两类审批状态一致性红灯；生产组合入口仍需在V1-3/V1-7复核租约、fence、重放和TOCTOU |
| Agent Tool Router | 已执行名称解析、输入输出Schema、权限、独立Critic策略、签名目标绑定、无产物副作用与无Executor时fail-closed；证据充分性和blocking finding测试已通过 | 修复当前授权红灯后做最终diff复核和全量回归 |
| 课程锚点独立Critic候选 | `delivery_critic.review(domain="video", stage="course_anchor")`可返回六硬门、结构化返修和下游策略结果 | 注入Executor固定为`unverified_injected`且`productionEligible=false`，不能代替生产Critic |
| 测试 | 当前Agent Tool专项8个文件、121项中119项通过 | 2个审批状态一致性红灯未关闭，不能形成closeout |

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

结果：exit 1；8个测试文件中1失败、7通过，121项中2失败、119通过。证据/理由充分性和blocking finding优先级红测已转绿；当前两个红灯是默认数据库授权仍接受`needs_review + isApproved=true`与`approved + isApproved=false`的自相矛盾review target。

同轮只读验证：`npx tsc --noEmit`仅剩未被本轮修改的既有`tests/agent-runtime/runtime-quality.test.ts:84`模型强度类型错误；`git diff --check`为exit 0，仅有LF/CRLF提示。V1-2仍须在closeout前运行全量测试和生产构建。

## 5. 封板缺口

| 优先级 | 缺口 | 直接风险 | 封板要求 |
|---|---|---|---|
| P0 | review target的`approval`与`isApproved`语义可自相矛盾且仍获授权 | 脏审批状态可绕过HumanGate语义并进入Critic | 两类矛盾组合均fail-closed，Executor调用为0；合法组合继续通过 |
| 已覆盖/待复核 | 六门证据/理由、blocking finding、通用Critic领域隔离、签名目标、typed locator和failed/inconclusive完整性 | 单项测试通过不等于最终diff已审完 | 保留现有通过测试，修复当前红灯后做最终diff审查和全量回归 |
| P1 | 文本纵深防御对否定语义不稳 | “不是课堂活动”等正例可能被误杀 | 结构化字段优先；补否定句、独立教室叙事和儿童独立创意正例 |
| V1-3/V1-7 | 授权查询与Executor/持久化之间仍有TOCTOU、重放和最新版本唯一性风险 | 生产接线后可能消费过期审查 | 在项目写租约和fencing下二次复核IntentEpoch、sourceMessage、目标version/full digest、Rubric digest和调用幂等；测试注入`authorize`不得进入生产组合根 |

## 6. V1-2封板任务

1. 保留当前全部生产候选与测试，不修改真实Provider Adapter，不放宽断言绕过缺口。
2. 修复当前2个红灯：审批状态自相矛盾的review target必须fail-closed且不得调用Executor。
3. 不回退已经通过的课程锚点阶段语义、通用Critic领域隔离、签名目标绑定、typed locator、失败/inconclusive结构化依据和证据充分性测试。
4. 保留否定语义及不过度约束正例，确保儿童或教室有独立叙事理由时可以通过。
5. 保持注入Executor为`unverified_injected`、`productionEligible=false`；六门通过只允许进入后续Guard，不等于Provider、HumanGate或QualityDecision授权。
6. 运行专项测试、`npm test`、`npm run build`、`git diff --check`，并区分本轮问题与既有TypeScript基线债务。
7. 审查diff后新增V1-2 closeout；只有closeout明确全部退出标准通过，才把主线切换到V1-3。

## 7. 禁止事项

- 不调用真实图片、视频、PPT或最终包Provider。
- 不制作新的外部Codex编排验收包。
- 不由外部Codex替智能体选择创意、批准课程锚点或决定返修。
- 不提前改固定DeliveryPlan、生成强度UI或双用户阶段。
- 不移动`v1`或`v1.1.0-alpha`标签，不擅自push或部署。
- 不把全量测试绿色解释成尚未覆盖的产品语义已经成立。
