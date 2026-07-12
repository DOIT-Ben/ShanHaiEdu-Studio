# ShanHaiEdu V1 Main Agent主线开发交接

更新时间：2026-07-13

状态：`ready for next development conversation / V1-2 production candidate under review / 119 of 121 focused tests passing`

## 1. 交接结论

下一对话可以直接进入主线开发，但不能跳到V1-3。唯一恢复点是V1-2现有未提交生产候选的正式封板：让默认数据库授权对两类自相矛盾的审查目标状态fail-closed，复核已经通过的Critic领域隔离、签名审查目标/locator绑定和失败报告完整性，再完成全量验证与closeout。V1-2不接生产Critic Executor。

当前目标不是再让外部Codex制作一套PPT或视频，而是把已经证明可行的交付工艺变成产品内部Main Agent能够自主规划、调用、审查、打断恢复和返修的能力。

## 2. 产品与三层设计

ShanHaiEdu是面向教师、百依百顺但受事实与安全门禁约束的公开课制作助手。它不是固定单向流水线，也不是由外部Codex代做成品的包装层。

| 设计层 | 决定什么 | V1要求 |
|---|---|---|
| 智能体架构 | 谁观察、规划、调用Tool、Replan、持久化和恢复 | 产品Main Agent执行受控`Observe -> Plan -> Guard -> Act -> Observe -> Replan`；专业Agent Tool负责领域规划与审查 |
| 交付质量架构 | 哪些事实与质量门必须通过 | Validator管文件/页数/hash/血缘，Critic管语义与效果，HumanGate管教师授权，QualityDecision与FinalDeliveryGate决定能否继续 |
| PPT/视频生产工艺 | 每个专业节点如何产出高质量内容 | PPT按大纲、逐页四层设计、样张、全量生图、可编辑组装、渲染审查、页级返修；视频按独立创意、最小课程锚点、Beat、ShotSpec、专属资产、逐镜头生成、审查、镜头级返修与真实合成 |

这些专业工艺应封装为高层业务Tool、Agent Tool、Contract、Rubric与内部子工件，不得把每个细节都上升为顶层固定DAG。教师可随时用自然语言暂停、改大纲、换方向或局部返修，Main Agent依据当前WorldState只补最小必要前置。

## 3. 责任边界

| 责任 | 产品内部 | 外部Codex |
|---|---|---|
| 理解教师意图、选择下一动作、Replan | Main Agent | 不代做 |
| PPT/视频专业规划 | PPT/Video Director Agent Tool | 只实现合同、Prompt和接线 |
| 课程锚点和交付效果审查 | 独立`delivery_critic.review` | 不在运行中选案、批准或返修 |
| 文件真实性、权限、血缘、预算 | 服务端Validator/Guard/Repository | 实现并审计证据 |
| 教师授权 | 真实HumanGate | 不把模拟批准写成教师签收 |
| 阶段末真实整包 | 产品Main Agent独立生成 | 成包后黑盒审核并归因，不在运行中补链 |

如果Main Agent协调失败，先归因到WorldState、上下文、Tool可发现性、合同、Observation质量、Prompt、Rubric、预算或停止条件，再修对应责任层。禁止让外部Codex接管业务决策来掩盖产品缺陷。

协调失败按下列顺序处理，不允许直接以外部人工编排兜底：

| 失败信号 | 首查责任层 | 修复后的最低证据 |
|---|---|---|
| 不会选择或看不到正确Tool | Tool Registry、白名单、Tool描述与输入合同 | Main Agent在同一WorldState下自主选择合法Tool |
| Critic已给出报告但不会返修 | CriticReport、Observation序列化、上下文和Replan Prompt | Main Agent定位责任阶段并改变下一动作 |
| 重复同一失败或无限循环 | 步骤/费用/重试预算、停止条件、IntentEpoch | 达到预算后暂停或请求HumanGate，不重复付费提交 |
| 只有外部脚本介入后才能继续 | 产品内编排或持久化缺口 | 把介入动作转成Agent/Tool/Guard测试；外部介入次数回到0 |

## 4. 课程锚点不可退让规则

课程锚点只是已经成立的独立短片与课程任务之间的唯一最小回接，不是全片世界观，也不是“小学课堂视频”的角色和场景模板。

