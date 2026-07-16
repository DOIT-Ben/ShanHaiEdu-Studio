# V1.0 Main Agent唯一编排与工作流原子Tool化关闭记录

日期：2026-07-16

## 1. 关闭范围

- Main Agent唯一拥有业务Tool选择、下一步、重试、Replan和停止权。
- TaskBrief、IntentGrant、IntentEpoch、ExecutionEnvelope、Observation、原子提交和跨轮语义合同贯通。
- 明确交付任务首轮可发现创建首个可信Artifact的合格Tool，局部任务不被固定扩张。
- 失败先保存reasonCode、Observation和恢复入口；非真实HumanGate原因不默认`ask_teacher`。
- approve不自动推进旧M2，最终包下载不现场拼包，fallback或degraded结果不能提升为成功Artifact。
- assistant-ui是唯一生产会话Runtime，按真实文本、Tool、Observation、Artifact、失败和恢复轨迹投影。

## 2. 本轮红绿修复

1. 固定五阶段条带仍由`ConversationWorkbench`无条件渲染。
   - 红：assistant-ui和旧交互测试命中`StageProgress`。
   - 绿：删除固定阶段组件、阶段推导和阶段编号反馈，只保留教师可读实时文本。
2. `SHANHAI_ASSISTANT_UI_ENABLED=0`仍可切回legacy会话Runtime。
   - 红：唯一UI Runtime特征测试命中legacy分支。
   - 绿：页面、布局控制器和ConversationWorkbench统一使用assistant-ui事件驱动路径。
3. 无消费者的`m2-orchestrator`仍保留DeterministicRuntime自动推进实现。
   - 红：旧路径退出测试要求文件不存在。
   - 绿：生产引用为0后删除该实现，approve路由仍只确认选定Artifact。
4. 浏览器缺少favicon导致桌面控制台404。
   - 红：metadata图标断言失败。
   - 绿：复用现有品牌PNG，最终桌面控制台0错误。

## 3. 复用而未重复开发的已关闭能力

- 首轮Tool资格、开放年级、局部视频脚本和Director/Critic资格。
- 强制ExecutionEnvelope、统一Gateway和原子Tool结果提交。
- 控制先提交、无pending改道、迟到旧结果、单写者和双用户隔离。
- 失败Observation、重试预算暂停、正式package asset反向绑定和无fallback提升。
- Responses Runtime与OpenAI Agents SDK隔离A/B合同。

## 4. 验证证据

| 层级 | 结果 |
|---|---|
| contract | Node 383/383；Vitest 1492/1492 |
| executor | 独立SQLite、单worker原子提交/恢复/隔离回归通过 |
| model orchestration | 保留既有真实文本Tool轨迹；本轮没有发起新的模型请求 |
| product E2E | 桌面生产构建只读验收通过：assistant-ui 1、固定阶段rail 0、控制台0错误 |
| release | 未开始 |

补充验证：`npx tsc --noEmit`、`npm run build`和`git diff --check`通过。生产构建仍有13条既有Turbopack动态文件追踪警告，本阶段未扩大到该性能问题。

## 5. 固定边界与下一步

- 未调用真实图片、视频、PPTX、ZIP或整包Provider；未运行390px。
- 未创建V1-9 manifest/runId，未进入教师签收、部署或V1-10。
- 未commit、push、部署或移动标签，保留全部用户在途改动。
- 用户先在`http://127.0.0.1:3187`验收；通过后按最新合同重新制定V1-9 plan/test-plan，并由用户运行唯一真实全链路。

## 6. 2026-07-17桌面增补证据

- Main Agent将“是否把当前PPT改成视频脚本、尚未决定”作为讨论边界处理，只比较两种形式并追问用途；`IntentEpoch`和既有Artifact集合均未变化。
- 普通等待态已收缩为“小酷正在回复”与真实计时；TaskBrief真实提交后展示“本轮目标已明确”，列出目标、交付范围和明确排除项。
- 明确“只做需求规格”的桌面回合只调用`create_requirement_spec`，真实Observation和需求规格Artifact成功投影，未扩张到教案、PPT、图片、视频或整包。
- 另一双Tool桌面回合已成功提交需求规格和PPT结构候选，最终Main Agent续轮出现一次`502`并以`main_agent_provider_unavailable`保存恢复入口；因此本增补不关闭Provider连续多轮稳定性，不代表R5或V1-9通过。
- 定向验证：Vitest单worker134/134，assistant-ui/交互Node合同19/19，TaskBrief范围投影4/4，TypeScript和生产构建通过；保留13条既有Turbopack动态文件追踪警告。
