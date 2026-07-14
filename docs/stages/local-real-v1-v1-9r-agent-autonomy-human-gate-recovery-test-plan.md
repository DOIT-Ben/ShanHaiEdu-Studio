# ShanHaiEdu V1-9R Main Agent 自主编排与 HumanGate 恢复测试计划

更新时间：2026-07-13

状态：`Accepted / write failures first / blocks real Provider E2E`

关联计划：`docs\stages\local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-plan.md`

## 1. 测试原则

- 以教师可观察行为、持久化任务事实和真实 Tool/Observation 轨迹为通过依据，不以 Prompt 文案、mock 对话或外部 Codex 手工推进作为证据。
- 先把本次真实失败对话转成确定性回归并确认失败，再修改实现；旧测试中“每个节点都要继续/批准”的断言必须删除或改成风险分级断言。
- V1-9R0 至 V1-9R5 优先使用确定性 Executor、失败注入和本地可审计 artifact，不烧真实图片和视频 Provider。
- V1-9R5 全部通过并形成V1-9R closeout后，V1-9只执行一次完整真实产品E2E；失败后先归因，只复验受影响环节。V1-10发布证据单独收口。
- deterministic Runtime 仅可作为明确标识的测试夹具，生产路径不得将其结果保存为真实成果或“生成成功”。

## 2. P0 验收矩阵

| 编号 | 场景 | 输入/动作 | 通过标准 |
|---|---|---|---|
| R-A01 | 一句话 PPT | 教师只发一次明确 PPT 目标 | 建立一个 TaskBrief 和一个活动计划；标准预算内由Main Agent自主推进到真实模型来源、任务语义完整、证据绑定、最低结构有效且可供下游使用的结构化设计候选；不要求最终PPTX，需求稿、大纲、设计稿、样张不逐节点打断 |
| R-A02 | 一句话完整材料包 | 教师明确请求教案、PPT、导入视频和整包 | Main Agent自主形成任务范围、规划和必要高层Tool动态轨迹，正确处理授权、Observation/Replan和真实风险PendingDecision；R5不调用真实图片、视频或整包Provider |
| R-A03 | 按需局部任务 | “只做视频脚本，不做 PPT 和成片” | 计划只包含目标范围；未授权媒体 Tool 调用为 0；系统不强迫补齐整包 |
| R-A04 | 控制消息不丢目标 | 活动任务中发送“确定”“继续” | 控制消息解析到活动任务或 PendingDecision；TaskBrief 原目标、教材、约束和强度保持不变；不生成新的空 requirement spec |
| R-A05 | 自然语言改道 | 样张阶段说“把叙事改成投篮命中率，不要原方案” | IntentEpoch 或计划 revision 递增；只失效受影响下游；迟到旧结果不得提升；Main Agent 自动 Replan |
| R-A06 | 可推断默认值 | 教材和上下文已经给出年级、课题和页数范围 | Main Agent 使用可靠默认并明确可修改，不提出重复需求确认 |
| R-A07 | 真正歧义 | 两个方向对交付有实质不同且无可靠依据 | 只提出一个具体问题，给出推荐默认项和影响；回答后恢复原任务，不重新开始 |
| R-A08 | 标准任务授权 | 明确请求完整PPT/视频，当前预算策略和积分上限已向教师披露并被账号接受，预计费用在绑定版本内 | `IntentGrant`记录披露版本、上限和必要可逆内部动作；不为每个Tool创建actionId或确认卡 |
| R-A09 | 未披露/超预算/最高强度 | 没有有效预算披露、策略版本变化、预计超出授权或进入最高强度 | 产生唯一typed PendingDecision，说明积分与影响；确认前零付费调用；拒绝后不循环提示 |
| R-A10 | 外发/破坏性动作 | 发布、邀请、权限变化、覆盖或删除 | 必须显式 HumanGate；action 与 actor/project/intent/plan 绑定，过期或改道后不可重放 |
| R-A11 | Tool 连续 ReAct | 任一合格高层业务Tool返回成功、校验失败或返修finding | Main Agent读取具体Observation后自主continue、repair、换Tool或Replan；服务端不固定下一Tool、不统一强制回到awaiting_confirmation，Director/Critic不作为机械必经节点 |
| R-A12 | 业务 Tool 可发现性 | 给出 PPT、视频和整包三类目标 | Main Agent可看到全部当前合格的白名单高层业务Tool并自主选择所需Tool；裸Provider、数据库、密钥和状态提升不可见；断言合法动态轨迹而非固定Tool顺序 |
| R-A13 | 输入信封完整 | Tool 执行任一计划步骤 | Tool 收到 actor/project/task、TaskBrief digest、完整结构化输入、IntentEpoch、plan revision、强度快照、授权和幂等键 |
| R-A14 | 质量与签收分离 | 内部版本 Validator/Critic 通过但教师尚未签收 | 合格内部版本可供下游继续；教师签收仍为独立状态；不把任一状态冒充另一状态 |
| R-A15 | Runtime 超时 | 注入超时或断网 | 保存分类错误与 Run/Observation；在预算内有限重试；不产生 deterministic 成果；可从原 TaskBrief 恢复 |
| R-A16 | 解析/校验失败 | 注入坏 JSON、缺字段或错误 artifact | `ValidationReport.reasonCode`和具体Observation返回Main Agent；无成功状态提升；Main Agent可修输入、换合法路径或Replan；失败不自动转成`ask_teacher` |
| R-A17 | 循环停止 | 连续返回相同 blocking finding | 精确重复达到预算后停止，诚实暂停并持久化阻塞原因和恢复入口；不得重复付费、循环调用、无限询问“是否继续”或生成fallback成果 |
| R-A18 | 双用户隔离 | 两个账号在不同项目同时运行并分别改道/调强度 | TaskBrief、IntentGrant、PendingDecision、IntentEpoch、run/job、费用、artifact 和消息完全隔离 |

