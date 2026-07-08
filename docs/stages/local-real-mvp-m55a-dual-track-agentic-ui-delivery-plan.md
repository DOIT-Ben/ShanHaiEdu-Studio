# Local Real MVP M55-A 双主线并发交付规划

> 日期：2026-07-08  
> 目标版本：v0.9.68 起  
> 阶段定位：M55-A 不是单纯后端 Agent 阶段，也不是单纯 UI polish 阶段；它要并发收口“教师一句话需求到可执行交付计划”和“M54-A 未完成 UI 体验打磨”。

## 1. 第一性需求

当前产品的第一性要求是：教师不需要理解工作流、节点、provider、schema 或调试状态，只要用一句话说明备课目标，就能被 AI 带着确认需求、看到可执行计划、逐步生成并阅读可复用成果。

这个要求拆成四个不可退让的产品事实：

- **输入必须低摩擦**：教师可以输入一句话，也可以补充文本、教材、截图或文档；系统必须诚实显示材料状态，不能假装已解析。
- **计划必须可确认**：普通聊天不能误生成；明确备课需求要先形成教师可读的执行计划，再由教师确认推进。
- **成果必须可读可用**：教案、PPT 大纲、素材提示、最终包不能只作为后台对象存在；教师要能在对话与侧栏中阅读、复制、确认、重做、继续作为输入。
- **界面必须低噪声可信**：中间对话是主视觉；未来功能、禁用按钮、工程词、假状态都不能干扰教师。

因此，M55-A 的核心不是“再加一个功能”，而是把后端主链路和前端工作台体验同时推进到一个可继续放大能力的稳定基线。

## 2. 可复用方案与现有基础

### 2.1 行业验证方法

本阶段复用三类成熟产品方法：

- **ChatGPT / Claude 类对话产品的 composer 模式**：输入区应支持文本、附件、发送状态、快捷建议、焦点连续性；未接能力不常驻打扰主路径。
- **Copilot / Agent 工作流的 Human-in-the-loop 门控**：明确任务先生成计划，用户确认后执行；计划步骤有状态，失败可恢复。
- **Notion / Linear 类低噪声工作台**：主路径安静，低频操作隐藏到 hover、菜单或详情页；信息密度高但不吵。

### 2.2 项目已有可复用基础

- `src/server/capabilities/*` 已有 capability registry、planner、runner、类型定义。
- `src/server/conversation/*` 已有主对话 Agent 与确认门雏形。
- `src/server/workbench/*` 已有项目、消息、节点、产物、运行记录和生成任务持久化底座。
- `src/components/conversation/*` 已有三栏工作台、quick replies、composer、消息流、inline 成果卡。
- `src/components/artifacts/*` 已有右侧糖葫芦、阅读侧栏、详情 sheet、MarkdownPreview。
- `docs/ui/frontend-workbench/*` 已沉淀 M54-A UI 深度规格、测试计划和历史阶段文档。

### 2.3 本阶段复用的 skills / 工作流

- 使用 `ui-ux-pro-max` 作为 UI/UX 主导规范来源。
- 使用并发只读子智能体拆解 UI 文档落差、现有 UI 风险、M55-A 后端主链路缺口。
- 验证继续沿用项目现有 `npm test`、`npm run build`、`git diff --check`，UI 改动必须补浏览器 smoke。

## 3. 复用、适配与必要自研

### 3.1 复用

- 复用现有 `MainAgentTurn`、`CapabilityToolPlan`、`WorkbenchSnapshot`、`ChatMessage` 等类型作为兼容层，不推倒重来。
- 复用当前 `quickReplies` 传输路径，但扩展为可承载 `deliveryPlan` 的前端消息展示。
- 复用 `ArtifactSidePanel` / `MarkdownPreview` 阅读体验，不另造一个独立成果阅读系统。
- 复用 M54-A 文档中的组件边界：Composer、MessageActions、FeedbackDialog、InlineArtifactCard、WelcomeEmptyState、ProfileMenu。

