# M60 异步对话队列、渐进展示与视频工作流重构计划

## 1. 阶段目标

M60 的目标是把当前“用户发送后同步等待整轮完成、前端一口气展示结果”的链路，升级为“用户可连续输入、消息进入项目级队列、后端串行推进、前端节点级渐进展示、视频工作流可配置拆分”的真实备课工作流底座。

成功标准：同一项目内用户可以在生成过程中继续输入并发送多条消息；新消息显示为排队中；后端一次只处理该项目的一个对话 turn；前端能看到 queued / running / succeeded / failed / blocked 等教师可理解状态；视频生成前必须按知识锚点、创意主题、脚本、分镜、资产、关键帧、分镜视频、只拼接最终视频的节点链路推进，不能直接用一句描述调用视频生成。

## 2. 当前问题与用户新增要求

### 2.1 当前问题

- `POST /api/workbench/projects/[projectId]/messages` 当前同步执行完整 conversation turn，前端要等整个请求返回后再刷新 snapshot，导致生成过程没有渐进反馈。
- 前端 `sending` 同时承担“请求中状态”和“输入锁”，导致生成过程中 textarea、上传和发送按钮被禁用，用户无法提前输入下一条需求。
- 后端缺少面向对话 turn 的项目级队列与生成锁；仅靠前端禁用按钮不能防止跨标签页、快速重复点击或多消息并发导致状态错乱。
- 现有视频节点过粗，容易退化为“教案或一句 prompt 直接生成视频”，不满足当前质量门禁中“视频主题、脚本、资产图、分镜提示词、每镜头时长、画面动作、旁白或字幕、课堂边界约束”的前置要求。
- `ppt_design_draft` 仍需补强逐页门禁，禁止“第 4-8 页”“第 9-12 页”这类范围合并页继续流入 Coze PPTX 生成。

### 2.2 用户新增要求

- 生成过程中仍能输入。
- 忙碌时发送的新消息应显示“排队中”，并按顺序处理。
- 生成过程应节点级或步骤级渐进展示，不等全部完成才出现结果。
- 视频导入不应局限于教案表述，而应先从结构化教案提取课程知识锚点，再围绕锚点生成有创意的导入主题。
- 视频工作流应包括主题、脚本、分镜、统一资产图、关键帧、分镜视频并发生成与最终只拼接。
- 视频 API 能力必须先以 provider profile 表达清楚：支持几张图、是否首尾帧、最大时长、并发策略、结果下载时效，不能把不确定能力写成已支持。
- 新工作流必须是节点契约和配置，不硬编码到单个智能体里。

## 3. 范围

### 3.1 本阶段包含

1. 设计并实现项目级对话 turn 队列：同一项目串行、跨项目可并行。
2. 将消息发送 API 从同步完整生成改为入队后快速返回，并提供队列状态查询。
3. 前端解除生成中输入锁，支持多条消息排队展示。
4. 前端将对话区和右侧节点区改为渐进状态展示。
5. 补齐断点续跑与失败可重试的最小状态基础：queued / running / succeeded / failed / canceled / blocked。
6. 补齐 PPT 设计稿范围合并页硬门禁，防止不合格设计稿进入 Coze PPTX。
7. 设计并落地视频工作流契约：知识锚点、创意主题、脚本、分镜、资产、关键帧、分镜视频、只拼接最终视频。
8. 将 Evolink / Grok Imagine 的已确认能力落为 video provider profile：T2V、I2V、1-7 张参考图、6-30 秒单段、未证实首尾帧、结果需及时下载。

### 3.2 本阶段不包含

- 不做生产部署。
- 不修改密钥存储策略，不在文档中写任何 token 或账号。
- 不把 MiniMax / Hailuo 作为默认主通道；仅保留为“可能支持首尾帧的后续 provider 候选”。
- 不做复杂视频剪辑、转场、滤镜、字幕后期或自动混音；最终视频只按分镜顺序拼接。
- 不承诺本阶段一定生成可商用成片；本阶段重点是工作流结构、队列、状态、门禁和可验证的真实文件链路。
- 不顺手重构无关 UI 或旧历史文档。

## 4. 关键假设

- 当前主工程目录为 `main\`，阶段内所有代码修改都在该工程内进行。
- 当前唯一产品口径是 `docs\product\current-requirements-baseline.md`。
- 现有 Prisma / repository / workbench service 可继续复用，只新增必要队列表和状态字段。
- 本地 MVP 可采用 API 请求触发的 lazy drain 或轻量 worker，不引入 Redis / BullMQ 等外部队列，除非现有项目已有成熟依赖。
- 视频真实 provider 第一阶段优先使用已 smoke 的 Evolink / Grok Imagine；未被官方确认的首尾帧能力只能标为不支持或未知。

## 5. 推荐架构

### 5.1 对话 turn 队列

新增或等价实现 `ConversationTurnJob`，用于承载用户消息处理队列：

```text
teacher message saved
  -> ConversationTurnJob queued
  -> project queue drain
  -> job running
  -> conversation-turn-service 执行原有推理与 artifact 保存
  -> job succeeded / failed / blocked
  -> drain 下一条 queued job
