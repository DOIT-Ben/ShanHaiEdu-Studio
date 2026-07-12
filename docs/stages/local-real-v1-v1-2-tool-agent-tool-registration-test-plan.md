# ShanHaiEdu V1-2 Tool与Agent Tool注册测试计划

更新时间：2026-07-13

状态：`production candidate under review / 119 of 121 focused tests passing`

关联计划：`docs\stages\local-real-v1-v1-2-tool-agent-tool-registration-plan.md`

## 1. 测试边界

- 不调用真实图片、视频、PPT或其他付费Provider。
- 不把注入的Fake Agent Executor结果写成产品Agent真实质量证据。
- 本阶段只证明注册、Schema、路由、权限、结果语义和课程锚点硬门。
- Main Agent同轮多工具ReAct在V1-3测试，不在本阶段提前宣称。

## 2. 红测矩阵

| 编号 | 场景 | 通过标准 |
|---|---|---|
| T2-01 | 三个Agent Tool注册 | Canonical ID与transportName唯一且稳定 |
| T2-02 | Agent Tool严格Schema | 所有对象`additionalProperties=false`，required与properties一致 |
| T2-03 | Agent Tool权限 | `sideEffect=none`、不需HumanGate、无producedArtifactKind |
| T2-04 | Main Agent白名单 | 只包含计划批准的高层业务Tool和三个Agent Tool |
| T2-05 | 敏感能力隐藏 | 白名单Schema与描述不出现凭据、URL、数据库、状态提升或内部路径 |
| T2-06 | Canonical映射 | transportName只能解析到唯一Agent Tool；未知名稳定拒绝 |
| T2-07 | 调用信封完整性 | 缺actor/project/intentEpoch/inputHash/sourceMessage任一字段稳定拒绝 |
| T2-08 | 项目与输入绑定 | 参数中的project/epoch/ref与信封不一致稳定拒绝 |
| T2-09 | Agent Tool路由 | 注入Executor只收到Registry定义和校验后的参数 |
| T2-10 | Agent Tool无产物副作用 | 成功结果没有产品ArtifactDraft、节点推进、批准或Provider字段 |
| T2-11 | Agent Tool不可用 | 默认Executor缺失时返回`agent_tool_unavailable`类型化Observation，不回退草稿 |
| T2-12 | Critic分权 | Critic输出不能写Validator硬事实、QualityDecision或教师批准字段 |
| T2-13 | Director候选自评 | 独立短片三问全真可返回候选建议，但不能单独授权真实媒体Tool |
| T2-14 | Critic六硬门 | 六硬门任一failed/inconclusive时结果为`rework_required/blocked/inconclusive`，且没有真实媒体Tool意图 |
| T2-15 | 儿童角色强绑定反例 | “因为面向小学生所以必须儿童主角”在Provider前阻塞 |
| T2-16 | 课堂世界强绑定反例 | 脱离教师讲解或课堂教学活动就无法成立，或仅因小学受众而强制教室世界观时阻塞；教室服务独立叙事时不得阻塞 |
| T2-17 | 教材动画反例 | 复刻教材情境或点数步骤时阻塞 |
| T2-18 | PPT动态版反例 | 逐页PPT叙事改写为镜头时阻塞 |
| T2-19 | 现有ToolRegistry兼容 | 原Capability Tool映射、Router和Provider真值测试不回归 |
| T2-20 | OpenAI Schema单一来源 | Agent Tool与业务Tool统一通过安全转换器，无重复宽松实现 |
| T2-21 | Critic证据充分性 | 六门全过但任一门证据或理由为空时返回`inconclusive`，不得进入下游Guard |
| T2-22 | 阻塞finding优先级 | 任一blocking finding必须推翻pass并返回`rework_required`，真实媒体Tool意图为0 |
| T2-23 | Critic领域隔离 | 课程锚点六门只在video/course_anchor强制；PPT和final Critic仍可通过各自Schema |
| T2-24 | 审查目标绑定 | 顶层locator匹配签名review target；page/shot/artifact定位携带对应ID，错目标稳定拒绝 |
| T2-25 | 生产资格fail-closed | 注入Executor无论业务结果如何均为`productionEligible=false`；仅检查`status=succeeded`不能绕过 |

## 3. 目标测试文件

- `tests\agent-tools\agent-tool-registry.test.ts`
- `tests\agent-tools\main-agent-tool-registry.test.ts`
- `tests\agent-tools\agent-tool-router.test.ts`
- `tests\agent-tools\agent-tool-router-default-authorization.test.ts`
- `tests\agent-tools\video-course-anchor-gate.test.ts`
- `tests\tool-registry.test.ts`
- `tests\tool-router.test.ts`
- `tests\openai-tool-schema.test.ts`（若现有测试拆分需要）

## 4. 阶段验证

生产候选已写入工作树。2026-07-13 03:15新鲜执行`npx vitest run tests/agent-tools tests/tool-registry.test.ts tests/tool-router.test.ts --maxWorkers=1`：8个文件中1失败、7通过，121项中2失败、119通过。两个红灯是默认数据库授权仍接受`needs_review + isApproved=true`与`approved + isApproved=false`的自相矛盾review target；此前证据充分性、blocking finding和合同纵深红测已转绿。不得通过删除用例、放宽断言或回退测试获得绿色。修复审批状态一致性后依次执行：

```text
npx vitest run tests/agent-tools tests/tool-registry.test.ts tests/tool-router.test.ts
npm test
npm run build
git diff --check
```

文档收尾记录实际测试文件数、用例数、构建结果和未验证边界。没有新鲜输出不得标记V1-2完成。

## 5. 封板补测

当前专项测试已证明注册、Router、独立Critic候选和默认授权候选可运行，但还必须覆盖并关闭以下场景：

- `delivery_critic.review(domain="video", stage="course_anchor")`六个硬门任一失败或inconclusive时，真实媒体Tool意图全部移除。
- Critic失败仍返回Main Agent可消费的`responsibleStage`、typed locator、minimal fix和禁止Tool列表，不退化为通用失败文案。
- 仅在`premise`写入儿童/课堂强绑定、教材复刻或PPT动态版时仍能阻塞。
- 儿童主角有独立创意理由时允许通过；教室仅用于最后课程回接是明确正例，教室服务独立叙事且不依赖课堂教学时也允许通过。
- 0个或多个课程锚点均阻塞；只有一个最小锚点可继续，且`doNotExplain`阻止答案泄露。
- 不注入`authorize`，使用测试数据库分别覆盖无权限actor、错project、旧IntentEpoch、未批准Artifact、错version和错digest。
- 六门`passed`必须逐门携带非空证据和理由；任一blocking finding必须推翻pass。
- 通用Critic的PPT/final调用不被课程锚点六门污染；课程锚点目标类型、目标digest和顶层locator与签名review target一致。
- failed/inconclusive必须携带可执行finding或非空原因；typed locator按kind携带对应ID。
- 审查目标的`approval`与`isApproved`必须语义一致；任一脏状态组合稳定fail-closed且Executor调用为0。

这些补测通过并形成closeout前，旧检查点绿测不得被解释为“课程锚点智能体审查闭环已完成”。V1-2 closeout也只证明合同、Router硬门、默认授权边界和注入Executor测试成立；生产Critic Executor、Main Agent调用、CriticReport持久化和真实Observation/Replan证据仍分别属于V1-3与V1-7，届时通过前不得宣称产品运行时闭环。
