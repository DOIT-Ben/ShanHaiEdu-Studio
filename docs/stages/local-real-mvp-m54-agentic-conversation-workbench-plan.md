# M54 对话智能体与聊天式工作台阶段草案

日期：2026-07-08

状态：讨论记录 / 产品判断门。

正式拆分路线：

- 前端主线：`docs/stages/local-real-mvp-m54a-frontend-workbench-roadmap.md`
- 后端主线：`docs/stages/local-real-mvp-m54b-agentic-conversation-roadmap.md`

本文件保留为 M54 方向总入口；后续测试定义和开发以两份正式路线文档为准。

## 背景

M52 已经把方向从“用户一说话就生成产物”修正为“普通聊天不进产物链，业务需求才触发半自动选择”。M53 进一步把明确备课需求改为先展示教师可理解的备课任务确认，用户确认后才生成需求规格。

当前用户反馈说明：只修前端聊天样式不够。真正的核心能力是对话智能体是否理解教师需求，能不能像成熟 AI 教育产品一样，先自然对话，再把需求整理成可选择、可确认、可编辑、可交付的工作流。

## 竞品启发记录

同类产品不是纯聊天框，而是：

```text
聊天
-> 结构化选项
-> 可编辑产物工作区
-> 导出或集成到教师已有工具
```

参考方向：

- MagicSchool：以教师工具库和模板入口降低空白聊天成本。可学清晰入口，但 ShanHaiEdu 不应堆 80 个按钮，应聚焦少量高频公开课备课链路。
- Eduaide：从 objective、topic、standard 等槽位开始，先生成 first draft，再进入可编辑 workspace，并支持 revise、differentiate、evaluate、add visuals、export。可学“对话只是入口，价值在可编辑产物工作区”。
- Brisk Teaching：强调 AI works where teachers work，嵌入 Docs、Slides、YouTube、PDF、LMS 等教师已有环境。可学后期导出 PPT、Docs、ZIP 或集成，而不是只在网页中好看。
- Diffit：把任意材料变成差异化、可打印、可导出的课堂资源。可学上传材料后的二次加工能力，如分层阅读、词汇、问题、活动。
- SchoolAI / Curipod / Khanmigo：强调 teacher-controlled、学生安全、互动课堂。可学后期学生端必须教师控制，不做开放式学生自由聊天。

## 开源与工具启发

一手来源参考：

- Dify docs: https://docs.dify.ai/en/home
- Open WebUI docs: https://docs.openwebui.com/
- Flowise docs: https://docs.flowiseai.com/
- LangGraph docs: https://docs.langchain.com/oss/python/langgraph/overview
- LibreChat docs: https://www.librechat.ai/docs

- Dify：可参考 Workflow、RAG、Agent、模型管理、API 输出和运行日志，但不照搬通用平台形态。
- Open WebUI：可参考自托管、多模型 provider、知识库、工具调用、文件上传和本地部署体验。
- Flowise：可参考内部可视化编排、Tracing、Analytics、Evaluations、Human in the Loop、API/CLI/SDK，但不把节点图暴露给教师端。
- LangGraph / LangGraph Studio：可参考长任务、持久化、人类确认、interrupt/resume、状态可视化，适合“自动化跑完整交付”。
- LibreChat / LobeChat：可参考聊天体验、多模型、Artifacts、MCP/actions、移动端和主题设计。

## ShanHaiEdu 产品判断

ShanHaiEdu 不应做成 Dify/Flowise 那样的通用 AI 工作流平台，也不应做成 MagicSchool 那样的工具大卖场。

更适合的产品链路是：

```text
教师自然对话
-> 系统给推荐选项
-> 需求槽位补齐
-> 需求规格确认
-> 线性产物链
-> 每步可展开、可改、可确认
-> 最终交付包
-> 导出 PPT / Docs / ZIP
```

## 产品判断门

Stage: `products-autoplan`

Recommendation: `go`

