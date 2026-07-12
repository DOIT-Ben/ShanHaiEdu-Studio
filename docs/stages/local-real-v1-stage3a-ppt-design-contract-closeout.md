# ShanHaiEdu V1 Stage 3A PPT 工艺合同与页级返修底座收尾

日期：2026-07-12

状态：完成

关联需求：`RQ-024`；本阶段只关闭结构化设计与返修底座，`RQ-024` 继续保持 `in_progress`

## 1. 阶段结论

Stage 3A 已把旧的 PPT 四层 Markdown 设计稿升级为可运输、可验证、可定位返修的 `PptDesignPackage`：

- `PptDesignPackage` 固定 `schemaVersion=ppt-design-package.v1` 和 `productionPath=ppt_quality_asset_assembly`。
- 每页使用连续稳定的 `pageId=page_XX`，禁止把“第 4-8 页”合并成一个 PageSpec。
- 教材证据、教学目标、累计叙事、视觉系统、逐页设计和样张计划形成同一结构包。
- AI 场景、AI 素材、可编辑文字和可编辑数学层职责分离，精确数字、公式、题干和答案不得烘入生成图层。
- PageSpec 强制教学动作、学生动作、主视觉、文字预算、布局安全区、阅读顺序、替代文本、非纯颜色编码、媒体无障碍、教师备注和验收条件。
- 单页、资产、相邻叙事、教学目标和教材证据修改能够返回局部或上游影响集，并保持稳定 impact digest。
- OpenAI Runtime 使用 strict 外层响应，将复杂设计包作为 `structuredContentJson` 运输；服务端解析并通过正式领域 validator 后才进入 `AgentArtifactDraft.structuredContent`。
- CapabilityRunner 保留领域结构包并叠加运行元数据；ToolRouter PostValidator 在持久化前拦截缺包、无效包和 deterministic PPT 预览草稿。
- Fast/Coze 旧路径仍是 preview 路径；本阶段没有把 Markdown、目标页数、文件名或 deterministic 草稿冒充真实精品 PPTX。

## 2. 主要实现

| 区域 | 实现 |
|---|---|
| PPT 领域合同 | `PresentationBrief`、`EvidenceBinding`、`PptNarrativeOutline`、`PptVisualSystem`、`PptPageSpec`、`PptSamplePlan`、`PptDesignPackage` |
| 确定性 validator | 页数一致性、连续 pageId、目标覆盖、证据绑定、AI/可编辑层边界、样张风险覆盖、无障碍语义 |
| 页级返修 | page/asset/相邻叙事的 `repair_unit`；目标/证据变化的 `repair_upstream`；稳定影响摘要 |
| 模型运输 | strict 外层 JSON、`structuredContentJson`、嵌套合同与关键不变量提示、服务端 JSON 解析和领域校验 |
| Artifact 运输 | `AgentArtifactDraft.structuredContent` 进入 CapabilityRunner，并与不可伪造的运行元数据合并 |
| PostValidator | `ppt_quality_generation_mode`、`ppt_design_package` 和逐 issue 定位 gate；失败结果不保存 Artifact |
| 兼容边界 | 非 PPT Markdown 任务保持兼容；deterministic PPT 仅允许 preview，不满足质量合同 |

## 3. 验收矩阵

| ID | 结果 | 证据 |
|---|---|---|
| 3A-01 | 通过 | 完整 12 页 package 通过 schema、证据、目标、页码、三层责任、无障碍和样张门 |
| 3A-02 | 通过 | 重复 pageId、页码不连续返回 page locator |
| 3A-03 | 通过 | 范围合并页稳定拒绝 |
| 3A-04 | 通过 | brief、narrative、PageSpec 页数不一致稳定拒绝 |
| 3A-05 | 通过 | 未覆盖 objective 返回上游叙事问题 |
| 3A-06 | 通过 | AI scene/asset 烘入文字或精确数学内容稳定拒绝 |
| 3A-07 | 通过 | 教学动作、学生动作、备注、验收项或无障碍语义缺失稳定拒绝 |
| 3A-08 | 通过 | 样张只选简单同类页或缺高风险页稳定拒绝 |
| 3A-09 | 通过 | 单页文字/布局只失效目标 pageId |
| 3A-10 | 通过 | 单资产修改只失效 assetId、所属页面和相关样张 |
| 3A-11 | 通过 | 叙事转折只影响目标页及必要邻页 |
| 3A-12 | 通过 | 目标或证据变化返回 `repair_upstream` 并失效受影响批准/报告 |
| 3A-13 | 通过 | 相同 revision 输入得到稳定影响集与 digest |
| 3A-14 | 通过 | OpenAI PPT Director 结构包完整进入 ArtifactDraft，Artifact hash 稳定 |
| 3A-15 | 通过 | 缺包或无效包由 Runtime/PostValidator 拒绝，ToolRouter 返回 `artifactCreated=false` |
| 3A-16 | 通过 | 非 PPT Runtime 保持 Markdown 兼容，全量测试通过 |
| 3A-17 | 通过 | deterministic PPT 草稿命中 preview-only gate，不能进入质量生产链 |

## 4. 新鲜验证

```text
Stage 3A 重点专项
6 files / 78 tests passed

npm test
Node 259/259 passed
Vitest 573/573 passed

npm run build
Next.js production build exit 0
TypeScript passed
13 static pages generated

npm run db:init
连续初始化 2/2 exit 0

git diff --check
exit 0
```

## 5. 未关闭边界

- 本阶段没有调用真实生图、PPTX 或付费模型 Provider，也没有生成真实精品 PPTX。
- 尚未实现关键样张批准、正式资产批次、来源 manifest、参考图实传证明和 HumanGate；这些属于 Stage 3B。
- 尚未实现质量 composer、真实可编辑 PPTX、PDF/逐页 PNG/contact sheet、render evidence、Delivery Critic 和自动页级返修；这些属于 Stage 3C。
- `RQ-024` 仍为 `in_progress`；只有真实 12 页试点、真实资产、渲染审查和教师签收完成后才允许关闭。
- 未提交、未 push、未部署，既有 `v1` 标签未移动。

## 6. 下一阶段

```text
V1 Stage 3B：关键样张、正式资产、来源 manifest 与 HumanGate
```

3B 必须证明批准样张和正式资产真实存在、来源可追踪、参考资产真实进入对应 Provider 请求，并保持 pageId/assetId 级版本与局部失效；不得提前在旧文本 PPTX builder 上堆视觉补丁。