```

建议字段：

```text
id
projectId
teacherMessageId
assistantMessageId
status: queued | running | succeeded | failed | canceled | blocked
attempts
maxAttempts
idempotencyKey
lockedBy
lockedUntil
errorCode
errorMessage
teacherVisibleStatus
createdAt
updatedAt
startedAt
finishedAt
```

串行规则：

- 同一项目同时最多一个 `running` turn job。
- 若同项目已有 `running` 且未超时，新消息只进入 `queued`。
- `lockedUntil` 超时后可由下一次 drain 识别为可恢复或 failed，需要在界面显示“可继续/可重试”。
- 幂等 key 防止重复点击或网络重试生成重复 teacher message。

### 5.2 消息 API 改造

当前同步路径：

```text
POST /messages -> createTurn 完整执行 -> 返回完整 snapshot
```

改造后路径：

```text
POST /messages -> 保存用户消息 -> 创建 queued turn job -> 尝试启动 drain -> 202 返回 message + job
GET /snapshot 或 GET /queue -> 返回 messages + turnJobs + agentRuns + generationJobs + workflowNodes
```

MVP 可先保留原服务函数，但将其包装成后台执行入口：

```text
conversationTurnExecutor.runQueuedJob(jobId)
```

避免 controller 层继续持有完整长任务逻辑。

### 5.3 前端状态模型

前端需要拆开两个概念：

- `composerSubmitting`：当前这一次发送请求是否正在创建队列记录。
- `projectBusy`：项目后端是否有 running job。

输入框只应被 `composerSubmitting` 的极短状态限制，不应被 `projectBusy` 长时间锁住。

教师可见状态映射：

```text
queued   -> 排队中
running  -> 正在生成
succeeded -> 已完成
failed   -> 生成失败，可重试
blocked  -> 未达标，需要处理
canceled -> 已取消
```

禁止在教师界面显示 `provider`、`node_id`、`capabilityId`、`runtimeKind`、`storage`、`local path`、`debug` 等工程词。

### 5.4 节点级渐进展示

前端不再只依赖“最终 assistant message 出现”来代表进度，而应同时展示：

- 对话 turn job 状态；
- agent run 状态；
- generation job 状态；
- workflow node 状态；
- artifact 校验状态。

右侧 Artifact rail 的状态来源必须来自后端持久化状态，而不是前端本地猜测。

### 5.5 视频工作流契约

视频链路拆为可配置节点：

```text
lesson_plan_structured
  -> knowledge_anchor_extract
  -> creative_theme_generate
  -> creative_theme_confirm
  -> video_script_generate
  -> storyboard_generate
  -> asset_brief_generate
  -> asset_image_generate
  -> video_segment_plan
  -> video_segment_generate
  -> concat_only_assemble
  -> final_video_validate
