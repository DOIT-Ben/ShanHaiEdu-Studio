# ShanHaiEdu V1 Main Agent主线开发交接

更新时间：2026-07-13

状态：`ready for next development conversation / resume at V1-2 closure`

## 1. 交接结论

下一对话可以直接进入主线开发，但不能跳到V1-3。唯一恢复点是V1-2正式封板：在合同、Router和注入Executor测试层补齐课程锚点独立Critic、结构化返修Observation、不过度约束测试和默认授权集成测试；完成closeout后再进入V1-3 Main Agent同轮受控ReAct。V1-2不接生产Critic Executor。

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

## 4. 课程锚点不可退让规则

课程锚点只是已经成立的独立短片与课程任务之间的唯一最小回接，不是全片世界观，也不是“小学课堂视频”的角色和场景模板。

产品内独立Critic必须检查：

1. 不懂教材和学科背景仍能理解短片发生了什么。
2. 去掉最后课程回接，短片仍有目标、阻碍、变化和观看价值。
3. 不是教材复刻、PPT动态版或课堂活动录像。
4. 全片只有一个最小课程回接，并明确`doNotExplain`，不提前泄露答案。
5. “面向小学生”只约束可理解性、安全性和节奏，不自动要求儿童、教师、教室或课堂活动。
6. 儿童主角有独立创意理由时可以通过；教室仅在最终交接是明确正例但不是唯一许可，教室服务独立叙事且不依赖课堂教学时也可以通过。

任一硬门失败或证据不足，真实图片、视频、拼接和最终包Tool调用次数必须为0。Main Agent必须消费CriticReport中的责任阶段与最小修复，自主换创意机制、定点Replan或请求HumanGate。

## 5. 当前真实状态

- 工程：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main`
- 分支：`main`
- 父基线：`c85c49f65d0fb6a438c06dba76e5e81ad271dbbc`
- 历史标签：`v1`与`v1.1.0-alpha`不可移动。
- V1-1：已完成编排归因审计和closeout。
- V1-2：Registry、调用信封、Router、Main Agent白名单、初版锚点门和测试已有实现检查点；未正式closeout。
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
在合同、Router和注入Executor测试层让delivery_critic.review成为课程锚点独立权威审查，
将结构化返修依据回流Main Agent，关闭premise绕过和过度约束风险，
证明默认数据库授权边界，完成全量验证与closeout。
```

执行顺序：

1. 写封板红测，不调用真实Provider。
2. 最小修改CourseAnchor、VideoCriticReport、Router与Observation合同。
3. 运行专项测试并修正。
4. 运行全量测试、生产构建和diff检查。
5. 审查是否仍由Director自评、Fake Executor或外部Codex代替Critic。
6. 新建V1-2 closeout并同步主线状态；保持Agent Tool的`executorReady=false`与`mainAgentExecutable=false`。
7. V1-2全部退出条件通过后，下一阶段才是V1-3 Main Agent同轮受控ReAct与固定DeliveryPlan降级。

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
