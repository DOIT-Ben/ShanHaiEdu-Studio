# ShanHaiEdu V1-7 视频产品内编排闭环计划

更新时间：2026-07-13

状态：`done`

## 1. 目标

复用现有 Video Director、课程锚点六硬门、逐镜头记录和视频业务 Tool，让产品内部 Main Agent 自主完成 Concept Selection、唯一最小课程锚点审查、HumanGate、逐镜头生产计划、成片后二次 Critic 和局部返修。外部 Codex 只实现合同与审计，不选创意、不批准锚点、不决定返修镜头。

## 2. 当前事实与差距

- `video_director.plan_or_repair` 已输出独立短片检查、故事世界、唯一课程锚点和下一步建议。
- `delivery_critic.review(domain="video", stage="course_anchor")` 已有六硬门、签名目标绑定、Rubric 绑定、独立 generator/critic invocation 和媒体 Tool 禁止清单。
- VideoShot 已支持 `shotId`、独立任务、Provider taskId、选定片段和 QA 状态。
- 当前课程锚点 Critic 只形成 Tool Report、PolicyOutcome 与 Observation，没有落成绑定当前创意版本的正式审查记录。
- `video_final_review` 尚无领域硬门、实际成片证据合同和正式审查持久化。
- Main Agent 尚未被明确要求在成片 finding 后只返修目标 shot/track/timeline；结构化 locator 也尚未进入业务 Tool 输入。

## 3. 责任边界

| 主体 | 负责 | 不负责 |
|---|---|---|
| Main Agent | 选择 Director/Critic、消费 Observation、提出换案或局部返修、请求 HumanGate | 自评通过、直接批准、直接调用 Provider |
| Video Director | 独立创意候选、故事机制、唯一最小课程锚点、Beat/Shot/Repair 建议 | 审查自己的方案、写文件、批准 |
| Delivery Critic | 课程锚点六硬门；成片独立创意、锚点漂移、连续性、音字和技术证据审查 | 直接返修、教师批准 |
| 确定性适配器 | 绑定 project/version/digest/stage/rubric，将 finding 转成正式审查与返修目标 | 补造证据、改写 Critic 结论 |
| HumanGate | 批准当前 Concept Selection 和最终视频候选，授权高成本动作 | 替代 Critic |
| Plan/Quality Guard | 未审查、未批准、错版本、无实际媒体证据时阻断下游 | 选择创意 |

## 4. 实施切片

1. 新增视频 Critic 结果适配器，分别处理 `course_anchor` 和 `video_final_review`。
2. 课程锚点正式审查必须保留六硬门、Rubric、generator/critic invocation、目标版本和 digest；pass 只形成待教师批准证据。
3. 成片审查必须绑定 FinalVideoArtifact，并证明读取 MP4、时间线、采样帧、字幕/转写和音轨证据；缺任一类证据时 inconclusive。
4. 成片 finding 只接受 shot、frame_range、track 或 timeline locator；校验 locator 属于当前成片候选。
5. Main Agent 收到 finding 后以 `inputDraft.shotIds`、`trackIds` 或 `timeRanges` 提出最小返修，不重做未受影响镜头。
6. 课程锚点失败时真实媒体 Tool 调用为 0；V1-7 全阶段真实 Provider 调用为 0。

## 5. 非目标

- 不生成新图片、视频或最终包。
- 不在 V1-7 实测真实 Provider。
- 不由外部 Codex 模拟选案或批准。
- 不把 Short Preview 升格为 Full Intro。
- 不重写已有 VideoShot/GenerationJob 执行安全底座。

## 6. 退出标准

- Director 候选只有经过独立课程锚点 Critic 和 HumanGate 后才能进入媒体生产计划。
- 六硬门任一失败或证据不足时媒体 Tool 调用为 0。
- 成片 Critic 缺实际 MP4、时间线、采样帧、字幕/转写或音轨证据时稳定拒绝。
- 成片 finding 能定位到当前 shot、时间范围或轨道，并驱动 Main Agent 局部 Replan。
- 错项目、IntentEpoch、版本、digest、Rubric、generator invocation、locator 或证据集合稳定拒绝。
- 专项、全量、构建、SQLite 和 diff 门禁通过；无 UI 改动时浏览器项明确为不适用。