### 3.2 适配

- 后端 `toolPlan` 保留为首步兼容字段，同时新增 `deliveryPlan` 作为多步计划主合同。
- `ConversationTurnService` 先做到“确认完整计划、执行首步、剩余步骤 pending”，不在 M55-A 里急着接真实 PPT/图片/视频 provider。
- 前端先展示计划卡和最低可用操作，不一次性实现所有高级交互。
- 附件 UI 先表达状态，不承诺后端解析完成；未接的 PDF/DOCX/图片解析必须显示“待解析/稍后开放”。

### 3.3 必要自研

- 自研 `deliveryPlan` 类型，因为它需要绑定本项目的 `capabilityId`、`workflowNodeKey`、教师可见文案与确认门状态。
- 自研 M55-A 执行计划卡，因为通用聊天组件无法表达“多步备课交付计划 + 确认门”。
- 轻量升级 Markdown 阅读层，先满足标题、段落、无序/有序列表、加粗、表格基础可读；是否引入成熟 Markdown 库留到实现前评估。

## 4. 并发开发路线

### 4.1 总体拆分

M55-A 按“双主线、五智能体”并发推进：

| 轨道 | 智能体 | 目标 | 主要边界 |
| --- | --- | --- | --- |
| 后端主链路 | 后端 A | DeliveryPlan 合同与多步 planner | `src/server/capabilities/*`、`main-conversation-agent.ts` |
| 后端主链路 | 后端 B | ConversationTurnService HumanGate 与 `/messages` envelope | `conversation-turn-service.ts`、route、tests |
| 前端 UI | 前端 A | Composer、附件状态、模型菜单、quick reply 聚焦 | `PromptComposer.tsx`、`conversation/composer/*` |
| 前端 UI | 前端 B | MessageActions、FeedbackDialog、Generating、确认/计划卡 | `ChatTranscript.tsx`、`conversation/messages/*` |
| 集成/QA | 集成 C | M54-A/M55-A 浏览器 smoke、红线词、最终汇总 | `tests/e2e/*`、Playwright evidence |

### 4.2 阶段顺序

#### 阶段 0：合同冻结

- 后端 A 定义 `DeliveryPlan` / `DeliveryPlanStep`。
- 明确 step 字段：`id`、`capabilityId`、`artifactKind`、`title`、`teacherDescription`、`status`、`requiresConfirmation`。
- `toolPlan` 保留为首步兼容，不作为多步主合同。

验收：`tests/capability-planner.test.ts` 和 `tests/main-conversation-agent.test.ts` 能证明复合需求生成完整计划。

#### 阶段 1：HumanGate 与 route 闭环

- `/messages` 对明确复合需求返回 `agentTurn.deliveryPlan`，确认前不生成 artifact。
- “确认开始”必须绑定上一轮可确认计划；没有 pending plan 时不执行。
- M55-A 可只执行首步 `requirement_spec`，但必须诚实保留剩余步骤 pending。

#### 阶段 1.1：Pending Plan 持久化绑定

- 第一性需求：确认门不能依赖“重新猜上一句用户意图”，必须绑定教师已经看到并确认的计划快照。
- 可复用基础：复用 `ConversationMessage` 消息持久化、`artifactRefsJson`/`structuredContentJson` 的 JSON 字符串模式，以及现有 route/service 测试链路。
- 适配方式：给 `ConversationMessage` 增加 `metadataJson`，计划消息保存 `pendingDeliveryPlan` 快照；确认时从最近未消费的 pending metadata 读取教师原始请求、首步 `toolPlan` 和 `deliveryPlan`。
- 必要自研：只新增最小 metadata 结构和读取校验，不引入独立 pending-plan 表；后续多计划并发或取消能力再升级为专门状态表。
- 验收标准：确认前不生成 artifact；无 pending 不执行；中间插入普通聊天后确认仍执行原 pending plan；已确认计划不能被重复当作新的 pending plan。

