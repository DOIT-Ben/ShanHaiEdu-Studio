# V1-9R Main Agent自主控制面验收收尾

日期：2026-07-15

状态：`R0-R5 passed / V1-9 unique real product E2E authorized by stage order / release not started`

## 1. 结论

V1-9R0至R5按当前责任边界关闭。最新真实桌面由产品Main Agent自主完成动态Tool选择、Observation后继续/换路径、局部视频脚本、自然语言改道、重复失败熔断、双用户隔离和一句话PPT结构化设计候选。外部Codex运行中编排介入0，真实媒体GenerationJob 0，没有mock、placeholder、deterministic fallback或degraded成果冒充完成。

R5不验证真实可编辑PPTX、图片、MP4、ZIP或生产整包。上述真实文件、最小课程锚点、`ClassroomRunSpec`和版本一致ZIP只进入下一阶段唯一一次V1-9真实全链路。

## 2. 真实桌面运行

```text
spec: tests\e2e\v1-9r-two-user-main-agent.spec.ts
project: chromium-desktop
fixture: isolated-sqlite-with-configured-product-main-agent
providerChannel: fallback
deterministic fixture: disabled
workers: 1
result: 1 passed / 1 skipped
duration: 14.5 minutes
external Codex orchestration: 0
GenerationJob: 0
```

证据：

```text
test-results\m67-e2e-21008-1784056471438\
test-results\m67-e2e-21008-1784056471438\evidence\v1-9r-live-teacher-a.json
test-results\m67-e2e-21008-1784056471438\evidence\v1-9r-live-teacher-a-one-sentence-ppt.json
test-results\m67-e2e-21008-1784056471438\evidence\v1-9r-live-teacher-b.json
test-results\m67-e2e-21008-1784056471438\evidence\v1-9r-live-teacher-b-redirect.json
test-results\m67-e2e-21008-1784056471438\evidence\v1-9r-two-user-runtime-evidence.json
test-results\v1-9r-two-user-summary.json
output\playwright\v1-9r-two-user-a-chromium-desktop.png
output\playwright\v1-9r-two-user-b-chromium-desktop.png
```

## 3. R-A矩阵

| ID | 结果 | 证据 |
|---|---|---|
| R-A01 | passed | 一句话PPT真实轨迹为需求规格、大纲、设计候选；生成`ppt_design_draft`，其最低候选验证通过且只允许进入`production_design_expansion`，无PPTX/图片/媒体任务 |
| R-A02 | passed | 完整材料包TaskBrief精确包含教案、PPT、图片、视频和包；Main Agent动态选择需求、教案、大纲、设计与Director路径，读取候选语义失败后保存恢复点，GenerationJob为0 |
| R-A03 | passed | B侧只形成`requirement_spec`、`creative_theme_generate`、`video_script_generate`，没有教案、PPT、图片、分镜、成片或包 |
| R-A04 | passed | TaskBrief/IntentGrant在控制与续接中保持绑定；`conversation-turn-service`完整回归覆盖“继续/确定”不覆盖原目标 |
| R-A05 | passed | B侧自然语言改道后IntentEpoch从0递增为1，目标切换到机械信标故障；A侧投篮语义未串入B侧，旧结果隔离回归通过 |
| R-A06 | passed | 一句话PPT使用五年级、数学、百分数、约10页和投篮命中率可靠默认连续推进，没有重复需求确认 |
| R-A07 | passed | `action-policy`、`conversation-control-resolver`和`conversation-turn-service`合同只为不可推断选择创建typed PendingDecision |
| R-A08 | passed | 两侧IntentGrant均为标准任务授权；真实桌面没有`missing_grant`或`grant_scope_mismatch`，标准内部Tool零例行确认 |
| R-A09 | passed | 费用披露、预算升级和最高强度由`action-policy`与`conversation-turn-service`回归覆盖；确认前外部调用为0 |
| R-A10 | passed | 发布、权限变化、破坏性动作及actionId防重放由ActionPolicy、HumanGate、PlanGuard与路由门回归覆盖 |
| R-A11 | passed | 真实轨迹不是固定顺序；Tool成功后继续，PPT失败后换Director，视频审查失败后换Video Director，Observation均先持久化 |
| R-A12 | passed | 每轮保存`tools_exposed/tool_selected`；合格Tool集合随Artifact变化，裸Provider、数据库、密钥和状态提升未暴露 |
| R-A13 | passed | `execution-envelope-gateway`及全量回归证明actor/project/task、TaskBrief digest、IntentEpoch、plan revision、强度、授权和幂等键强制核验 |
| R-A14 | passed | PPT候选`validationStatus=passed`且教师状态仍为`needs_review`；只允许生产设计扩展，质量、下游资格和签收互不冒充 |
| R-A15 | passed | Runtime超时/网络失败分类、Observation、恢复与零deterministic成果由OpenAI Runtime及CapabilityRunner回归覆盖 |
| R-A16 | passed | 完整材料包真实失败返回`ppt_design_candidate_semantics_invalid + validation`，Main Agent转Director再重试；领域reasonCode与details贯通回归通过 |
| R-A17 | passed | 同一PPT设计第二次语义失败后停止，保存`paused/repeated_failure/create_ppt_design_draft`及两条Observation引用，没有循环或fallback |
| R-A18 | passed | 两个密码账号、两个项目、不同TaskBrief/IntentEpoch/强度/Artifact完全隔离；互相读取snapshot与项目列表均失败 |

