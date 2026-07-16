# assistant-ui 对话 Runtime 需求

日期：2026-07-14

状态：accepted / active in current V1 control-plane refactor

关联需求：RQ-028、RQ-032、RQ-036、RQ-039

关联决策：`docs\architecture\decisions\2026-07-14-adr-v1-1采用assistant-ui与AG-UI兼容事件层.md`

## 1. 目标

当前V1控制面重构必须以 `assistant-ui` 作为教师对话区的唯一目标 UI Runtime，通过 `ExternalStoreRuntime` 适配 ShanHaiEdu 已有消息、项目和权限状态，并以 AG-UI 兼容事件层承载文本、活动、Tool、计划、成果引用、HumanGate、质量摘要和运行结束状态。

本需求解决的是消息协议、流式交互、活动呈现和对话组件重复建设，不替代 Main Agent、业务 Tool、Artifact、HumanGate、Quality Gate 或反馈业务状态机。

当前重构完成后不得长期保留两套对话 Runtime、两套消息状态源或两套活动状态。旧 `ChatTranscript` 与 Snapshot 轮询只允许作为受控迁移和回退路径。

## 2. 当前代码基线

实施前必须重新核对 V1 最终发布提交；当前规划基于 2026-07-14 在途代码事实：

- `ChatMessage` 主要由 `title + body`、`artifactRefs`、`quickReplies` 和 `deliveryPlan` 组成，不能稳定表达独立内容块。
- `ChatTranscript` 直接渲染正文并自行拼装计划、成果卡和快捷回复，消息协议与显示组件耦合。
- `useWorkbenchController` 以完整 `WorkbenchSnapshot` 为前端状态源，并通过定时刷新等待长任务结束。
- `ConversationMessage` 已持久化正文、成果引用和 metadata，可作为加法迁移基础，但不能把 assistant-ui 私有类型直接变成数据库业务合同。
- V1-9R 正在增加 `TaskBrief`、`IntentGrant`、ActionPolicy 和连续 ReAct；V1.1 只能投影这些业务事实，不能重新实现或改变其权限语义。

### 2.1 代码适配落点

| 当前落点 | V1.1适配职责 | 约束 |
|---|---|---|
| `src\lib\types.ts` | 增加项目自有MessagePart、事件和assistant-ui Adapter输入类型 | 保留旧ChatMessage兼容期，不导出第三方私有类型作为业务合同 |
| `src\lib\workbench-mappers.ts` | 将后端消息、Parts、活动和引用映射为前端稳定视图 | 不从正文关键词推断状态或成果 |
| `src\components\conversation\ChatTranscript.tsx` | 迁移期作为旧UI回退；正式入口由assistant-ui Thread替代 | 不继续叠加新的流式、Tool和活动状态 |
| `src\hooks\useWorkbenchController.ts` | 保留项目、成果和工作台控制；消息运行态转交独立Runtime Adapter | 不把assistant-ui状态继续堆进当前579行Hook |
| `src\lib\workbench-api.ts` | 保留Snapshot启动/恢复，增加事件流客户端和sequence续接 | POST消息仍由服务端202受理，不让客户端直接执行Tool |
| `src\app\api\workbench\projects\[projectId]\messages\route.ts` | 保持消息提交与历史读取兼容，返回项目自有Parts | 权限、CSRF和幂等语义不降低 |
| 新增项目事件Route | 提供受认证的SSE事件流和`afterSequence`续接 | 只发送教师安全事件；断开不取消服务端任务 |
| `src\server\conversation\conversation-turn-service.ts` | 在既有状态提交点发布教师安全事件 | 不能从模型自由文本伪造HumanGate、Quality或Artifact成功 |
| `prisma\schema.prisma` | 采用加法字段/事件记录支持Parts和重放 | 旧content、artifactRefs和metadata保留到回退门关闭 |

`conversation-turn-service.ts`已超过1800行。V1.1不得把事件序列化、教师安全投影和SSE传输继续写入该文件；应建立独立的事件投影/仓储/编码边界，由现有服务在状态提交后调用。

## 3. 唯一责任边界

