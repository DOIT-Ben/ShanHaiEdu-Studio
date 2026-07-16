# V1.1 对话 Runtime 与反馈闭环阶段规划

日期：2026-07-13

状态：planned；等待 V1-10 发布门关闭后启动

权威需求：

```text
docs\archive\2026-07-16-authority-convergence\historical\docs\product\v1-1-assistant-ui-conversation-runtime-requirements.md
docs\roadmap\product\v1-1-feedback-closed-loop-requirements.md
```

## 1. 目标与成功标准

目标是在不重做 V1 智能体架构和媒体生产链的前提下，以assistant-ui统一教师对话Runtime和消息交互，以AG-UI兼容事件Adapter恢复长任务活动，再交付“当前计划可见、产物局部反馈、团队分诊处理、教师结果回告、指标驱动迭代”的 V1.1 邀请制版本。

成功标准以需求规格第 12 节十三项总验收为准。阶段QA进入V1.2，持续多轮审查延期到V2.0之后；任何单阶段完成都不能单独宣称 V1.1 已上线。

## 2. 复用与新增

### 2.1 直接复用

- `FeedbackDialog`、`useFeedbackController`、共享反馈 contracts 和 multipart API。
- `FeedbackRecord`、`FeedbackAttachment`、staging/reconcile、幂等、受控附件、管理员列表/详情/导出。
- 现有 password auth、owner/membership、CSRF、审计与邀请制准入。
- 现有 Project Snapshot、DeliveryPlan、IntentEpoch、HumanGate、Quality Gate 和 ArtifactVersion。
- 现有 UI primitives、三栏工作台、成果抽屉和响应式布局。
- V1最终发布后的TaskBrief、IntentGrant、PendingDecision、ActionPolicy、ToolObservation和运行恢复合同；V1.1只做教师安全投影。

### 2.2 需要新增

- 反馈业务 case、状态事件、重复归并、版本/需求关联和教师可见回告。
- 类型化 feedback locator 与服务端归属校验。
- 教师“我的反馈”和管理员分诊工作台。
- PPT 页级、视频镜头/时间段级、教案段落级和最终包级入口。
- RQ-028 `activePlan` 投影与工作台计划 Dock。
- 项目自有MessagePart、AG-UI兼容事件信封、流式恢复和assistant-ui ExternalStoreRuntime Adapter。
- text、activity、plan、tool-status、artifact-ref、quality-summary、human-input、next-actions和error-recovery类型化Renderer。
- 最小指标聚合、版本回告和闭环验收证据。

## 3. 阶段顺序

| 阶段 | 目标 | 前置 | 主要验收 |
|---|---|---|---|
| V1.1-0 | V1差异复核与合同冻结 | V1-10 done | ADR、MessagePart、事件、数据、API、权限、隐私和回退合同通过评审 |
| V1.1-1 | assistant-ui Runtime与消息迁移 | V1.1-0 | 历史消息无损投影、安全Renderer、受控回调和旧UI回退通过 |
| V1.1-2 | AG-UI兼容事件流与当前计划 | V1.1-0、V1.1-1 | 真流式、断线续接、活动事件、activePlan双视图和最终收尾通过 |
| V1.1-3 | 反馈 case 与安全迁移 | V1.1-0 | 双状态分离、旧数据升级、事件审计、备份恢复通过 |
| V1.1-4 | 管理员分诊工作台 | V1.1-3 | 队列、详情、归因、归并、状态推进和权限通过 |
| V1.1-5 | 教师“我的反馈”与回告 | V1.1-1、V1.1-3 | 只读自己的反馈、补充、重新打开、站内回告通过 |
| V1.1-6 | 现场与产物上下文反馈 | V1.1-2、V1.1-3、V1.1-5 | 错误现场预填、PPT页、视频时间段/镜头、教案段落、最终包locator通过 |
| V1.1-7 | 搜索与快捷操作 | V1.1-2、V1.1-5 | 渐进式面板、授权搜索、键盘/390px和副作用门禁通过 |
| V1.1-8 | 指标、运营与版本回告 | V1.1-4至7 | 指标可信、无敏感高基数标签、发布说明可关联反馈 |
| V1.1-9 | 真实内测与发布验收 | V1.1-1至8 | 两名教师、Runtime、活动流、反馈闭环、恢复、回退与签收通过 |

V1.1-1与V1.1-3可在合同冻结后并行：前者迁移对话Runtime，后者建设反馈数据底座。V1.1-2只投影V1已经存在的Plan、Tool摘要、Observation、HumanGate、Quality Gate和Artifact事实，不新增阶段QA业务。教师反馈入口必须同时依赖稳定消息Runtime和反馈case；搜索依赖activePlan与教师安全视图。任何阶段都不得为了UI状态复制业务状态机。

## 4. 分阶段任务

### V1.1-0 基线与合同冻结