## 3. 产品体验回归

| 编号 | 场景 | 通过标准 |
|---|---|---|
| R-U01 | Markdown | 标题、加粗、列表、引用和安全链接正确渲染；教师界面不出现裸 `**`、`##` 或 `>`；危险 HTML 不执行 |
| R-U02 | 草稿提示 | Runtime 失败不再展示“这是一份结构草稿”类成功卡；界面显示真实失败、编号、影响和恢复动作 |
| R-U03 | 历史成果 | 旧消息引用的 artifact/version 仍可打开；最新版本和历史版本不因 mapper 只保留最新而消失 |
| R-U04 | 强度一致性 | 右下角、设置弹窗、服务端快照和下一次 Runtime 使用同一档位；409 后采用服务端权威状态 |
| R-U05 | 窄屏布局 | 390px 下标题、状态、箭头和操作不被挤出或裁切；抽屉可滚动，输入区不被遮挡 |
| R-U06 | 处理状态 | 长任务有持久的当前动作、等待决定、失败或完成状态；刷新和重新进入后恢复，不用前端定时器伪造 |

字体偏好、完整活动流、成果工作区和高级滑块动效不属于 V1-9R P0；只有当前字体可读性、控件对齐和状态真实性阻塞本阶段。

## 4. 阶段门

### V1-9R0 失败基线门

- 对真实 38 条对话做脱敏 fixture，至少覆盖“投篮命中率”“继续”“确定”和重复 requirement spec。
- 新增测试必须先在当前实现上失败，且失败原因与真实故障一致。
- 识别并改写把逐节点确认固化为成功行为的旧断言，不允许只给新代码旁路旧测试。

### V1-9R1 语义贯穿门

- `TaskBrief` 在首轮、控制消息、队列恢复和 Tool 执行四处 digest 一致。
- `inputDraft`、可信 artifact refs 和强度快照进入 ExecutionEnvelope，缺任一关键字段 fail closed。
- 改道后旧 IntentEpoch 的 Tool、Job 和 HumanGate action 均不能提升状态。

### V1-9R2 HumanGate 门

- 明确的一句话任务在标准范围内例行 HumanGate 次数为 0。
- 用户显式要求检查点时精确暂停一次；批准、修改、拒绝后结果与绑定版本一致。
- 超预算、最高强度、外发、权限和破坏性动作保持零越权调用。
- 同一活动任务同一决策只有一个 PendingDecision；按钮和自然语言得到相同结果。