Why: 用户价值清晰，且与 M52/M53 已完成方向一致。当前最阻碍 MVP 演示的不是单个 UI 缺陷，而是对话理解、槽位补齐、用户确认和产物工作区之间没有形成稳定闭环。

Gate: `continue`

Next: 进入 M54-A 测试定义与最小实现切片。

## M54 推荐范围

M54 不再命名为单纯“聊天 UI 重构”，而是：

```text
M54 对话智能体与聊天式工作台闭环
```

包含四层：

1. 对话智能体层：理解普通聊天、备课意图、缺失信息、确认信号、修改信号。
2. 需求槽位层：年级、学科、课题、教材版本、交付物、课堂时长、教学风格、资料来源。
3. 工作台交互层：消息流、quick reply chips、输入框附件、生成态、反馈、展开式成果卡。
4. 长任务运行层：为后续自动化交付准备可恢复、可中断、可审查的任务状态。

## 对话智能体改造方向

当前 `ConversationOrchestrator` 已有 `chat / clarify / start_requirement` 三类意图，但能力仍偏薄。下一步应扩展为：

- `chat`：普通聊天，不触发产物。
- `explore`：用户在聊想法或方向，系统陪聊并给轻量建议，不进入产物链。
- `clarify_slots`：识别到备课意图但缺少关键槽位，返回 2-3 个可点击推荐选项。
- `confirm_requirement`：槽位基本齐全，展示可确认需求卡。
- `start_requirement`：用户明确确认后，生成需求规格。
- `revise_requirement`：用户要求修改已经确认或生成的内容。
- `continue_workflow`：用户确认进入下一产物，如教案、PPT 大纲、导入视频方案。

输出不只是一段文字，而应是结构化决策：

```text
intent
assistant_message
slots
missing_slots
recommended_options
quick_replies
next_action
should_generate_artifact
```

## 需求槽位系统

建议第一版槽位：

- 年级：如 三年级、六年级。
- 学科：数学、语文、英语、科学、道德与法治。
- 课题：如 百分数、长方形和正方形的周长。
- 教材版本：苏教版、人教版、北师大版等，可为空。
- 交付物：教案、PPT 大纲、导入视频方案、课堂活动、最终交付包。
- 时长：20 分钟、40 分钟、公开课一节。
- 风格：互动、故事化、探究式、竞赛式、低龄化等。
- 材料来源：用户上传、手动输入、现有产物引用。

用户没有填完时，不应让用户一直打字，而应给推荐 chips。点击 chips 只填入输入框或更新草稿，不自动乱生成。

## 前端工作台改造记录

保留当前三栏：

- 左侧项目 / 工具入口。
- 中间对话主视觉。
- 右侧糖葫芦产物轨和阅读面板。

新增或拆分组件：

- `WelcomeEmptyState`：进入网站的样子，logo、欢迎语、推荐任务。
- `PromptComposer` 容器：输入区。
- `ComposerToolbar`：加号、模型、上传、Web Search。
- `ComposerAttachmentMenu`：上传材料入口。
- `ComposerFileDropzone`：拖拽文件到输入框时的覆盖态。
- `ComposerAttachmentPreview`：文件卡片、删除、解析状态。
- `useAutoResizeTextarea`：输入框自适应高度。
- `useComposerAttachments`：文件拖拽、粘贴截图、附件状态。
- `GeneratingIndicator`：友好的流式/等待状态。
- `MessageActions`：复制、反馈、展开等 hover/focus 操作。
- `FeedbackDialog`：点赞/点踩后的反馈入口。
- `QuickReplySuggestions`：每条回复后 2-3 个快捷发送指令。
- `ProfileMenu`：左下角头像菜单。

## 后端与运行时改造方向

短期不直接引入大而全平台。优先在现有后端边界内加薄层：