- 重新核对 V1 发布commit、生产拓扑、数据库版本、消息/反馈接口、TaskBrief/IntentGrant/PendingDecision、前端组件和浏览器证据，形成与2026-07-14规划基线的差异清单。
- 按ADR冻结项目自有MessagePart、AG-UI兼容事件、assistant-ui Adapter、错误、恢复和功能开关合同；不得直接持久化第三方私有类型。
- 定义 `FeedbackCase`、事件、locator、教师安全视图和管理员视图合同。
- 明确 storage status 与 case lifecycle 的命名、状态迁移和不变量。
- 写加法数据库迁移、历史消息投影、旧数据归档、备份、Runtime切换、恢复和代码回退方案。
- 写各阶段 test-plan，禁止先改 schema 再补规格。

退出门：合同评审无未决 P0；消息和反馈迁移均可加法实施；权限矩阵、双Runtime临时边界、删除条件和回退路径明确。

### V1.1-1 assistant-ui Runtime与消息迁移

- 锁定经React 19、许可证、变更日志和安全公告复核的assistant-ui版本，使用ExternalStoreRuntime接入现有服务端消息。
- 实现项目自有MessagePart到assistant-ui消息的单向Adapter；旧content/body确定性转换为text Part，成果引用和运行状态不靠正文猜测。
- 实现安全Markdown及activity、plan、tool-status、artifact-ref、quality-summary、human-input、next-actions、error-recovery Renderer。
- `onNew`继续走现有服务端消息入口；编辑、重试、分支和排队只有服务端合同存在时才启用，已产生副作用的任务不能由客户端通用重放。
- 先运行影子投影和消息顺序/正文/引用一致性测试，再按测试账号功能开关切换；旧UI只读同一业务状态，不允许双写。

退出门：历史消息、成果引用、快捷动作和V1任务无损显示；安全Renderer、回调权限、刷新恢复和旧UI回退通过；assistant-ui成为测试账号唯一对话Runtime。

### V1.1-2 AG-UI兼容事件流与当前计划

- 将Run、Text Message、Activity、State和ShanHaiEdu Custom事件映射到服务端真实运行事实；自定义事件统一使用`shanhai.*`命名空间。
- 建立eventId、runId、sequence、projectId、IntentEpoch和可见性合同；处理重复、乱序、断线续接、压缩和快照校正。
- 按RQ-028生成唯一activePlan投影，在assistant-ui线程与输入框之间提供计划/进度双视图。
- 当前阶段完整展示，已完成阶段聚合折叠；新计划、实质Replan、HumanGate、失败和完成时显示真实事件，不用定时器或模型文本伪造。
- 最终收尾绑定成果、版本、质量状态和未关闭事项；V1.2阶段QA不提前进入本阶段。

退出门：真流式、刷新、重连和重复事件后消息与计划一致；Tool成功、Quality失败、HumanGate等待、暂停、改道、局部返修和完成均来自服务端事实；桌面与390px输入始终可用。

### V1.1-3 反馈 case 与安全迁移

- 增加 case、case event 和原始反馈关联，旧 submitted 记录可被确定性纳入待分诊状态。
- 实现状态机、乐观并发或等价版本栅栏、重复归并和脱敏审计。
- 保持原上传、附件、幂等和 reconcile 流程不变。
- 完成 fresh/old SQLite、连续初始化、备份恢复和失败重试验证。

退出门：不存在把 `processing` 误当作“处理中”的语义混淆；旧反馈、附件和回执不丢失。

### V1.1-4 管理员分诊工作台

- 提供受保护的队列、筛选、详情和上下文阅读。
- 支持优先级、责任层、复现状态、负责人、目标版本和需求关联。
- 支持人工重复归并；原始记录不可覆盖或删除。
- `resolved` 强制要求修复版本、验证证据和教师可见摘要。

退出门：管理员可完成完整状态推进；普通教师和非成员无法访问内部字段。

### V1.1-5 教师“我的反馈”与回告

- 提供个人反馈列表和详情，只返回教师安全字段。
- 支持 needs_info 补充、问题仍存在和受控重新打开。
- 提供站内状态更新，不建设自由评论线程。
- 保证两用户之间回执、附件、项目和处理结果完全隔离。

退出门：教师能知道“收到、处理中、待补充、已解决或暂不处理”，且没有内部归因泄露。

### V1.1-6 现场与产物上下文反馈

- 在对话、任务和输入区附近提供低噪声错误条，支持查看详情、复制安全编号、反馈问题和关闭。
- 点击反馈问题后复用 FeedbackDialog，预填已知的任务与期望，附带可预览/关闭的脱敏诊断摘要；未点击提交不创建记录。
- 定义 ErrorFeedbackContext 白名单和服务端权限复核；完整对话、Prompt、请求响应、凭据、路径、原始堆栈和未授权截图始终排除。
- 教案阅读绑定 sectionId；PPT 阅读绑定 pageId/pageNumber。
- 视频阅读绑定 shotId 或 time range，并保留最终 MP4 版本。
- 最终包绑定 packageId、manifest digest 和成员产物版本。
- 页面、消息、计划和失败节点补齐 locator；服务端校验交叉归属。
- 为各产物提供教师可理解的快捷原因，不向 UI 暴露内部 ID。

