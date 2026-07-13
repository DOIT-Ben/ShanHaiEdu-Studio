# ShanHaiEdu V1-6 PPT 产品内编排闭环收尾

更新时间：2026-07-13

状态：`done`

## 1. 完成内容

- Main Agent 的 PPT 主线明确为逐页四层设计、风险样张、独立 Critic、教师批准、全量资产、可编辑组装、整套审查与页级返修。
- `delivery_critic.review(domain="ppt")` 的结构化报告可确定性落成正式样张或整套审查版本。
- Critic 目标严格绑定项目、IntentEpoch、artifactId、version、kind 与 digest；错阶段、错定位、缺维度和越界页面稳定拒绝。
- Critic pass 只形成质量证据，不调用 `approveArtifact`；教师批准权继续由 HumanGate 持有。
- Critic rework/blocked 必须带页面 locator 和质量维度，Main Agent 可据此只提出目标页返修。
- `toolPlan.inputDraft.pageIds` 已贯通 ConversationTurnService、ToolRouter 与 PackageToolAdapter；结构化页码优先于旧文本解析，并校验格式、去重、排序和候选页范围。
- Critic 证据适配失败时保存 Tool Report 与 inconclusive Observation，阻断下游并返回教师可理解说明。

## 2. 验证证据

| 门禁 | 结果 |
|---|---|
| V1-6 专项 | 7 文件，71/71 通过 |
| TypeScript | `npx tsc --noEmit --pretty false` exit 0 |
| Node | 259/259 通过 |
| Vitest | 完整套件通过；新增 5 个 V1-6 回归用例 |
| 生产构建 | exit 0，13 个静态页面；保留 4 条既有动态文件追踪性能警告 |
| SQLite | `npm test` 使用隔离 `.tmp\test-workbench.db` 初始化并完成全量持久化测试 |
| diff | `git diff --check` exit 0 |
| 浏览器 | 本阶段无 UI 改动，不适用；未把未执行项记录为通过 |

## 3. 关键边界

- 未调用真实图片、PPT 或视频 Provider，未生成新真实交付包。
- 外部 Codex 没有选择样张、批准样张或决定返修页面；这些权限分别归属产品 Main Agent、Critic、HumanGate 与确定性 Guard。
- V1-6 证明的是产品内 PPT 编排与证据闭环，不等于 V1-9 真实交付效果验收。
- 兼容旧入口时仍允许从教师文本解析“第 N 页”；Main Agent 新路径必须使用结构化 `inputDraft.pageIds`。
- 构建警告来自既有 artifact storage 与 feedback storage 动态路径，本阶段未修改对应模块。

## 4. 下一阶段

进入 V1-7 视频产品内编排闭环：接入 Concept Selection、独立创意课程锚点六硬门、成片后二次 Critic，以及 shot/时间范围级定点返修。继续使用确定性夹具与历史证据，不在 V1-9 前调用真实媒体 Provider。
