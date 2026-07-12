# 03 PPT 生产工艺与质量架构

## 1. 什么才算“好 PPT”

好 PPT 不是“拿到一个可打开的 PPTX”，也不是“每页都很漂亮”。课堂 PPT 至少同时满足八个维度：

1. **教材与事实正确**：知识边界、例题、数字、单位、答案可追溯。
2. **叙事与学习递进**：页面顺序形成问题、观察、操作、概括、练习和回收，不是目录堆叠。
3. **每页有清晰教学动作**：一页只承担一个主要任务，教师知道这一页让学生看什么、想什么、做什么。
4. **视觉服务知识表达**：主视觉承担数量、结构、关系、变化或操作，不是装饰贴纸。
5. **投影可读**：字号、对比度、信息密度、安全区、遮挡和留白适合真实教室。
6. **精确信息可编辑**：文字、数字、公式、题干、答案、表格和关系箭头不烘进 AI 图片。
7. **整套一致但不机械复制**：色盘、材质、光线、机位和构图语言稳定，页型有克制变化。
8. **真实可验收**：PPTX、PDF、逐页 PNG/contact sheet、结构检查和审查报告均可追踪。

## 2. 推荐双路径，而不是唯一固定流水线

### Fast 路径

适合教师要快速草稿、低成本预览或先验证教学内容：

```text
教材证据/需求 → 叙事大纲 → 逐页设计稿 → Fast Coze PPTX → 基础真实性校验 → 教师预览
```

Fast 产物必须记录 `productionPath=ppt_fast_coze`、`qualityTier=preview`、`deliveryEligibility=preview_only`，并明确标记为“快速预览”，不能冒充已经使用批准资产精确组装的精品课件，也不能进入最终材料包。

### Quality/Premium 路径

适合公开课、比赛课、正式交付或教师明确要求高质量：

```text
教材证据与交付 Brief
→ PPT 叙事大纲
→ 整体视觉系统
→ 逐页设计稿
→ 关键样张计划
→ 样张所需资产子集
→ 关键样张组装与渲染
→ 样张质量门
→ 全量资产清单与资产包
→ 可编辑 PPTX 组装
→ PDF/逐页 PNG/contact sheet 渲染
→ Validator + 独立 Critic
→ 问题页/问题资产定向返修
→ 教师批准
```

“样张在资产前”并不意味着无资产生成样张。正确做法是：先生成代表页所需的少量正式资产并使用正式组装方式出样张；样张通过后，才批量生成全量资产。

Quality 产物必须记录 `productionPath=ppt_quality_asset_assembly`。完成 assembly/render/validation/critic 后先成为 `final_candidate`，只有 QualityDecision 与教师决定通过后才成为 `final_eligible`。

## 3. 逐节点工件、门禁和回退

