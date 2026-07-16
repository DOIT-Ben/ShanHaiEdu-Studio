# 官方与一手来源调研

调研日期：2026-07-11。

## 智能体、ReAct 与持久执行

### OpenAI

来源：[Agents SDK vs. Responses API](https://developers.openai.com/api/docs/guides/agents#agents-sdk-vs-responses-api)

已证实设计：OpenAI 官方同时支持应用自行控制 Responses API 工具循环，以及由 Agents SDK Runner 管理多轮工具、handoff、session、guardrail 和 tracing。现有 ShanHaiEdu 的自建 ToolRouter 路线合法，不需要因采用 Agent 就推翻。

来源：[Running agents](https://openai.github.io/openai-agents-js/guides/running-agents/)、[Multi-agent orchestration](https://openai.github.io/openai-agents-js/guides/multi-agent/)

已证实设计：Runner 会反复执行模型、工具和下一轮模型判断，直到 final output、handoff、错误或最大轮次；官方支持 LLM 主导与代码主导的混合编排、并行和 evaluator loop。

来源：[Tools](https://openai.github.io/openai-agents-js/guides/tools/)、[Guardrails](https://openai.github.io/openai-agents-js/guides/guardrails/)、[Human in the loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)、[Handoffs](https://openai.github.io/openai-agents-js/guides/handoffs/)

对 ShanHaiEdu 的影响：Main Agent 应使用真正的多轮 Tool Result 回灌；ToolRouter 仍是执行权威；Tool 前后分别做输入输出 Guard；HumanGate 保存可恢复检查点；专家优先作为 agents-as-tools，避免破坏教师单入口。

### Anthropic

来源：[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)

已证实设计：Workflow 沿预定义代码路径执行，Agent 由模型动态决定过程和工具。官方模式包括 routing、parallelization、orchestrator-workers 和 evaluator-optimizer，并强调环境 ground truth、人工检查点和停止条件。

来源：[Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)、[Agent SDK agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)

已证实设计：工具应少而清晰、面向高价值任务、返回高信号结果；模型发起 Tool Call，Runtime 执行，Tool Result 返回模型后继续判断。工具越多并不自动增强 Agent。

对 ShanHaiEdu 的影响：不能把 22 个 Contract 一一转成原子 Tool；应动态开放少量高层 Tool，并把确定性多步过程封装到 Capsule Tool 内。

### Google ADK

来源：[LLM agents and PlanReActPlanner](https://adk.dev/agents/llm-agents/)、[Runtime event loop](https://adk.dev/runtime/event-loop/)、[Workflow agents](https://adk.dev/agents/workflow-agents/)

已证实设计：LlmAgent 由模型动态决定工具与下一步；PlanReAct 明确在 Tool Output 后 reasoning 和 replanning；Sequential/Parallel/Loop/Graph 属于确定性流程，不等于模型自主规划。Runner 先提交状态与 Artifact 变化，再继续 Agent。

对 ShanHaiEdu 的影响：Plan 不能锁死整张图；每次 Observation 后必须允许 Replan；事件和 Artifact 必须先持久化再进入下一轮。

### LangGraph 与 LangChain

来源：[Checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers)、[Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)、[Multi-agent handoffs](https://docs.langchain.com/oss/javascript/langchain/multi-agent/handoffs)

已证实设计：Checkpoint 支持 HITL、time travel 和故障恢复；Interrupt 可以长期等待后恢复，但节点恢复可能重新执行，因此副作用必须幂等或拆分；官方建议很多复杂任务优先用单 Agent 加动态工具和配置，而不是先拆成常驻多 Agent。

对 ShanHaiEdu 的影响：HumanGate 需要持久 resume cursor；Provider 调用需要 invocation ID 和幂等键；暂不让 LangGraph 建第二套业务真相。

### Microsoft AutoGen

来源：[Managing state](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/state.html)、[Human in the loop](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/human-in-the-loop.html)、[Swarm](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/swarm.html)

已证实设计：Agent/Team 可 save/load state，但持久化仍由应用负责；异步人工等待应结束当前 Run、保存状态后再继续；Handoff 由工具消息驱动，但默认共享上下文和并行 handoff 有风险。

对 ShanHaiEdu 的影响：只抽取异步 PendingAction、HandoffEvent 和 state contract，不引入常驻 Team/Swarm。

### Temporal

来源：[Workflow definition](https://docs.temporal.io/workflow-definition)、[Activity definition](https://docs.temporal.io/activity-definition)、[Handling messages](https://docs.temporal.io/handling-messages)

已证实设计：Workflow 依靠 Event History replay，因此必须确定性；LLM、API、文件和数据库副作用应放在 Activity；Activity 可能重复执行，写操作必须幂等。

对 ShanHaiEdu 的影响：当前 SQLite 阶段不引入 Temporal；未来只让它实现 `DurableJobCoordinator`，不接管自由 ReAct 推理和 Artifact 业务真相。

### ReAct 原始研究

来源：[ReAct: Synergizing Reasoning and Acting in Language Models](https://react-lm.github.io/)

已证实思想：推理与行动交错，环境 Observation 会改变后续判断。生产实现不需要保存或展示原始思维链；应持久化简短决策摘要、ActionIntent、Tool Result 和 Plan Delta。

## Microsoft PowerPoint

来源：[Tips for creating and delivering an effective presentation](https://support.microsoft.com/en-us/office/tips-for-creating-and-delivering-an-effective-presentation-f43156b0-20d2-4c51-8345-0c337cefb88b)

已证实建议：远距离可读字体；尽量避免低于 18pt；精简文字；用图形传达信息；背景一致且不抢内容；文字与背景保持高对比；在真实设备上检查颜色和分辨率。

对 ShanHaiEdu 的影响：PPT QA 必须在渲染后检查字号、文字密度、投影可读性、背景一致性和视觉是否真正服务教学信息。

来源：[Make your PowerPoint presentations accessible](https://support.microsoft.com/en-us/office/make-your-powerpoint-presentations-accessible-to-people-with-disabilities-6f7772b2-2f33-4bd2-8ca7-dae3b2b3ef25)

已证实建议：使用 Accessibility Checker；为视觉添加替代文本；设置正确阅读顺序；颜色不是唯一信息；使用足够对比度；视频提供字幕或替代音轨。

对 ShanHaiEdu 的影响：PPT Contract 应加入 reading order、alt text、非纯颜色编码和媒体字幕字段。

## Google 视频生成指南

来源：[Video generation prompt guide](https://cloud.google.com/vertex-ai/generative-ai/docs/video/video-gen-prompt-guide)

已证实建议：Prompt 应拆分主体、动作、场景/上下文、镜头角度、镜头运动、镜头/光学效果和视觉风格；具体性可减少泛化输出；复杂动作需考虑片段长度。

对 ShanHaiEdu 的影响：Provider 不能只收到一段笼统自然语言；应逐镜头传入结构化 ShotSpec。

## W3C

来源：[Captions/Subtitles](https://www.w3.org/WAI/media/av/captions/)

已证实建议：字幕应包含理解内容所需的语言和非语言音频信息，并与音频同步；自动字幕需要人工或规则复核。

来源：[WCAG 2.2 Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

已证实阈值：普通文字至少 4.5:1；大文字至少 3:1；不能对接近阈值的结果四舍五入；细字体即使名义通过也可能实际较弱。

对 ShanHaiEdu 的影响：PPT 和视频字幕应采用像素背景采样后的对比度检查，不只检查设计 token。

## FFmpeg

来源：[concat demuxer](https://ffmpeg.org/ffmpeg-formats.html#concat-1)

已证实规则：concat demuxer 按顺序读取文件并调整时间戳；所有文件应具有相同流、codec、time base 等；错误时长会产生伪影，可用 duration 指令覆盖。

对 ShanHaiEdu 的影响：MP4 文件不能用 Buffer 字节拼接。应采用 concat demuxer/filter，必要时统一转码，并做时间戳与完整解码验收。

## 本机工具说明

- Presentations skill：要求先定义传播任务和叙事弧；每页承担一个叙事职责；逐页全尺寸渲染审查，联系表不能替代单页检查。
- HyperFrames：视频画面不能沿用网页卡片布局；应有 Beat Direction、镜头动词、节奏和过渡；支持 lint、validate、inspect、对比度和动画图检查。
- imagegen-free：Probe 已通过；支持 16:9、1K/2K/4K、文生图、参考图和编辑；课堂 PPT 主视觉优先使用该路线。
