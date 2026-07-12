# V1 Stage 3A：PPT 工艺合同与页级返修底座计划

日期：2026-07-12

状态：accepted / implementation in progress

关联需求：`RQ-024 PPT Quality 纵向闭环`

## 1. 目标

把当前 `ppt_outline -> ppt_design -> coze_ppt` 的 Markdown 三段式升级为可执行、可验证、可局部返修的 PPT 质量设计底座，但本阶段不冒充已完成真实精品 PPTX。

本阶段完成后，系统能够确定性回答：

1. 教材/课程证据是否足够支撑当前 PPT 设计。
2. 叙事大纲是否逐页、连续、覆盖已批准目标并具有稳定 pageId。
3. 每个 PageSpec 是否明确教学动作、学生动作、主视觉、可编辑数学层、布局、备注和验收条件。
4. 样张计划是否覆盖主要页型和高风险页面，而不是只选最容易的页面。
5. 修改某个 pageId、assetId 或上游叙事后，哪些下游单元必须失效和返修。

## 2. 现状证据

当前源码事实：

- `ppt_outline` 只要求 `requirement_spec`，与公开课质量路径需要教案/教材证据不一致。
- `AgentArtifactDraft` 和 OpenAI Runtime 只运输 Markdown，没有结构化 PageSpec 输出边界。
- `ppt_design` 只用 `validatePptDesignDraftForCoze` 检查页码和“底图/元素/文字/排版”标签。
- 确定性 PPT 大纲仍包含“第 2-3 页”“第 4-8 页”“第 9-12 页”范围聚合。
- Coze 只消费文本设计稿，不能证明批准样张和正式资产真实进入 PPTX。
- `artifact-pptx.ts` 是最小文本导出，不是质量路径 composer。
- 已有 Stage 2 Runtime Contract、ValidationReport、QualityDecision、AgentObservation、TargetLocator 和页级 repair 路由可复用。

## 3. 参考与适配

本阶段采用：

- 用户提供并已迁入项目的 PPT V8 手册及 PPT 生产工艺设计。
- `textbook-ppt-workflow` 的 `analysis -> design -> key_samples -> backgrounds -> assets -> assembly -> final_qa` 业务纪律。
- 已迁入 `page-spec.schema.json`、PPT Director Prompt、PPT Critic Prompt 和相关实验结论。
- 当前项目的 Artifact、ToolRouter、Runtime Contract、ValidationReport 和 ReAct 持久化边界。

适配原则：

- 七阶段是 PPT 专业 Tool 内部工艺，不扩成教师可见的固定全局 DAG。
- Main Agent 可从已有合格 Artifact 切入；硬前置缺失时只补最小必要输入。
- `analysis/design/key_samples` 映射到结构化 Artifact 内容和批准记录，不在顶层新增大量 WorkflowNode。
- AI 场景、AI 素材、可编辑数学层职责进入类型和 validator；视觉风格细节保留在 Profile/Skill，不写死为全局唯一风格。

## 4. 子阶段

### 3A-1 结构化合同

新增纯领域模块，定义并验证：

- `PresentationBrief`
- `EvidenceBinding`
- `PptNarrativeOutline`
- `PptVisualSystem`
- `PptPageSpec`
- `PptSamplePlan`
- `PptDesignPackage`

`PptDesignPackage` 固定 `schemaVersion=ppt-design-package.v1`、`productionPath=ppt_quality_asset_assembly`。每页使用稳定 `pageId=page_XX`，禁止范围页描述。

### 3A-2 硬门

- evidenceRefs 非空且引用已批准输入。
- targetSlideCount、narrative page count、PageSpec count 相等。
- pageNumber 从 1 连续到 N；pageId 唯一且与页码稳定对应。
- 每个已批准 objective 至少被一页覆盖。
- 每页只有一个主要 narrative job 和 teaching action。
- `AI_SCENE`、`AI_ASSET`、`EDITABLE_MATH` 三层责任明确。
- 精确数字、公式、题干、答案、数量关系不得进入 AI 图层。
- 每页有 presenter note、reading order、布局安全区和 acceptance checks。
- 样张覆盖至少两个不同页面轮廓，并包含一个高风险页；建议 2-4 页。

### 3A-3 页级影响分析

输入教师修改位置和当前 package，输出：

- `repair_unit`：只失效目标 pageId/assetId 及必要邻页。
- `repair_upstream`：叙事、目标或证据变化时失效对应下游页面、样张批准和报告。
- 保留未受影响 pageId、资产和批准版本，不整套重跑。

## 5. 代码边界

预计新增：

```text
src\server\ppt-quality\ppt-quality-types.ts
src\server\ppt-quality\ppt-design-validator.ts
src\server\ppt-quality\ppt-impact-analysis.ts
tests\ppt-quality-design-contract.test.ts
tests\ppt-page-repair-impact.test.ts
```

预计修改：

```text
src\server\agent-runtime\types.ts
src\server\agent-runtime\openai-runtime.ts
src\server\agent-runtime\task-guidance.ts
src\server\capabilities\capability-runner.ts
src\server\contracts\contract-validator.ts
```

修改模型运输层前必须保持非 PPT 任务兼容。现有 `coze_ppt` 明确保留为 Fast/Preview 路径，不得因 3A 合同完成就标记为 `final_eligible`。

## 6. 非目标

- 不在 3A 调用真实生图或 PPTX Provider。
- 不生成或交付所谓“精品 PPTX”。
- 不在旧最小文本 builder 上堆视觉补丁。
- 不实现完整资产批次、PPT composer、PDF/PNG render 或多模态 Critic；这些属于 3B/3C。
- 不把手册全文塞入 Main Agent 每轮上下文。

## 7. 风险与回退

| 风险 | 控制 |
|---|---|
| 合同过严限制创意 | 只硬约束事实、页级完整性、可编辑性、来源和验收；视觉表达通过枚举 + 自由 brief/profile 保留空间 |
| 新结构破坏旧 Markdown 路径 | structuredContent 为加法式运输；非 PPT 任务不变；Fast 路径显式 preview_only |
| 把专业阶段做成全局 DAG | 专业阶段封装在 PPT Tool/Artifact 内，Main Agent 只看当前事实和可选动作 |
| 一改就整套失效 | 影响分析以 pageId/assetId 为最小单位；只有目标/证据/叙事结构变化才上溯 |
| 结构通过但效果差 | 3A 只证明可执行设计；真实效果必须由 3C render + Delivery Critic 证明 |

## 8. 完成标准

- 3A 测试计划全部通过。
- 合法 12 页 package 通过；重复 pageId、范围合并、缺页、目标未覆盖、数学烘图、样张只选简单页均稳定失败。
- 页面局部修改只返回目标页和必要邻页；叙事上游修改使对应批准/报告失效。
- OpenAI Runtime 能运输结构化 PPT 输出且不影响其他任务。
- `npm test`、`npm run build`、独立 SQLite 初始化和 `git diff --check` 通过。

## 9. 后续阶段

```text
3B：关键样张、正式资产、来源 manifest 与 HumanGate
3C：可编辑 composer、PDF/PNG/contact sheet、Delivery Critic、页级返修和真实 12 页试点
```