| 阶段 | 必须产出 | 硬门禁 | 失败回退 |
|---|---|---|---|
| 交付 Brief | `PresentationBrief`、`EvidencePackage` | 年级、课题、教学目标、教材边界、用途和产物范围明确；事实有来源 | 缺方向性信息时询问教师；证据不足只能标 draft |
| 叙事大纲 | `PptNarrativeOutline`、稳定 `pageId` | 内容覆盖；每页有明确 page function；顺序形成学习递进；不无证据扩展 | 只改大纲，不进入视觉补丁 |
| 视觉系统 | `PptVisualSystem` | 投影可读、年龄适配、精确信息保持可编辑、整套规则一致 | 风格不成立时保留大纲，重做视觉系统 |
| 逐页设计 | `PptPageDesignSpec[]` | pageId 唯一；每页独立 spec；禁止“第4-8页”范围聚合；`pageSpecCount=narrativePageCount=targetSlideCount` | 只返修问题 pageId |
| 样张计划 | `PptSamplePlan` | 覆盖不同页型和主要视觉风险，不允许只选最容易的页面 | 重新选择代表页 |
| 样张资产 | `PptSampleAssetSubset` | 每项资产有 assetId、用途、页面引用、来源/hash；精确文字数字不进图 | 单资产重试/切 Provider；系统性漂移回视觉系统 |
| 关键样张 | `PptKeySampleSet` | 使用正式组装方式、真实渲染、无乱码/遮挡、同一视觉世界、教学关系清楚 | 风格问题回视觉系统；布局问题回 page design；资产问题回对应 asset |
| 全量资产 | `PptAssetManifest + AssetBundle` | 批量资产与批准样张规则一致；每项有血缘、尺寸、透明策略、hash | 只返修失败资产，系统漂移才回上游 |
| 可编辑组装 | `PptAssemblyPackage + PptxArtifact` | 页数一致；批准资产实际嵌入；精确内容可编辑；无缺图缺字；真实 PPTX | 组装问题按页修复，不临时掩盖设计错误 |
| 渲染 | `PptRenderBundle` | PDF、逐页 PNG、页数完整；全尺寸检查溢出、裁切、重叠、字体替换 | 问题定位到 pageId 和责任节点 |
| 质量审查 | `PptValidationReport + PptCriticReport + PptQualityDecision` | Validator 硬门全过、blocker=0；Critic 使用真实 render，Decision Engine 确定性聚合 | 产生最小返修计划，返回 page/asset/design/assembly |
| 教师批准 | `HumanDecision` | 绑定 productionPath、artifact version、inputHash 和 action；硬门/blocker 不可豁免 | major 仅可被教师接受用于预览/继续迭代，最终交付仍按 policy 判定 |

## 4. PPT Skill 应包含什么

只建立一个可路由 Skill：`edu-ppt-production`。它按阶段组织，不为每个节点另建 Skill。

建议章节：

1. intake 与教材证据判读
2. 叙事大纲与页型策略
3. 视觉系统选择与适用性
4. 逐页设计字段与认知负荷
5. 样张选择、评价和风格锁定
6. 底图/主视觉/透明资产方法
7. 可编辑 PPTX 组装原则
8. render/contact sheet 审查方法
9. 问题分类和返修路由

Main Agent 只读 Skill 摘要；PPT Director 只加载当前阶段章节。完整手册不直接塞入每轮上下文。

## 5. 硬合同与风格 Profile

### 应进入全局硬合同

- 教材事实和精确数字不得无证据编造。
- 每页有稳定且唯一的 `pageId`、明确 page function 和可追溯输入；默认一页一个主要教学任务，复盘/对比/总结页可在给出理由后承载关联任务。
- `pageSpecCount = narrativePageCount = targetSlideCount`，不得用范围合并描述替代逐页设计。
- 关键文字、数字、公式、题干、答案、表格和精确关系保持可编辑。
- 真实 PPTX 和完整 render bundle 才能进入最终质量审查。
- blocker 级缺图、溢出、遮挡、错误事实、页面缺失为零。
- 使用的资产必须是被批准且实际嵌入的资产，不接受“prompt 里提过”。

### 应进入 `ai_illustrated_3d` Profile

- 所有正式视觉都由 AI 生图。
- 立体厚度、材质、接触阴影、遮挡和统一光源。
- clean family 底图策略。
- 禁止本地脚本绘制正式视觉主体。
- 3-4 张样张和 1920×1080 坐标习惯。

这些不是所有 PPT 的普遍真理。照片型科学课、语言阅读、品牌模板、板书型、数据图表型课件可以选其他 Profile。样张数量建议按风险自适应为 2-4 页；布局字段使用归一化区域或语义锚点，避免把单一分辨率写成永久合同。

## 6. 质量量表

建议总分 100：

| 维度 | 权重 | 评价重点 |
|---|---:|---|
| 教材与事实 | 25 | 结论、数字、单位、例题、知识边界、来源 |
| 叙事与学习递进 | 15 | 页面顺序、问题链、课堂节奏、前后照应 |
| 页面聚焦与认知负荷 | 10 | 一页一主要任务、信息密度、分段呈现 |
| 视觉服务知识 | 15 | 图片是否表达结构/关系/变化，而非装饰 |
| 视觉一致性 | 10 | 色盘、材质、光线、角色、构图语言 |
| 可读性与无障碍 | 10 | 投影字号、对比度、安全区、非仅颜色编码 |
| 可编辑与技术完整 | 10 | 文字/公式可编辑、页数、缺图、字体、文件结构 |
| 课堂可操作性 | 5 | 教师提示、互动时机、答案揭示与操作节奏 |