验收：`tests/conversation-turn-service.test.ts` 覆盖普通聊天、复合需求、无 pending 确认、复合需求后确认。

#### 阶段 2：UI 第一批并发打磨

前端 A：

- Composer 拆出 toolbar / attachment menu / model menu / attachment preview。
- 文件选择、拖拽、粘贴截图先进入状态卡。
- 未解析材料显示真实状态，不假装已理解。
- Quick reply 点击后输入框聚焦。

前端 B：

- MessageActions 拆出复制、点赞、点踩、更多。
- FeedbackDialog 未接后端时显示本地记录或暂未开放。
- GeneratingIndicator 支持“理解需求 / 整理材料 / 生成回复 / 保存成果”。
- 新增计划/确认卡组件，展示 `deliveryPlan`。

验收：`tests/m54a-frontend-workbench-contract.test.ts`、`tests/m52-semi-auto-conversation-gate.test.mjs`、浏览器 smoke。

#### 阶段 3：UI 第二批打磨

- WelcomeEmptyState：低噪声品牌欢迎、2-3 个高频任务入口。
- ProfileMenu：左下角账号/设置/反馈/运行模式/退出。
- MarkdownPreview：有序列表、加粗、基础表格、长文本换行。
- InlineArtifactCard：复制、作为输入、确认、重做、打开完整成果。

验收：桌面 1440px 和窄屏 390px 浏览器检查；成果阅读不溢出、不泄露工程词。

#### 阶段 4：最终收口

- 运行 `npm test`。
- 运行 `npm run build`。
- 运行 `git diff --check`。
- 运行桌面/窄屏 browser smoke。
- 如需提交/推送，提交前运行 `graphify update .`。

## 5. 风险与约束

- **共享文件冲突风险**：`src/lib/types.ts`、`src/lib/workbench-api.ts`、`src/hooks/useWorkbenchController.ts` 必须由集成者串行收口，不能多个前端同时改。
- **假能力风险**：附件、反馈、模型菜单、真实生成 provider 未接通时必须 disabled、pending 或本地状态，不能伪装上线。
- **工程词泄露风险**：浏览器可见文本和 aria-label 都要扫描，不能只 grep 源码。
- **过度 UI 风险**：不做营销 hero、大渐变、卡片套卡片；继续保持白底、低噪声、Codex 风格工作台。
- **Provider 接入顺序风险**：M55-A 不急着接 Coze/图片/视频 provider；先把 plan、confirm、artifact 保存和 UI 展示稳定。

## 6. 验证标准

### 6.1 后端验收

- 普通聊天不生成 `deliveryPlan` 和 artifact。
- 复合备课需求生成完整 `deliveryPlan`。
- 确认前不生成 artifact。
- 无 pending plan 的确认不执行。
- 复合需求确认后至少生成 `requirement_spec`，剩余步骤保持 pending。

### 6.2 前端验收

- 首屏能自然引导“一句话开始备课”。
- Quick reply 只填入输入框并聚焦，不自动发送。
- Composer 附件显示真实状态。
- 计划卡展示教师可懂的执行步骤。
- 成果卡、侧栏、Markdown 阅读不泄露工程词。
- 390px 窄屏无横向滚动，输入区和成果入口可用。

### 6.3 全量验收命令

```powershell
npm test
npm run build
```

### 6.4 浏览器验收

- 桌面：`1440x900`。
- 窄屏：`390x844`。
- 流程：空态 -> 一句话复合需求 -> 展示计划卡 -> quick reply 确认 -> 生成首步成果 -> 打开成果阅读。

## 7. 下一步执行建议

推荐先执行阶段 0 和阶段 1，锁定 `deliveryPlan` 合同；同时让两个前端智能体开始 UI 第一批打磨，但前端只能消费已冻结字段，不自行发明计划结构。

一旦 `deliveryPlan` 合同通过目标测试，前端 B 接计划卡，前端 A 接 composer/附件，集成 C 负责浏览器 smoke 与红线审计。
