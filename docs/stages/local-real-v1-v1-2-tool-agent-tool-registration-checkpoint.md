# ShanHaiEdu V1-2 Tool与Agent Tool实现检查点

更新时间：2026-07-13

状态：`implementation checkpoint / not closed`

## 1. 结论

V1-2已经形成可审查的Registry、调用信封、Router、Schema和初版课程锚点硬门，但尚不能标记`done`，也不能宣称课程锚点已经由产品内部独立Critic闭环审查。下一开发会话必须先完成本检查点列出的合同与Router封板修正；通过后形成V1-2 closeout，再进入V1-3 Main Agent同轮受控ReAct。V1-2结束时三个Agent Tool仍保持生产不可执行，真实Critic Executor与运行时闭环属于V1-3/V1-7。

本检查点只记录真实代码和测试事实，不调用真实图片、视频或PPT Provider，不制作新交付包。

## 2. 基线

- 工程：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main`
- 分支：`main`
- 本轮父基线：`c85c49f65d0fb6a438c06dba76e5e81ad271dbbc`
- `v1`与`v1.1.0-alpha`均为不可移动历史标签；当前V1-1/V1-2工作树成果不在这两个标签内。
- V1-1编排归因审计已完成，当前固定DeliveryPlan、规则Resolver与人工离线决策不能被归因为Main Agent同轮自主编排。

## 3. 已实现候选

| 能力 | 当前事实 | 能否视为生产闭环 |
|---|---|---|
| Agent Tool类型与Registry | 已注册`ppt_director.plan_or_repair`、`video_director.plan_or_repair`、`delivery_critic.review` | 否，Executor与Main Agent生产接线留给后续阶段 |
| Main Agent白名单 | 已区分高层业务Tool、Agent Tool与底层Provider能力 | 仅合同可见性候选 |
| 调用信封 | 已包含执行身份、projectId、IntentEpoch、sourceMessageId、输入hash、action digest和已批准Artifact引用 | 需要默认授权集成测试封板 |
| Agent Tool Router | 已执行名称解析、输入输出Schema、权限、无产物副作用与无Executor时fail-closed | 需要独立Critic和结构化返修修正 |
| 课程锚点初版硬门 | Video Director结果会检查独立短片三问、最小回接和部分课堂化反例 | 不能代替独立Video Critic |
| 测试 | 初版Agent Tool与现有Tool Router测试通过 | 只证明当前覆盖，不证明语义缺口已关闭 |

三个Agent Tool当前应继续保持：

```text
contractReady=true
executorReady=false
mainAgentExecutable=false
implemented=false
```

不得为了“看起来接通”把Fake Executor或deterministic结果接入生产Main Agent。

## 4. 新鲜验证

2026-07-13已执行：

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

结果：exit 0；仅有Git提示后续触碰时会按工作区规则转换LF/CRLF，没有空白错误。即使测试、构建和diff检查通过，以下语义缺口未关闭前仍不得标记V1-2完成。

## 5. 封板缺口

| 优先级 | 缺口 | 直接风险 | 封板要求 |
|---|---|---|---|
| P0 | Router只对Video Director执行课程锚点门，没有强制`delivery_critic.review(domain="video", stage="course_anchor")` | 生成者自评可以代替独立审查 | Router对注入的独立Critic Executor结果执行固定六硬门，Director/Main Agent自评不能解锁真实媒体Tool；生产Executor仍后置 |
| P0 | 硬门失败丢弃原结构化返修内容，只返回通用失败Observation | Main Agent不知道责任阶段和最小修复，无法可靠Replan | 保留`responsibleStage`、typed locator、minimal fix、禁止下游Tool与证据不足原因 |
| P0 | 课堂化与受众强绑定检查未扫描`storyWorld.premise` | 反例只写在premise时可绕过 | 结构化字段校验为主，文本纵深防御覆盖premise、角色与场景 |
| P0 | 默认授权路径缺少数据库集成测试 | 注入`authorize`通过不能证明真实actor/project/epoch/artifact边界 | 用测试数据库覆盖权限、错project、旧epoch、未批准Artifact、错version和错digest |
| P1 | CourseAnchor与Critic合同未固定唯一性、答案泄露边界和报告来源 | 0个/多个锚点或弱报告可能进入下游 | 增加`anchorTrigger`、`doNotExplain`、`anchorCount=1`、version/digest及Critic来源字段 |
| P1 | 只有机械臂正例和课堂化反例 | 硬门可能过度限制模型创意 | 增加“儿童主角但独立创意成立”“教室仅在最终回接”“教室服务独立叙事”的通过正例 |

## 6. V1-2封板任务

1. 先补红测覆盖上述六项，不修改真实Provider Adapter。
2. 扩展CourseAnchor与VideoCriticReport合同，使六个硬门和报告来源可被Schema验证。
3. 在Router与注入Executor测试中将独立课程锚点审查挂到`delivery_critic.review`，并保留可供后续Main Agent消费的结构化Observation；不在V1-2接生产Executor。
4. 修正premise绕过与不过度约束正例。
5. 补默认数据库授权集成测试。
6. 运行专项测试、`npm test`、`npm run build`、`git diff --check`。
7. 审查diff后新增V1-2 closeout；只有closeout明确全部退出标准通过，才把主线切换到V1-3。

## 7. 禁止事项

- 不调用真实图片、视频、PPT或最终包Provider。
- 不制作新的外部Codex编排验收包。
- 不由外部Codex替智能体选择创意、批准课程锚点或决定返修。
- 不提前改固定DeliveryPlan、生成强度UI或双用户阶段。
- 不移动`v1`或`v1.1.0-alpha`标签，不擅自push或部署。
- 不把全量测试绿色解释成尚未覆盖的产品语义已经成立。