产品内独立Critic必须检查：

1. 不懂教材和学科背景仍能理解短片发生了什么。
2. 去掉最后课程回接，短片仍有目标、阻碍、变化和观看价值。
3. 不是教材复刻、PPT动态版，且不是脱离教师讲解或课堂教学任务便无法成立的活动脚本/录像。
4. 全片只有一个最小课程回接。
5. “面向小学生”只约束可理解性、安全性和节奏，不把受众年龄扩张成人物或场景的必需条件。
6. 明确`doNotExplain`，不提前泄露答案或替代教师讲解。

儿童主角有独立创意理由时可以通过。教室只用于最终交接是明确正例，但并非唯一允许情形；教室服务独立叙事且不依赖课堂教学时也可以通过。

任一硬门失败或证据不足，真实图片、视频、拼接和最终包Tool调用次数必须为0。Main Agent必须消费CriticReport中的责任阶段与最小修复，自主换创意机制、定点Replan或请求HumanGate。六门通过也只是后续Guard的必要语义前置，不独立授权真实媒体调用。

### 4.1 双层审查不可混淆

| 时点 | 审查主体 | 允许动作 | 禁止替代 |
|---|---|---|---|
| 真实媒体调用前 | 产品内独立`delivery_critic.review` | 审查课程锚点、阻塞、输出结构化返修依据；Main Agent自主Replan | 外部Codex选案、批准锚点、改脚本或决定返修范围 |
| V1-9产品内成包后 | 外部Codex/独立验收者 | 黑盒审核PPT、视频、锚点、版本一致性和课堂可用性，并把问题归因到责任层 | 在任务运行中补链，或把外部修好的包记成产品能力 |

前者是产品能力门禁，后者是局外验收。两者都必须存在，但证据不得互相替代。

## 5. 当前真实状态