```

每个节点都必须生成可保存、可确认、可失败、可重试的 artifact。

#### 5.5.1 知识锚点节点

输出必须包括：

- 本课关键知识点；
- 学生易错点；
- 可生活化表达点；
- 可创意化表达点；
- 最终视频必须落回的课堂问题。

#### 5.5.2 创意主题节点

输出多个候选主题，每个主题包含：

- 标题；
- 一句话故事；
- 创意类型：冲突 / 悬疑 / 任务 / 类比 / 实验 / 故事 / 生活情境；
- 绑定的知识锚点；
- 适合课堂导入的原因；
- 风险与不适合之处。

#### 5.5.3 脚本与分镜节点

默认目标为 60 秒，但按叙事功能分配时长，不平均切。分镜必须包含：

- 分镜 ID；
- 时长；
- 镜头目标；
- 场景；
- 画面动作；
- 镜头运动；
- 旁白或字幕；
- 需要的角色、道具、场景资产；
- 关键帧要求；
- 与前后镜头的连续性说明。

#### 5.5.4 资产与关键帧节点

资产包必须包括：

- 统一风格图；
- 角色参考图；
- 道具参考图；
- 场景参考图；
- 每个关键镜头的关键帧；
- 负面约束；
- 每张图的 prompt 与真实文件引用。

#### 5.5.5 视频 provider profile

Evolink / Grok Imagine 当前 profile：

```text
textToVideoModel: grok-imagine-text-to-video-beta
imageToVideoModel: grok-imagine-image-to-video-beta
imageUrls: 1-7
durationSeconds: 6-30
startEndFrame: 未证实，不作为已支持能力
concurrencyLimit: 未公开，MVP 保守低并发
resultUrlTtl: 24 小时，必须立即下载入 artifact storage
```

规划器不能把“多图参考”当成“首尾帧控制”。如果后续 provider 确认支持首尾帧，再由 provider profile 启用。

#### 5.5.6 分镜视频与只拼接

推荐默认 60 秒拆分：

```text
8s 冷启动钩子
10s 建立情境
10s 制造冲突或悬疑
10s 暗示知识锚点
10s 抛出挑战
12s 回到课堂问题
```

每段作为独立 video segment job 生成；单段失败只重试该段；全部片段通过校验后进入 `concat_only_assemble`。

最终组装只允许：

- 按 storyboard 顺序拼接；
- 不重排；
- 不加转场；
- 不加滤镜；
- 不额外剪辑内容；
- 不把 smoke 视频冒充最终视频。

## 6. 文件地图

### 6.1 可能修改的后端文件

- `prisma\schema.prisma`：新增或扩展对话 turn job 队列模型。
- `src\app\api\workbench\projects\[projectId]\messages\route.ts`：从同步执行改为入队返回。
- `src\server\conversation\conversation-turn-service.ts`：拆出可被队列 worker 调用的执行入口。
- `src\server\conversation\model-main-conversation-agent.ts`：保证 pending plan 与队列恢复兼容。
- `src\server\workbench\service.ts`：暴露队列状态、项目 busy 状态、重试入口。
- `src\server\workbench\repository.ts`：新增 turn job CRUD、锁获取、状态流转。
- `src\server\capabilities\capability-registry.ts`：新增视频工作流能力或扩展现有能力定义。
- `src\server\capabilities\capability-planner.ts`：按新视频节点规划完整交付顺序。
- `src\server\capabilities\capability-runner.ts`：支持新节点执行与 artifact 保存。
- `src\server\agent-runtime\task-guidance.ts`：补充知识锚点、主题、脚本、分镜、资产契约。
- `src\server\agent-runtime\openai-runtime.ts`：补充模型指令，但不能硬编码业务流程到单个 prompt。
- `src\server\agent-runtime\deterministic-runtime.ts`：测试草稿必须明确标草稿，且不能生成范围合并页进入真实门禁。
- `src\server\video-generation\video-generation-run.ts`：支持分镜段任务、参考图、下载入 storage 和片段校验。
- `src\server\coze-ppt\coze-ppt-run.ts`：继续保留真实 slideCount 门禁，必要时补范围合并页拒绝。

### 6.2 可能修改的前端文件

- `src\hooks\useWorkbenchController.ts`：拆分 composerSubmitting / projectBusy / queue 状态，改造发送与轮询。
- `src\components\conversation\PromptComposer.tsx`：生成中仍允许输入，发送进入排队。
- `src\components\conversation\ConversationWorkbench.tsx`：展示项目 busy 和队列状态。
- `src\components\conversation\ChatTranscript.tsx`：展示 queued / running / failed 的消息状态。
- `src\components\conversation\messages\GeneratingIndicator.tsx`：从单一生成中扩展为节点级进度提示。
- `src\components\artifacts\ArtifactRail.tsx`：渐进节点状态展示。
- `src\lib\workbench-mappers.ts`：教师可见状态文案与工程词过滤。
- `src\lib\types.ts`、`src\server\workbench\types.ts`：新增 turn job 与视频 artifact 类型。

### 6.3 测试与验证文件

- `tests\workbench-api.test.mjs`：消息入队、队列状态、幂等与串行处理。
- `tests\model-main-conversation-agent.test.ts`：pending plan 与队列恢复。
- `tests\m59-ppt-design-coze-gate.test.mjs`：继续承载 PPT 逐页设计门禁。
- 新增 `tests\m60-conversation-turn-queue.test.mjs`：项目级 turn 队列合同。
- 新增 `tests\m60-video-workflow-contract.test.mjs`：视频节点顺序、artifact contract 和 provider profile。
- 必要时新增前端组件测试或 Playwright 检查，验证生成中可输入与排队展示。

## 7. 分阶段任务

### 7.1 M60-A：测试合同先行

行动：新增队列、前端状态、视频 contract 的红灯测试或测试计划断言。

验证：测试在实现前应失败在明确行为上，例如同步 API 未返回 queued job、同项目并发未被串行、视频节点缺知识锚点。

### 7.2 M60-B：ConversationTurnJob 与 repository

行动：新增 turn job 模型、migration、repository 方法与锁获取逻辑。

验证：同项目只能获取一个 running job；queued job 按创建时间 FIFO；重复 idempotencyKey 不创建重复任务。

### 7.3 M60-C：消息 API 入队

行动：`POST /messages` 保存 teacher message 和 queued job 后返回 202；原 conversation turn 由 executor/drain 调用。

验证：真实 API 请求能快速返回 queued job；长任务失败时 job 标 failed 且保留教师可理解错误。

### 7.4 M60-D：队列 drain 与断点恢复

行动：实现 `drainProjectConversationQueue(projectId)`；running 锁超时可识别；失败节点可重试。

验证：连续发送 3 条消息时执行顺序与创建顺序一致；中间一条失败不破坏其他 queued 状态；刷新后状态仍可见。

### 7.5 M60-E：前端可输入与排队展示

行动：拆分 `sending` 语义；生成中 textarea 不禁用；新消息发送后展示排队态。

验证：浏览器中第一条运行时可输入第二条；第二条显示排队中；不出现工程词。

### 7.6 M60-F：节点级渐进展示

行动：snapshot 暴露 turnJobs / generationJobs / workflowNodes 状态；Artifact rail 和 transcript 渐进更新。

验证：运行过程中能看到节点从排队中到正在生成到已完成；失败节点显示未达标或可重试原因。

### 7.7 M60-G：PPT 设计稿硬门禁补齐

行动：拒绝范围合并页设计稿进入 Coze PPTX；下载与最终包继续按真实 slideCount 校验。

验证：包含“第 4-8 页”“第 9-12 页”的设计稿触发 blocked，不生成 PPTX；真实 slideCount 不等于目标页数时不可验收。

### 7.8 M60-H：视频工作流 contract

行动：新增视频节点定义、artifact kind、runtime guidance、provider profile 与 planner 顺序。

验证：完整视频计划必须经过知识锚点、主题、脚本、分镜、资产、片段规划；缺任一前置 artifact 时不能调用 video provider。

### 7.9 M60-I：分镜视频与只拼接最小实现

行动：按 storyboard 生成 segment jobs；每段下载入 storage；全部片段通过后只拼接。

验证：单段失败可单段重试；最终视频由真实 segment 文件拼接；无 smoke 或占位文件冒充最终视频。

## 8. 风险与回退

### 8.1 风险

- 队列化会改变 API 行为，前端和测试需要同步适配。
- 本地 lazy drain 若进程重启，running job 可能停在中间状态，需要锁超时和恢复策略兜底。
- Prisma schema 变更需要 migration；若历史数据存在不完整状态，需兼容读取。
- 视频工作流节点增加后链路更长，必须防止前端变复杂或教师看到工程术语。
- Evolink 并发上限未知，不能直接开高并发。
- 多图参考不等于首尾帧控制，若用户要求精确首尾帧，需要后续调研其他 provider。

### 8.2 回退方式

- 保留原 conversation turn 执行函数，不删除核心业务逻辑；队列 executor 只是调用它。
- 若队列 API 出现问题，可临时关闭 drain，只保留 queued 状态，不丢用户消息。
- migration 前备份本地数据库；回退时移除新 job 表或忽略新表。
- 视频新节点可先只生成结构化 artifact，不立即调用真实视频 provider。
- 前端可保留旧 snapshot 渲染兜底，但不能恢复“生成中禁止输入”的旧交互。

## 9. 验证标准

- `node --test "tests/m60-conversation-turn-queue.test.mjs"` 通过。
- `node --test "tests/m60-video-workflow-contract.test.mjs"` 通过。
- `node --test "tests/m59-ppt-design-coze-gate.test.mjs"` 继续通过。
- `npm test` 通过，若资源限制需要分组运行，必须记录分组命令和结果。
- `npm run build` exit 0。
- `git diff --check` 无 whitespace error。
- 浏览器桌面与窄屏验证：生成中可输入、消息排队、节点渐进、教师界面无工程词。
- 真实 PPTX 仍以 `ppt/slides/slide*.xml` 统计 slideCount。
- 视频最终文件必须来自真实 segment 文件拼接，不能是 smoke 或 placeholder。

## 10. 提交计划

建议按职责拆成 4 组提交：

1. `feat: 增加对话队列与消息入队 | V0.6 | 2026-07-09 HH:MM`
2. `feat: 支持生成中输入与渐进展示 | V0.6 | 2026-07-09 HH:MM`
3. `feat: 重构视频工作流节点契约 | V0.6 | 2026-07-09 HH:MM`
4. `fix: 补齐 PPT 与视频真实交付门禁 | V0.6 | 2026-07-09 HH:MM`

未经明确要求，不自动 commit、push 或部署。

## 11. 阶段门禁

Stage：`products-writing-plans`

Gate：`continue`

下一步：进入 `products-plan-eng-review` 审查队列模型、schema 变更、状态机和视频 workflow contract；审查通过后再进入测试先行与实现。
