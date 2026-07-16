# ShanHaiEdu V1-6 PPT 产品内编排闭环计划

更新时间：2026-07-13

状态：`done`

## 1. 目标

复用现有 PPT Quality 生产工具，让产品内部 Main Agent 在受控 ReAct 中自主完成：逐页四层设计、风险样张、独立 Critic 审查、教师样张批准、全量资产、可编辑组装、整套渲染审查和页级返修。外部 Codex 只实现与审计，不选择样张、不批准样张、不决定返修页。

## 2. 当前事实与差距

- 已有 `ppt_director.plan_or_repair`、`delivery_critic.review` 和五个 PPT Quality 业务 Tool。
- 已有 PageSpec、样张候选、正式资产 manifest、可编辑 PPTX、PDF/PNG 渲染证据和页级返修实现。
- Provider adapter 已阻止未批准样张进入全量生产。
- Main Agent 已能在业务 Tool 后 Observe/Replan。
- 当前缺口是 PPT Critic 报告只留在 Agent Tool Report/Observation，尚未确定性落成样张或整套正式审查记录；因此产品内 Critic 证据与教师批准、全量 Guard、页级返修之间没有闭环。

## 3. 责任边界

| 主体 | 负责 | 不负责 |
|---|---|---|
| Main Agent | 判断阶段、调用 Director/Critic、提出业务 Tool、消费 Observation、选择返修或停等教师 | 直接写文件、伪造审查通过、批准样张 |
| PPT Director | 叙事、视觉、PageSpec、风险页和定点返修计划 | 生图、组装、最终批准 |
| Delivery Critic | 读取实际候选与渲染证据，输出 finding、locator、责任阶段和最小修复 | 教师批准、直接执行返修 |
| 确定性适配器 | 校验 Critic 目标绑定，将 Critic 输出转换为逐页 D/V/P 或 D/V/P/R 审查记录 | 改写 Critic 结论、补造证据 |
| HumanGate | 教师批准样张和最终 PPT，授权高成本业务 Tool | 替代质量审查 |
| Quality/Plan Guard | 未审查、未批准、错版本或错血缘时阻断下游 | 决定视觉创意 |

## 4. 实施切片

1. 新增 PPT Critic 结果适配器，严格绑定 artifactId、version、digest、stage 和 page locator。
2. 在 Agent Tool 成功持久化路径中接入适配器，生成 `reviewSource=critic` 的样张或整套审查版本。
3. Critic pass 只形成等待教师批准的审查证据；不得自动 `approveArtifact`。
4. Critic rework/blocked 将 finding 精确映射到页面，并让 Main Agent Replan 到 `ppt_page_repair` 或上游修复。
5. 强化 Main Agent PPT 指令：样张通过后停等教师；教师批准后才允许全量；整套 finding 只返修 locator 页面。
6. 用脚本化 Main Agent、Fake Agent Tool Executor 和确定性媒体夹具证明全链路归因，不调用真实 Provider。

## 5. 非目标

- 不生成新的真实 PPTX 或真实图片。
- 不让外部 Codex 模拟样张批准或返修决策。
- 不修改 V1-7 视频课程锚点逻辑。
- 不把 Coze Fast 路径冒充 PPT Quality 路径。

## 6. 退出标准

- Main Agent 自主调用 Director 与 Critic，业务 Tool 后有 Observation/Replan 证据。
- 样张 Critic 通过后仍停在教师批准门；未批准时全量 Tool 调用为 0。
- 教师批准后 Main Agent 可继续全量资产与组装。
- 整套 Critic finding 精确映射 pageId，返修 Tool 只接收目标页。
- 错项目、旧版本、错 digest、无页面 locator 和结构不完整的 Critic 输出稳定拒绝。
- 专项、全量、构建、SQLite 2/2、桌面和 390px 关键流程通过。