- 工程：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main`
- 分支：`main`
- 本次审计父基线：本地HEAD为`2fef018e5518b03118d509cf454356a602aba7cd`，`origin/main`为`c85c49f65d0fb6a438c06dba76e5e81ad271dbbc`，当时本地ahead 2、behind 0；文档提交后或新会话开始时必须重新核对动态Git状态。
- 历史标签：`v1`与`v1.1.0-alpha`不可移动。
- V1-1：已完成编排归因审计和closeout。
- V1-2：Registry、调用信封、Router、Main Agent白名单、独立课程锚点Critic、结构化返修与默认授权已有未提交生产候选，尚未正式closeout。
- 当前未提交候选修改6个`src\server\tools\`生产文件、4个既有Agent Tool测试和1个新增默认授权测试。它们属于用户工作树，不得删除、回退、覆盖或通过放宽断言使其伪绿。
- 当前专项证据：2026-07-13 03:15执行`npx vitest run tests/agent-tools tests/tool-registry.test.ts tests/tool-router.test.ts --maxWorkers=1`，8个测试文件中1失败、7通过；121项中2失败、119通过。两个红灯均位于默认数据库授权：`needs_review + isApproved=true`和`approved + isApproved=false`的自相矛盾审查目标仍被授权。
- 已通过专项纵深测试：六门pass的证据/理由充分性、blocking finding优先级、通用Critic领域隔离、签名review target与typed locator绑定、failed/inconclusive完整性、损坏JSON fail-closed及不过度约束正例。closeout前仍须复核最终diff，不能只凭单项测试宣称合同封板。
- `npx tsc --noEmit`只剩未被本轮修改的既有`runtime-quality.test.ts:84`错误；`git diff --check`通过。旧的全量Vitest 692/692和生产构建绿色仍只属于候选改动前检查点，当前工作树不能描述为绿色。
- 尚未实现：Agent Tool生产Executor/Main Agent接线、Main Agent同轮多Tool ReAct、固定DeliveryPlan降级、V1-4至V1-10各阶段。
- 既有PPT证明交付工艺有效；既有视频只证明Provider、镜头和合成技术链，课程锚点方向失败，保留为负例。

详细实现事实：`docs\stages\local-real-v1-v1-2-tool-agent-tool-registration-checkpoint.md`。

## 6. 下一对话读取顺序

1. `AGENTS.md`
2. `docs\README.md`
3. `docs\product\current-requirements-baseline.md`
4. `docs\product\requirements-backlog.md`
5. `docs\mainlines\current-mainline-status.md`
6. `docs\stages\local-real-v1-mainline-adjustment-plan.md`
7. `docs\stages\local-real-v1-mainline-adjustment-test-plan.md`
8. `docs\stages\local-real-v1-v1-2-tool-agent-tool-registration-checkpoint.md`
9. V1-2 plan/test-plan及相邻代码和测试

不得重新执行V1-1，不得从旧Stage 6“三套真实任务”路线恢复。

## 7. 下一对话唯一目标

```text
完成V1-2 Tool与Agent Tool注册正式封板：
保留现有未提交候选，修复2个审批状态一致性红灯，
复核Critic领域隔离、签名目标与typed locator、失败报告完整性，
保持注入Executor永远不具备生产资格，完成全量验证与closeout。
```

执行顺序：

1. 保留当前全部未提交生产候选、测试和失败语义，不重写测试绕过缺口，不调用真实Provider。
2. 让两类审批状态自相矛盾的review target稳定fail-closed，不删除用例或放宽断言。
3. 运行专项测试并修正。
4. 运行全量测试、生产构建和diff检查。
5. 审查是否仍由Director自评、注入Executor或外部Codex代替生产Critic；注入Executor证据只能标记为`unverified_injected`且`productionEligible=false`。六门通过只满足后续Guard前置，不等于Provider、HumanGate或QualityDecision授权。
6. 新建V1-2 closeout并同步主线状态；保持Agent Tool的`executorReady=false`与`mainAgentExecutable=false`。
7. V1-2全部退出条件通过后，下一阶段才是V1-3 Main Agent同轮受控ReAct与固定DeliveryPlan降级。

### 7.1 V1-3已冻结的起步边界

V1-3不得只把三个Agent Tool Schema塞进现有单轮tool loop后宣称ReAct完成。进入V1-3时至少要满足：

1. 统一Main Agent Tool Dispatcher按Registry区分只读Agent Tool和产生业务副作用的普通Tool。
2. Director/Critic使用可信Executor；Agent Tool结果序列化为内部Report/Observation，不创建产品Artifact、不推进HumanGate。
3. Main Agent能在同一轮消费Observation后重新选择高层白名单Tool，并受步骤、费用、重试、重复调用和停止条件约束。
4. 执行前和持久化前在lease/fencing下二次复核actor、project、IntentEpoch、sourceMessage、目标version/full digest和Rubric digest；调用信封具备幂等与防重放边界。
5. 固定DeliveryPlan只作为可观察、可标记的显式降级路径，不能计入Main Agent自主编排证据。

## 8. 真实验证策略

- V1-1至V1-8使用确定性夹具、失败注入、Provider adapter测试和持久化状态证据，避免频繁烧真实媒体。
- 只有产品内编排、HumanGate、Quality Gate、双用户隔离和恢复门全部通过后，V1-9才从产品界面执行一次真实PPTX、MP4和最终包E2E。
- V1-9运行期间外部Codex只观察，不选案、不批锚点、不批样张、不决定返修。
- 成包后由外部Codex按PPT、视频、课程锚点、版本一致性和课堂可用性Rubric做黑盒审核；发现问题先归因到责任层，再做必要定点复验，不无归因重复整包。

## 9. 工具与Skill边界

- 本主线不绑定任何开发方法类Skill，禁止`superpowers:*`。
- 可以按任务需要使用与PPT、视频、图片、文档、浏览器或业务质量直接相关的功能性Skill，但它们不能替代产品Main Agent运行时能力证据。
- 不把LangGraph、Vercel AI SDK或其他框架迁移作为V1上线前置；先把当前架构的职责和证据闭环做实。

## 10. 禁止事项

- 不调用真实媒体Provider，不制作新验收包。
- 不移动历史标签，不擅自push、部署或发布。
- 不把mock、Fake Executor、deterministic fallback或外部Codex决策记为产品能力。
- 不提前开发四档生成强度UI、双用户并发或V1-9真实E2E。
- 不因局部卡点停止整条主线；连续两轮无新证据时记录事实、失败点、已尝试动作和恢复入口，只转向不依赖该阻塞且不跨越阶段硬前置的任务。