### V1-9R3 Tool loop 门

- 白名单业务 Tool 能进入 Main Agent 受控循环，原始 Provider Tool 仍不可见。
- 每次 Tool 后先保存 Observation，再决定 continue/repair/replan/wait/finish。
- 异步 Tool 挂起和恢复不重复提交；恢复使用原授权和幂等键。
- 达到 Tool、时间、费用或重复失败预算时可靠停止。

### V1-9R4 失败与 UI 门

- 超时、网络、Schema、解析、Validator、Critic 和 Provider 拒绝至少各有一条分类回归。
- 生产路径没有“捕获异常后生成 deterministic 成果”的可达成功分支。
- R-U01 至 R-U06 自动化通过；1366x768 和 390x844 真实浏览器完成关键路径。

### V1-9R5 自主控制面验收门

- Main Agent看到全部当前合格的高层业务Tool并自主决定调用顺序；黑盒断言目标覆盖、合法选择、具体Observation和动态轨迹，不断言固定Tool顺序。
- 服务端不固定下一Tool，Director/Critic不作为机械必经节点；Tool成功或失败后由Main Agent自主continue、repair、换Tool或Replan。
- 一句话PPT只需推进到真实模型来源、任务语义完整、证据绑定、最低结构有效且可供下游使用的结构化设计候选，不要求真实PPTX、完整图片、MP4或ZIP。
- 完整材料包场景只验证任务范围、规划、授权、Observation/Replan和无串线，不调用真实图片、视频或整包Provider。
- 同一Tool连续失败必须返回`ValidationReport.reasonCode`和Observation；只有缺少真实用户选择、授权、预算或存在外发/破坏性副作用时进入HumanGate，重试耗尽则诚实暂停并保存恢复入口。
- 两个受邀账号在不同项目同时发起任务，其中一个改道、另一个保持原计划；一个任务失败恢复、一个任务继续执行，状态、费用和产物不串线。
- 至少覆盖：一句话PPT、完整材料包规划、按需局部任务、自然语言暂停/改道、真实风险HumanGate、历史artifact打开、强度同步和桌面。390px不属于V1发布前真实黑盒门，R-U05继续由既有自动化与历史窄屏证据覆盖。
- 当前DeepSeek Director运行只作诊断证据；若失败来自V1-9 production Schema，不做等价Provider重跑，先修合同责任边界。
- R-A01至R-A18、R-U01至R-U06逐项有证据；外部Codex运行中选择Tool、批准中间产物或决定返修的次数为0。

### V1-9R5 单轮ReAct上下文压缩专项门

- 先写红测试证明第3次continuation仍包含第1次raw reasoning、旧function call或旧Tool output；实现后这些旧项必须消失，只保留原始压缩输入、`react-checkpoint.v1`和最近一次call/output配对。
- 检查点确定性保留TaskBrief digest、task/project、IntentEpoch、plan revision、强度、授权与预算摘要、当前Tool集合、Observation reasonCode、Artifact/Report引用和重复失败事实。
- Tool返回超长structuredOutput或Provider返回超长reasoning时，continuation请求不得按原始长度累加；超过软预算时折叠最旧轮次，但不得丢失最近Observation、失败reasonCode和恢复引用。
- Main Agent初始请求不得重复发送顶层权威上下文和包含同一对象的完整`conversationContext`；没有`ContextPackage`时仍保留最近消息兼容窗口。
- 每轮脱敏遥测包含请求字符数、token估算、轮次、检查点大小、Observation数、Tool数和耗时；不得包含用户正文、reasoning、Tool输出、URL、路径或凭据。
- 压缩后仍断言模型动态选择合法Tool、Observation先持久化、失败可换Tool/Replan、重复失败诚实暂停；不得引入固定Tool顺序、HumanGate扩大或fallback成果。
- 本专项仓内通过后只允许重新运行一次真实桌面；桌面通过即可进入R5其余证据收口，不再运行390px。离线测试不得写成R5整体通过，也不得调用真实图片、视频、PPTX、ZIP或整包Provider。
- 隔离 runner 的外层 Playwright 命令时限必须大于该 spec 自身的最长测试时限并保留清理余量；不得由外层先杀死仍在正常轮询的真实任务，再误报为产品或 Provider 超时。