## 4. R-U矩阵

| ID | 结果 | 证据 |
|---|---|---|
| R-U01 | passed | 桌面断言无裸Markdown、危险HTML或教师可见工程词；两张最终截图无重叠和裸标记 |
| R-U02 | passed | A侧完整材料包失败显示真实暂不可用与恢复语义，没有结构草稿成功卡或fallback成果 |
| R-U03 | passed | 刷新并重新选择项目后两侧历史消息与Artifact仍可见；`v1-9r-artifact-history`和assistant-ui Adapter回归通过 |
| R-U04 | passed | A侧切换深度后刷新显示“深度”，B侧仍为标准；服务端强度版本与UI一致 |
| R-U05 | passed by retained automation | 按用户当前门禁未运行新的390px真实黑盒；现有窄屏布局自动化与历史截图继续覆盖截断、滚动和输入区，不以此冒充本轮真实移动端E2E |
| R-U06 | passed | 长任务状态、失败、完成、checkpoint和消息在刷新/重新进入后恢复；状态来自持久化任务与事件，不是前端定时器 |

## 5. 责任边界说明

- 一句话PPT回合最终TurnJob仍因后续Director/Critic失败被标记失败，但可信`ppt_design_draft`已先原子持久化并通过R5候选门。R5验收的是自主推进到候选，不要求同轮生产审查或最终PPTX成功。
- 完整材料包场景的PPT候选两次语义失败后诚实暂停。R5只要求范围、授权、动态轨迹、具体Observation/Replan和恢复；不要求在该场景调用真实媒体或形成整包。
- B侧脚本Artifact通过，但课程锚点Critic仍可要求进一步修复；在调用真实媒体前仍必须于V1-9通过独立创意与唯一最小课程锚点门。
- `ppt_design_draft`的`eligibleStages=[production_design_expansion]`不表示可直接调用图片、PPTX或样张Provider；完整`PptDesignPackage`门继续保留。

## 6. 仓内门

```text
Director新合同: 11/11
Runtime/Capability/Observation定向: 57/57
Node: 287/287
Vitest: 152 files / 1039 tests
TypeScript: passed
production build: 14 pages / passed
API ledger validation: passed
git diff --check: passed; line-ending warnings only
```

构建保留5条既有Turbopack动态文件模式警告；未发现当前仓遗留的Vitest、Jest或Playwright worker。

## 7. 下一阶段

按权威顺序进入唯一一次V1-9真实产品全链路。该阶段必须由产品Main Agent自主编排真实教案、可编辑PPTX、课堂视觉图、30-90秒完整MP4和版本一致ZIP；外部Codex只在成包后做黑盒验收。失败只返修受影响页面、镜头或版本。V1-9通过前不得进入教师签收、部署或V1-10切流。