| 层 | 唯一职责 | 不得承担 |
|---|---|---|
| Main Agent | 理解目标、规划、选择 Tool、Observation、Replan | UI 布局、客户端状态真源 |
| 业务服务 | Artifact、HumanGate、Quality Gate、权限、版本和副作用真源 | assistant-ui 组件状态 |
| ShanHaiEdu 消息合同 | 稳定的 MessagePart、事件信封、版本和兼容规则 | 绑定第三方库内部类型 |
| AG-UI 兼容 Adapter | 将服务端运行事实转换为可恢复事件 | 决定计划、批准或质量结论 |
| assistant-ui | 消息线程、内容块渲染、交互能力和自定义组件容器 | 业务授权、Tool执行和产物版本判断 |
| BlockNote | V1.3-V1.5 文档型成果编辑 | V1.1 对话Runtime、PPT或视频统一编辑器 |

## 4. 项目自有 MessagePart 合同

数据库和服务端 API 使用项目自有、可版本化的判别联合，不直接持久化 assistant-ui 的 `ThreadMessageLike`：

```text
text
activity
plan
tool-status
artifact-ref
quality-summary
human-input
next-actions
error-recovery
```

每个 Part 至少包含 `type`、`schemaVersion` 和教师安全 payload。引用真实业务事实的 Part 必须携带服务器生成的 locator 或引用，例如 messageId、artifactId/version/digest、planId/revision、actionId、runId；前端不得从正文关键词推断。

兼容规则：

1. 旧消息的 `content/body` 确定性映射为一个 `text` Part，不要求一次性重写历史记录。
2. 新字段采用加法迁移；V1 回退版本仍能读取正文和既有成果引用。
3. Part 中只保存教师可见投影和业务引用，不复制完整 Tool 参数、Prompt、思维链、Provider响应或敏感诊断。
4. assistant-ui Adapter 负责 `MessagePart -> ThreadMessageLike` 转换；转换失败必须显示安全错误并保留原始消息，不得静默丢弃。

## 5. AG-UI 兼容事件合同

V1.1 采用标准事件语义的兼容子集：

- Run：开始、成功结束、失败结束。
- Text Message：开始、增量内容、结束。
- Activity：完整快照和增量更新。
- State：重连所需的计划与线程安全快照。
- Custom：ShanHaiEdu 特有的成果引用、HumanGate、质量摘要和下一步动作。

自定义事件使用 `shanhai.*` 命名空间，不把 `artifact.created` 或 `human_input.required` 冒充AG-UI标准事件。所有事件必须携带 `eventId`、`projectId`、`runId`、`sequence`、`intentEpoch`、`createdAt` 和可见性等级；与计划相关时再绑定 planId/revision/stepId。

传输与持久化边界：

1. 文本 delta 和高频活动更新通过服务端流式传输；客户端不得用定时器伪造进度。
2. 业务状态继续写入现有权威表；事件层是可重放投影，不是HumanGate、Quality Gate或Artifact的新真源。
3. 刷新或断线后先读取持久化消息和状态快照，再从最后确认的 sequence 续接；重复事件必须幂等。
4. 运行结束后允许把高频 delta 压缩为最终消息和 ActivitySnapshot，但必须保留运行边界、失败、HumanGate和业务证据引用。
5. 事件乱序、重复、连接中断和客户端重连不得重复调用业务 Tool、重复扣费或提升状态。

### 5.1 API与存储建议合同

V1.1-0冻结正式字段，默认沿用以下兼容方向：

```text
POST /api/workbench/projects/{projectId}/messages
-> 202 message + turn job（保持现有语义）

GET /api/workbench/projects/{projectId}/snapshot
-> 启动、刷新和断线校正所需的完整安全快照

GET /api/workbench/projects/{projectId}/events?afterSequence={n}
-> text/event-stream，按项目授权返回n之后的教师安全事件
```

事件记录采用独立加法模型或经过评审的等价仓储，至少包含：`id/projectId/runId/sequence/type/intentEpoch/messageId?/planId?/payloadJson/visibility/createdAt`，并保证`projectId + sequence`唯一。高频文本delta可以在运行完成后压缩，但HumanGate、失败、运行边界、最终消息和业务引用不能丢失。

消息读取合同继续返回旧`content`，同时增加可选`parts`；新客户端优先读取Parts，旧客户端继续读取content。写入新助手消息时服务端同时生成可回退正文投影，直到旧UI删除门关闭。

## 6. assistant-ui 接入要求

### 6.1 Runtime Adapter