退出门：真实错误能一键打开准确预填且无敏感值的反馈；每种 locator 均能从教师操作还原到唯一真实版本；旧版本和跨项目伪造被拒绝。

### V1.1-7 搜索与快捷操作

- 增加低噪声搜索入口和 `Ctrl/Cmd+K`，桌面使用居中面板，390px 使用近全屏 Sheet。
- 空查询展示建议与最近；输入后按“全部、操作、项目、成果”过滤，并在结果中分组显示当前任务和反馈入口。
- 搜索授权项目、任务、成果和教师可见操作；权限过滤在服务端完成，前端不得收到越权条目。
- 支持方向键、Enter、Escape、焦点恢复、加载、空结果、失败和权限变化刷新。
- 破坏性或高成本动作只导航到原确认流程；不直接执行，不绕过 HumanGate。

退出门：教师能从一个入口找到高频操作和授权内容，两个账号搜索结果完全隔离，桌面与390px无溢出和工程词。

### V1.1-8 指标、运营与版本回告

- 聚合反馈数量、有效率、重复率、分诊时间、解决周期和重新打开率。
- 关联产物类型、节点、责任层和版本，但不把用户文本、ID或敏感值作为指标标签。
- 形成每周反馈复盘模板：事实、Top问题、根因、决定、目标版本和验证结果。
- 发布说明只回告已验证修复，不承诺未完成能力。

退出门：团队可以从数据选择下一轮优先级；指标与原始记录抽样一致。

### V1.1-9 真实内测与发布验收

- 使用至少两个受邀教师账号，在两个项目中并行完成备课与反馈。
- 使用assistant-ui正式入口完成普通问答、长任务、HumanGate、失败恢复、成果打开和消息操作；旧UI只执行一次回退演练。
- 选择至少一条真实错误现场/流程问题和一条生成产物局部问题，跑完整闭环。
- 使用两个账号验证搜索无法发现对方未共享的项目、任务、成果和反馈。
- 执行目标服务器重启、备份恢复、release 回滚和重新部署验证。
- 完成外部产品审核、教师签收、已知风险和 V1.1 发布说明。

退出门：测试计划全部通过、P0为0、两条真实闭环完成、生产恢复证据齐全后，才能标记 V1.1 可发布。

## 5. 风险与控制

| 风险 | 控制 |
|---|---|
| 把反馈系统做成大型工单平台 | 只保留结构化状态、单次回告、补充和重新打开 |
| 业务状态污染上传事务 | 双状态、双职责模型，旧字段不改语义 |
| 局部 locator 指向旧产物 | 强制 artifact version/digest 与服务端归属校验 |
| 频繁弹窗打扰教师 | 默认主动入口，自动询问只在里程碑且每节点限一次 |
| 性别刻板化视觉 | 以专业、清爽、低学习成本为准，不以粉色和卡通作为用户画像替代 |
| 管理员看到过多敏感上下文 | 教师安全视图/管理员视图分离，字段白名单和审计 |
| SQLite 多写者限制 | 延续 V1 单进程拓扑；提高并发另立容量阶段 |
| V1.1 插队影响 V1 上线 | V1-10 关闭前只保留规划，不实施代码 |
| assistant-ui与旧UI形成双真源 | 只允许影子读和功能开关切换，禁止双写；发布后按删除条件单独清理 |
| 通用重试重放真实副作用 | 回调能力由服务端授权，真实费用与状态提升继续经过IntentEpoch、ActionPolicy和HumanGate |
| 事件流与业务表状态分叉 | 业务表权威、事件只做投影；重连使用服务端快照校正 |

## 6. 开发与验证命令

每个实施阶段根据实际文件写定向测试命令，公共门禁至少包括：

```powershell
npx prisma validate
npx tsc --noEmit
npm test
npm run build
git diff --check
```

UI 阶段还必须运行定向 Playwright，并在 1366x768 与 390x844 做真实浏览器检查。资源密集型测试遵循单 worker 或项目既有安全 runner，不并行启动多个全量套件。

## 7. 提交与发布边界

- 每个 V1.1 阶段独立 plan、test-plan 和 closeout，不把Runtime、事件、反馈和发布压成一个大提交。
- 数据迁移、API合同、教师UI、管理员UI和指标不得混为一个不可回退提交。
- 既有 `v1`、`v1.1.0-alpha`、`v1.1.0-alpha.1` 标签不移动、不重写；V1.1 最终发布标识在发布阶段单独确定。
- 本规划不授权部署、push、真实用户邀请或数据库迁移执行。
