# V1.2 阶段QA需求

日期：2026-07-13

状态：accepted；V1.1发布后进入实施规划

关联需求：RQ-023、RQ-024、RQ-025、RQ-028、RQ-032、RQ-034

## 1. 目标

每个主要生产阶段完成候选产物后，由独立质量审查智能体执行一次阶段QA；发现明确问题时，由Main Agent进行一次定点返修并让同一阶段重新检查。前端持续展示QA计划、当前检查、发现、返修和阶段结论。

V1.2解决“阶段完成是否真的合格、教师能否看见检查过程”的问题，不实现持续多轮自动优化或高积分深度审校套餐。

## 2. 版本边界

### V1.2包含

- 每个主要阶段的一次确定性Validator和一次独立语义QA。
- 有明确locator的单轮定点返修与一次复验。
- QA计划、报告、决定、返修和前端事件的持久化与恢复。
- 桌面和390px的阶段QA清单、活动流和状态展示。
- PPT/视频现有Critic复用，以及Brief/教案和最终包QA补齐。

### V1.2不包含

- 多个Critic并行投票或对抗审查。
- 同一finding持续多轮自动返修直到通过。
- 深度审校套餐、额外积分档位和自动模型升级。
- 在教师输入框中自动填写或发送“请全面审查”。
- 绕过HumanGate、预算、真实Provider授权或教师已批准意图。

上述能力统一记录在RQ-033，只有V2.0之后才重新评估。

## 3. 角色边界

| 角色 | 职责 | 不允许 |
|---|---|---|
| Main Agent | 创建StageQAPlan、调用Reviewer、分析finding、生成RepairPlan和Replan | 不能用自评替代独立QA |
| Deterministic Validator | 检查文件、页数、hash、版本、血缘和证据 | 不评价审美、教学效果和叙事 |
| Quality Reviewer | 按阶段Rubric输出结构化QAReport | 不能执行写Tool、修改产物或批准自己审查的对象 |
| Quality Policy | 将Validator与QAReport落成pass/repair/block | 不能因模型措辞放宽硬门 |
| HumanGate | 批准范围变化、真实高成本动作和上游意图修改 | 不能由系统静默代替 |

质量Reviewer优先复用当前`delivery_critic.review`边界，并保证独立Executor、独立上下文、当前目标digest和rubricVersion绑定。

## 4. 阶段流程

```text
阶段候选产物完成
        ↓
确定性Validator
        ↓
独立Stage QA
        ↓
QualityDecision
   ├─ pass   -> 阶段完成，允许进入下一阶段
   ├─ repair -> Main Agent影响分析 -> 定点返修 -> 一次复验
   └─ block  -> 暂停并说明缺口/请求教师决定
```

- QA发现问题后只返回finding和证据，不直接修改。
- Main Agent先做影响分析，再决定`repair_unit`或`repair_upstream`。
- 返修后只复验该finding和受影响的阶段合同，不无差别重跑整包。
- 一次返修复验仍未通过时，阶段状态进入`blocked`或`needs_teacher`，不继续自动循环。

## 5. 阶段清单

| 阶段 | QA重点 | 定点返修单位 |
|---|---|---|
| Brief/课程目标 | 教材边界、教师意图、受众和交付范围 | Brief字段或上游意图 |
| 教案 | 目标、学情、活动、评价和可执行性 | sectionId |
| PPT叙事/PageSpec | 每页作用、教学动作、信息负荷和视觉逻辑 | pageId/specId |
| 关键样张 | D/V/P、风格、来源、可读性 | sampleId/pageId/assetId |
| 完整PPT | 页数、可编辑性、页级质量和节奏 | pageId/assetId |
| 视频创意/课程锚点 | 独立创意、唯一回接、不泄露答案 | conceptId/anchorId |
| 分镜/成片 | 镜头意图、连续性、字幕、音轨和时间线 | shotId/track/timeRange |
| 最终包 | 版本一致、ClassroomRunSpec、manifest和真实文件 | artifact版本或package成员 |

Blocker和Major问题未关闭时不得进入高成本下游或final_eligible。

## 6. 数据合同

最小持久化对象：

```text
StageQAPlan
  projectId / intentEpoch / planId / revision / stage
  target artifactId / version / digest
  checklist / rubricVersion / reviewerSource

QAReport
  reportId / planId / findings / evidenceRefs / recommendation

RepairPlan
  findingIds / repairTargets / impactDigest / expectedVersions

QAEvent
  sequence / eventType / status / teacherText / evidenceRefs / createdAt
```

所有对象必须绑定当前IntentEpoch和产物digest；旧计划、旧版本或迟到报告只能保留审计，不能推进当前阶段。

## 7. 前端展示

阶段生产完成后，当前制作计划中插入一个阶段QA子计划：

```text
正在进行PPT阶段检查
● 检查12页结构和完整性
○ 检查教学内容与页面作用
○ 检查视觉可读性和节奏
○ 汇总问题并决定是否返修
```

状态语义：

- 绿色：检查通过。
- 蓝色：正在检查。
- 灰色：等待检查。
- 琥珀：发现可返修问题或等待教师确认。
- 红色：阻塞，不能进入下一阶段。

颜色必须同时提供文字、图标和ARIA状态。当前QA完整显示，已完成QA折叠为“阶段检查通过 · 4项”；点击后查看finding和证据摘要。

活动流使用教师语言：

```text
正在检查PPT页面结构
已确认12页完整；发现第6页文字偏多
已定位为第6页局部问题
正在返修第6页
第6页复验通过，PPT阶段检查完成
```

不得展示模型思维链、原始Prompt、命令、API、Provider、路径和调试日志。

## 8. 打断与恢复

- 教师可以自然语言暂停、查看问题、修改要求或取消返修。
- QA等待、返修和复验期间输入框始终可用。
- 教师修改上游意图后，旧QA计划退出活动状态，新revision重新建立QA目标。
- 刷新、重新进入项目和服务重启后，QA清单、当前项、findings和阶段结论恢复一致。
- 两个教师在不同项目中的QA计划、报告、事件和返修产物完全隔离。

## 9. 验收标准

1. 每个主要阶段都有独立Reviewer来源、当前目标digest、Rubric和QAReport。
2. Validator与Reviewer职责分离，Reviewer不能直接执行写Tool或批准产物。
3. QA pass后才能将阶段标记完成；Major/Blocker未关闭时不能进入高成本下游。
4. finding具有locator、severity、responsibleStage、evidence和minimalFix。
5. Main Agent只返修受影响单位；未受影响且血缘合法的产物继续复用。
6. V1.2最多执行一次定点返修复验；仍不通过时暂停，不持续自动循环。
7. 前端QA清单和活动流由真实持久化事件驱动，不使用定时器或模型自由文本伪造。
8. 桌面与390px均能查看当前QA、已完成QA、finding、等待确认和阻塞状态，输入不被遮挡。
9. 刷新、重启、Replan和双用户并发后QA状态准确恢复且完全隔离。
10. V1.2不出现深度审校套餐、额外积分模式或静默模型升级。