- 使用 `ExternalStoreRuntime`，现有服务端消息与项目状态保持真源。
- `onNew` 继续调用受CSRF、权限、幂等和IntentEpoch保护的现有消息入口。
- `onEdit`、`onReload`、分支和队列能力只有在服务端合同存在时才启用；不能仅在客户端修改消息树。
- 已产生真实副作用的历史消息不得使用通用“重新生成”直接重放；必须创建新的IntentEpoch或受控Repair/Retry动作。
- Tool结果按toolCallId或项目自有运行引用匹配，但教师UI只显示安全业务摘要。

### 6.2 必须提供的呈现能力

- 安全Markdown：标题、加粗、列表、表格、检查项、分隔线、代码/引用白名单和链接安全。
- 真流式文本：段落、列表项和结构块稳定提交，表格等完整结构避免半成品闪烁。
- 活动与计划：当前步骤、等待确认、失败、返修、完成和真实耗时；不显示思维链。
- Tool状态：只显示教师能理解的业务动作和结果，不显示参数、Provider、API或路径。
- Artifact引用：绑定真实artifact/version/digest，打开现有阅读面板；V1.1不建设BlockNote编辑器。
- HumanGate：显示服务端唯一PendingDecision，按钮和自然语言都进入同一控制解析链。
- 错误恢复：保留失败输入，提供合法重试、改道、反馈和安全错误编号。
- 消息操作：复制、赞踩、受控重试和必要的编辑；能力不可用时不显示假入口。

## 7. 迁移与回退

1. 合同先行：冻结 MessagePart、事件、错误和恢复语义。
2. 双读影子期：Adapter读取现有消息并生成assistant-ui投影，自动化比较消息数、顺序、正文、成果引用和状态，不切换教师入口。
3. 受控切换：以服务端功能开关将指定测试账号切到assistant-ui；旧UI只作为回退，不允许双写业务状态。
4. 全量切换：浏览器、双用户、刷新恢复和V1业务回归通过后，将assistant-ui设为唯一入口。
5. 删除条件：至少一个发布周期稳定且回退演练通过后，才能单独规划删除旧ChatTranscript/轮询兼容代码；V1.1发布提交不得顺手破坏性清理。

回退只切换UI Runtime与事件消费方式，不删除新字段、不回滚业务数据、不移动Artifact/HumanGate/Quality Gate状态。

## 8. 非目标

- 不只替换聊天组件外壳而保留旧消息、事件和控制责任。
- 不迁移OpenCode、LangGraph或重写Main Agent内核。
- 不让assistant-ui或AG-UI成为数据库业务真源。
- 不在V1.1建设BlockNote成果编辑、PPT在线对象编辑或视频时间线工作室。
- 不实现任意历史分支重放、客户端批准HumanGate或客户端直接执行Tool。
- 不把CopilotKit、Vercel AI SDK UI或另一套聊天Runtime并列接入正式入口。

## 9. 验收标准

1. 历史消息、旧成果引用和当前V1任务在assistant-ui中无损显示。
2. 文本、活动、Tool、计划、HumanGate、质量摘要和Artifact引用均由类型化Part渲染。
3. 流式中断、刷新、重新进入项目和重复事件后，消息顺序、运行状态和activePlan一致。
4. 重试、编辑、分支和排队只在服务端允许时出现，不绕过IntentEpoch、ActionPolicy或HumanGate。
5. 两名教师的消息、事件、计划、成果、确认和错误完全隔离。
6. 教师UI不出现裸Markdown、脚本注入、思维链、Prompt、Provider、API、路径、Token或原始Tool参数。
7. 当前V1以桌面真实浏览器验证流式内容、长表格、活动、HumanGate和输入框；390px只保留既有合同与历史证据，V1前不运行新的真实黑盒。
8. V1的Main Agent、PPT、视频、最终包、Artifact、HumanGate、Quality Gate和下载路径无回归。
9. 旧UI回退演练不会丢失消息、重复Tool调用或改变业务状态。

## 10. V1衔接门

V1.1-0开始时必须读取V1最终发布提交，并重新生成以下差异清单：消息类型、Prisma消息字段、Snapshot/事件入口、Main Agent输出、TaskBrief/IntentGrant、PendingDecision、activePlan来源和前端组件。若V1最终实现已经提供等价合同，应复用并更新本需求，不得平行新建第二套抽象。