建议决策：

- `pass`：ValidationReport 全过；Critic 总分 >= 85；无 blocker；任何维度不得低于 70。
- `repair`：75-84，或存在可定位 major；按问题页返修。
- `block`：< 75，或任一确定性硬门/blocker 失败。

总分不能抵消硬失败。数学错误、不可打开、缺页、主要文字烘进图、严重遮挡和错误资产血缘都必须阻断。

## 7. 当前代码差距与优化点

| 当前事实 | 为什么影响交付 | 定向优化 |
|---|---|---|
| `ppt_outline → ppt_design → coze_ppt → image_asset` | PPTX 在资产前生成，后生成图片无法进入已完成课件 | 保留 fast Coze；新增 quality asset-first 子图 |
| 大纲工具只要求 requirement_spec | 与默认图中“PPT 大纲依赖教案”不一致 | 统一 stage graph 权威源；quality 路径要求教材证据/教案 |
| taskGuidance 只要求底图/元素/文字/排版 | 缺教学动作、视觉事件、资产作用、准确文字层 | Skill + 结构化 PageDesignSpec；ContractValidator 真执行 |
| PPT design validator 只查页码和四层标签 | 结构合格不等于教学和视觉可执行 | 增加 schema validator、页级硬门和 rubric |
| Coze 只接文本设计稿 | 无法证明使用了批准样张/资产 | Coze 限定 fast；高质量路径用 PptxGenJS/OOXML composer 消费 AssetManifest |
| 图片工具一次只生成一张低质量方图 | 不能形成背景组、主视觉和透明资产包 | 资产 Tool 支持 assetId 批次、比例、透明策略、逐项结果 |
| 无 render/contact sheet | 不能检查真实视觉、溢出和整体节奏 | 增加 render Tool、RenderBundle、Validator/Critic |
| QualityGate 仅 bool + string[] | 无页级证据、严重度和回退节点 | 拆成 ValidationReport、CriticReport、QualityDecision，不把分数塞回 Tool 简单布尔值 |
| 本地 PptxGenJS builder 是最小文本导出 | 可打开但不是正式精品组装 | 另建结构化 composer，不在旧最小导出上层层补丁 |

## 8. 返修路由

| 问题 | 返回节点 | 最小动作 |
|---|---|---|
| 知识错误/页面顺序错误 | Narrative Outline / Evidence | 修事实或页面任务，不先改视觉 |
| 整套像不同 AI 海报 | Visual System / Samples | 锁色盘、材质、光线、机位，再重做漂移页 |
| 单页布局拥挤 | Page Design / Assembly | 调整问题 pageId 的区域和层级 |
| 单资产错误或贴纸感 | Asset | 只重做 assetId，保留其他资产 |
| 字体溢出、元素遮挡 | Assembly | 只修问题 pageId 的可编辑层/位置 |
| 精确文字烘进图片 | Asset + Assembly | 清除图片文字，改为可编辑层 |
| PPTX 结构/字体/缺图 | Composer/Render | 修技术组装，不回到叙事重做 |

## 9. PPT 侧 releasePriority=P0 验收标准

在扩大自动化前，至少证明：

1. 一套 10 页 quality 路径能产生 pageId、样张、资产 manifest、PPTX、PDF、10 张 PNG 和质量报告。
2. Validator 对 `pageId` 重复、缺页、`第4-8页` 范围合并、pageSpecCount 与 slideCount 不一致均能稳定失败。
3. PPTX 中选定资产确实嵌入，精确文本可编辑。
4. Validator 能故意抓到溢出、缺图、错误字体和不可编辑关键文本。
5. Critic 能把问题定位到 pageId/assetId/责任节点，但不能改写 Validator 结果。
6. 修一页不会重做整套，也不会覆盖上一选定/批准版本。
7. Fast Coze 产物在 FinalDeliveryGate 被机器判定为 `preview_only`。