### V1-9 真实产品 E2E 门

- 从教师UI发送一次完整任务，产品Main Agent独立完成结构化教案、真实可编辑PPTX、课堂视觉图、30-90秒完整MP4和最终ZIP。
- PPT 走逐页四层设计、样张、全量生图、可编辑组装、渲染审查和页级返修；样张默认由产品内 Director/Critic 决策，只有教师显式要求才暂停。
- 视频走独立创意、唯一最小课程锚点、Beat/ShotSpec、逐镜头生成、真实组装和成片二次 Critic；不得把小学生受众等同于儿童主角、教室或课堂活动。
- `ClassroomRunSpec`必须对齐视频结束点、PPT页面、教师操作、答案揭示和课堂节奏；ZIP只收录当前`final_eligible`版本，manifest、hash、数据库记录和真实目录一致。
- 产品内所有质量门通过后，外部 Codex 只读取最终包做黑盒审核；发现问题必须定位责任层和最小复验范围，不手工补包。
- V1-9形成独立closeout：真实包完整、外部审核P0=0、运行中外部编排介入0次。该证据不能被V1-9R自动化替代。

### V1-10 发布门

- 至少一名真实教师在候选环境完成关键任务并签收；签收绑定最终包版本和digest。
- 签收后使用既有原子切换和回退能力执行公网切流，不移动历史标签。
- 切流后复核公开注册关闭、生产健康、认证、项目进入、对话、成果查看/下载和反馈提交；失败立即按既有入口回退。
- 目标服务器共享卷重启、release回滚、备份恢复和数据摘要不变通过，创建新的不可变发布标识后才关闭V1。

## 5. 建议测试文件边界

优先扩展既有测试，不为同一服务重复创建平行测试框架：

```text
tests\conversation-turn-service.test.ts
tests\conversation-control-resolver.test.ts
tests\conversation-context-builder.test.ts
tests\model-main-conversation-agent.test.ts
tests\agent-runtime\main-agent-controlled-react-loop.test.ts
tests\agent-runtime\main-agent-tool-loop-config.test.ts
tests\agent-tools\main-agent-tool-registry.test.ts
tests\agent-tools\main-agent-tool-dispatcher.test.ts
tests\capability-availability.test.ts
tests\human-gate.test.ts
tests\generation-intensity-*.test.ts
tests\ppt-main-agent-orchestration.test.ts
tests\video-main-agent-orchestration.test.ts
```

UI 回归优先沿用现有组件和 mapper 测试，再增加 V1-9R 浏览器 spec；不得只用源码字符串断言代替真实页面行为。

## 6. 集中验证命令

实现阶段按资源安全原则先定向、后全量：

```text
npx vitest run <V1-9R targeted tests> --maxWorkers=1
npx tsc --noEmit
npm test
npm run build
npm run test:e2e -- <V1-9R browser specs>
git diff --check
```

通过记录必须包含命令、exit code、测试文件数/用例数、浏览器视口、fixture/真实 Provider 标识、提交 SHA 和残余风险。没有真实请求或浏览器证据时，不得把对应项目写成已通过。

## 7. 退出条件

V1-9R test closeout必须逐项引用R-A01至R-A18、R-U01至R-U06的证据。任一以下情况存在时不得恢复V1-9真实E2E；V1-9真实包和V1-10发布证据必须分别写入后续closeout，不能反向填入V1-9R：

- 明确任务仍需要重复批准内部节点。
- “继续/确定”仍会覆盖或丢失 TaskBrief。
- Main Agent 仍不能调用业务 Tool 或 Tool 后统一停回确认态。
- 质量通过与教师批准仍由同一个状态表达。
- Runtime 失败仍可形成 deterministic 成功成果。
- 两个用户的任务、授权、强度、费用或产物存在串线。
- 历史成果、Markdown 或强度状态仍会误导教师。
- 付费Tool在没有有效预算披露版本与IntentGrant时仍可执行。