- `ConversationOrchestrator`：扩展结构化意图和槽位输出。
- `RequirementSlotService`：合并项目已有信息、用户输入、附件摘要和模型抽取结果。
- `PromptPack`：把对话智能体、需求规格、教案、PPT、视频等提示词版本化，便于审查和回滚。
- `ConversationEvalSet`：沉淀普通聊天、模糊需求、明确需求、修改需求、确认信号等样例，跑回归评测。
- `AttachmentPipeline`：支持 md/txt/pdf/docx 上传、解析、引用、状态显示。
- `WorkflowCheckpoint`：为后续自动化交付保存每步状态、输入、输出、人工确认和恢复点。

中期再评估是否接入 LangGraph 风格的状态图。优先学习其 interrupt/resume 和持久化思想，不急着把项目改成 Python LangGraph。

## 先进工具采用原则

- 可以学 Dify 的工作流变量、节点输出、运行日志和 API 化，但教师端不展示节点图。
- 可以学 Open WebUI 的模型/工具/知识库配置，但 ShanHaiEdu 保持教育备课专用，不做通用聊天平台。
- 可以学 Flowise 的内部 AgentFlow、评测和观测，但不让教师看到编排复杂度。
- 可以学 LangGraph 的持久化、人类确认、中断恢复，用于“自动化跑完整交付”。
- 可以学 LibreChat/LobeChat 的聊天质感、Artifacts、MCP/actions，但产物必须回到 ShanHaiEdu 的公开课交付链。

## M54 分阶段建议

### M54-A 对话智能体槽位与 quick replies

目标：让系统真正理解用户是在闲聊、探索、补充需求、确认需求还是修改需求。

验收：

- 普通问候只自然回复。
- 模糊备课意图返回槽位问题和推荐 chips。
- 明确备课需求返回可确认需求卡，不直接生成。
- 确认后才生成需求规格。
- 每条 assistant 回复有 2-3 个下一步建议。

### M54-B Composer 与附件交互

目标：输入框达到成熟聊天产品基础体验。

验收：

- Enter 发送，Shift+Enter 换行。
- 发送后自动滚到底部。
- 输入框自适应高度。
- 支持拖拽文件到输入框。
- 支持粘贴截图到输入框。
- md/pdf/docx/图片入口可见，未接真实解析时文案准确。

### M54-C 附件后端与材料理解

目标：上传材料能真正进入后端并成为对话上下文。

验收：

- 上传 API、附件记录、解析状态、删除。
- md/txt 可直接解析。
- pdf/docx 使用成熟库解析。
- 解析内容可作为需求槽位和产物生成依据。

### M54-D 消息质感与反馈

目标：回复像成熟聊天产品，且可收集用户反馈。

验收：

- 生成中有友好的 `正在生成` / `Generating` 动效。
- assistant 回复按点呈现，不堆大段。
- hover/focus 出现复制、反馈等低频操作。
- 点赞/点踩弹出反馈框并保存。

### M54-E 长任务与自动交付准备

目标：为“一个命令自动化跑完整交付”准备可恢复状态。

验收：

- 每个产物节点有输入、输出、确认、失败原因和恢复点。
- 自动交付脚本可以从需求规格确认后继续跑教案、PPT 大纲、导入视频方案、最终交付包。
- 人工确认点可暂停和继续。

## 风险

- 只美化 UI 会继续暴露“听不懂需求”的根问题。
- 只加 prompt 不加槽位和评测，效果会不稳定。
- 过早接入 Dify/Flowise/LangGraph 可能引入大依赖，拖慢本地 MVP。
- 上传文件如果只做前端预览，会被用户误解为真实材料理解，必须明确状态。
- quick replies 如果自动发送，会让用户失控；第一版必须只填入输入框或更新草稿。

## 最小下一步

先做 M54-A：

1. 写测试定义：覆盖普通聊天、模糊需求、明确需求、确认、修改、quick replies。
2. 扩展 `ConversationDecision` 结构，加入 slots、missingSlots、recommendedOptions、quickReplies、nextAction。
3. 更新 deterministic orchestrator 的教师场景规则。
4. 更新 OpenAI conversation schema 和提示词。
5. 前端渲染 quick replies 和需求槽位确认，不动真实产物生成链路。
