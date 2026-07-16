# ShanHaiEdu 新 Demo 交互设计吸收规范

日期：2026-07-15

状态：`accepted / design reference / implementation pending`

关联需求：`RQ-043`

关联权威口径：

- `docs\product\current-requirements-baseline.md`
- `docs\product\v1-1-assistant-ui-conversation-runtime-requirements.md`
- `docs\product\v1-agent-guided-response-presentation-requirements.md`
- `docs\product\v1-5-artifact-workspace-requirements.md`
- `docs\architecture\decisions\2026-07-13-adr-当前成果工作区替代常驻糖葫芦.md`

参考实现：本机独立目录 `shanhai-frontend-demo`。该目录是交互与视觉参考，不是产品业务真源、发布候选或第二条主线。

## 1. 决策

保留 `main` 作为唯一产品主线。吸收新 Demo 已验证优秀的 UI、布局、反馈、模式切换和动效表达，不复制其 fixture 后端、剧本状态、假能力或不合格响应式实现。

本次吸收不是换仓、换 Runtime 或重新设计业务流程，而是把主线已有真实能力放进更自然、更美观、更像智能工作台的教师界面：

- 减弱固定线性流水线的视觉暗示。
- 让中间对话保持主视觉，但不再机械重复完整流程。
- 用当前成果工作区承载阅读、审查、定位和局部返修。
- 让真实 Plan、Observation、HumanGate、Quality 和恢复状态以教师能理解的方式自然出现。
- 保留主线的 assistant-ui、MessagePart、事件恢复、权限、持久化、版本、费用和副作用门禁。

## 2. 吸收边界

### 2.1 必须吸收

| Demo 设计 | 要保留的体验 | 主线落点 | 数据边界 |
| --- | --- | --- | --- |
| 轻量左栏 | 更窄的项目导航、清楚的当前项目、低频操作渐进出现、归档与回收站不抢主视觉 | `ProjectSidebar`、`ProjectListItem` | 项目列表、生命周期和权限仍来自服务端 |
| 简洁顶栏 | 项目标题、当前真实状态、当前成果和全部成果入口；减少面包屑、固定阶段和工具按钮同时常驻 | `ConversationWorkbench` 顶栏 | 状态必须来自持久任务、计划或成果，不由前端猜测 |
| 动态计划条 | 只挂载当前有效计划和 revision；Replan 后自然替换，不强化固定 DAG | assistant-ui `plan` Part 的紧凑投影 | Main Agent 提议，PlanGuard 校验，前端只呈现 |
| 固定拍板区 | 唯一 PendingDecision 始终靠近输入区，可收起但不会因滚动丢失 | assistant-ui `human-input` Part 的 sticky projection | actionId、IntentEpoch、权限与费用仍由服务端验证 |
| 当前成果工作区 | 桌面可调宽、按主要成果自动打开、关闭后对话恢复宽度 | 替代常驻 `ArtifactSidePanel` 和糖葫芦 Rail 的正式外壳 | 只能由真实 artifact/version/presentation action 打开 |
| 全部成果抽屉 | 统一查找历史成果、版本和状态，不让教师理解节点链 | 复用现有成果分组、权限和抽屉能力 | 不改变 Artifact、版本和依赖真源 |
| 专用成果查看器 | PPT 按页、视频按镜头、教案按章节展示 finding、版本和局部操作 | `ArtifactWorkspace` 内按 kind 路由查看器 | finding 必须携带服务器 locator 和 evidenceRef |
| 反馈体验 | 入口低噪声但随时可达；分类、上下文、附件、失败保留和成功回执完整 | 复用 `FeedbackDialog` 与服务端反馈合同 | 不静默上传，不泄露对话、路径、Provider 或密钥 |
| 模型/生成模式切换 | 保留顺滑弹层、明确选中态、切换反馈、费用/强度提示和持久偏好 | `XiaoKuSettingsDialog`、生成强度控件 | 选项由服务端资格、账号权限和预算返回；不硬编码路由或密钥 |
| 短动效系统 | 面板滑入、计划更新、拍板条出现、hover/focus、拖动和状态切换自然连贯 | 全局 motion tokens 与组件状态 | 动效不制造业务成功，不替代真实 loading/progress |

### 2.2 视觉语言

- 以白色低噪声工作台为主体，保留山海绿，使用克制的珊瑚和琥珀表达关注与等待。
- 左右栏服务于对话和成果，不做厚重后台导航，不使用大 Hero、装饰性渐变或卡片套卡片。
- 卡片只用于真实消息块、成果条目、弹层和需要边界的工具；页面区块本身不漂浮成卡片。
- 常用字号保持 2 至 3 级，文字不依赖负字距和 viewport 字号缩放。
- 低频操作在 hover、focus 或更多菜单中出现；关键状态、HumanGate 和恢复入口不得隐藏。
- 图标优先使用现有 Lucide，陌生图标提供 tooltip 和可访问名称。

### 2.3 动效口径

- 普通 hover/focus：约 `120-180ms`。
- 面板、抽屉和折叠：约 `180-300ms`，使用统一 ease-out。
- 拖动宽度时关闭内部 hover 响应，避免逐帧抖动；结束后再持久化宽度偏好。
- 新计划、实质 Replan、新 PendingDecision 和错误恢复入口可以有一次轻量入场，不循环吸引注意。
- 支持 `prefers-reduced-motion`；减少动效后功能和状态仍完整。
- 禁止用定时动画伪造 Tool 进度、模型思考、质量通过或成果完成。

## 3. 回复不再机械的责任分层

“回复机械”不能只靠换气泡样式解决，必须同时约束三个层次。

### 3.1 Main Agent 内容

- 普通问答自然、直接，不自动展开完整备课流程。
- 复杂任务优先说明已理解的目标、刚发生的关键结果、可靠证据和当前最有价值的下一步。
- Tool 成功或失败后基于 Observation 继续、修复、换路径或 Replan，不用固定模板宣布“下一节点”。
- 不逐轮复述全部任务背景、全量计划和所有已完成步骤。

### 3.2 Response Presenter

- 只组织教师可见层级，不重写事实、批准 HumanGate 或改变计划。
- 同一事实只保留一个主要呈现位置：当前计划用紧凑条，详细历史留在消息；当前 PendingDecision 只保留一个活动控制区。
- 长任务稳定执行时显示当前动作和最新 Observation；只有首次计划、实质 Replan、阻塞和完成时展开完整计划。
- 成果正文不重复塞进聊天，消息保留摘要、质量变化和“打开成果”。

### 3.3 assistant-ui Renderer

- 文本、计划、活动、成果引用、Quality、HumanGate、下一步和错误恢复全部从类型化 MessagePart 渲染。
- Renderer 可以调整密度、层级和动效，不能从自由文本推断页码、镜头、成果、成功状态或授权。
- 历史消息保持可读，当前活动状态靠近输入区；两者不能形成两套可点击授权入口。

## 4. 明确不吸收

- 不复制 `scenario-engine`、定时剧本、进程内项目状态或 Demo data source。
- 不新建第二套 assistant-ui Runtime、消息合同、API Client、项目状态源或 Artifact 状态源。
- 不通过“查看第 N 页”“继续下一步”等文字正则猜 locator、active artifact、actionId 或计划分支。
- 不把 `reviewableKinds` 等展示策略永久硬编码在前端；自动打开策略由服务器 presentation action 与真实引用决定。
- 不同时显示两套完整计划或两个活动 HumanGate；历史记录可以保留，但只能有一个当前操作入口。
- 不把客户端临时拼装的 Markdown、PPTX、ZIP、图片或视频标成正式交付。
- 不保留无实现按钮、`unsupported` 假入口、硬编码账号、演示身份或只在当前进程有效的持久状态。
- 不把 Provider、Base URL、API、模型路由、密钥、内部 Tool 或调试信息暴露给教师。产品级模式或模型名称只有在服务端明确允许时展示。
- 不保留固定 228px 左栏加最小 380px 成果栏在窄屏同时常驻的布局。
- 不为视觉升级改变 Main Agent 的 Tool 选择权、ActionPolicy、HumanGate、Quality Gate、费用或副作用门禁。

## 5. 主线组件映射

| Demo 参考组件 | 主线目标 | 处理方式 |
| --- | --- | --- |
| `WorkbenchSidebar` | `ProjectSidebar`、`ProjectListItem` | 吸收视觉密度、选中态、生命周期标签和渐进菜单，不复制数据源 |
| `WorkbenchTopbar` | `ConversationWorkbench` 顶栏 | 收缩常驻信息，把低频协作、反馈和管理动作放入合适菜单 |
| `PlanStrip` | assistant-ui plan projection | 读取当前有效 plan/revision；与消息内历史计划去重 |
| `PinnedDecisionBar` | assistant-ui human-input projection | 只投影服务端唯一 PendingDecision；自然语言和按钮进入同一解析链 |
| `ArtifactWorkspace` | 当前成果工作区 | 复用主线 Artifact、版本、QA、下载和权限，按 kind 加载专用查看器 |
| `ArtifactDrawer` | 全部成果抽屉 | 复用现有分组、状态聚合、历史版本和权限过滤 |
| `useResizablePanel` | 现有可调栏能力 | 统一尺寸 token、拖动行为和用户/设备偏好，不复制业务状态 |
| `XiaoKuSettingsDialog` | 主线设置与生成模式 | 吸收弹层、选中态和切换反馈，服务端继续决定可选项与风险 |
| Demo motion CSS | 主线 motion tokens | 提炼为小型统一 token，不整段复制全局 CSS |

核心消息 Adapter、事件游标和项目 MessagePart 合同已经与主线同源或高度兼容，后续应围绕现有合同迁移展示壳，不再复制一套协议。

## 6. 实施顺序

本文件只冻结吸收方向，不授权立即打断当前 V1-9/V1-10 主线。下一次正式前端阶段按以下顺序实施：

1. 先写特征测试，冻结主线真实数据、权限、MessagePart、HumanGate 和 Artifact 行为。
2. 收缩左栏、顶栏和固定五阶段视觉，保留真实项目与管理能力。
3. 接入动态计划条、单一拍板区和自然回复层级，删除重复活动控制。
4. 建立当前成果工作区和全部成果抽屉，先支持只读、版本、QA 与局部 locator，再进入编辑能力。
5. 吸收反馈入口、模式切换和动效 token，逐项验证 loading、失败、恢复和 reduced motion。
6. 新工作区与真实能力达到等价后，再按既有 ADR 删除常驻 Rail；不得先删后补。

每个切片都必须使用主线真实接口和离线合同 fixture 验证，fixture 只能证明 UI 合同，不得写成真实 Provider 或产品 E2E 通过。

## 7. 特征测试与验收

### 7.1 桌面体验

- 1366x768、1440x900 下左栏、对话、当前成果工作区和输入区无重叠、截断或布局跳动。
- 关闭成果工作区后对话恢复完整宽度；重新打开保持合理宽度和焦点。
- 当前计划来自真实 plan/revision；Replan 后旧计划退出活动状态，不显示固定下一 Tool。
- 只有一个当前 PendingDecision；按钮和自然语言都不能绕过 actionId、IntentEpoch 和服务端验证。
- PPT 页、视频镜头和教案章节的 finding 使用结构化 locator 打开并支持受控局部返修。
- 模式切换展示真实可选项、费用/强度影响、保存成功或失败；刷新后与服务端状态一致。
- 反馈入口能携带经过授权和脱敏的项目、消息、计划或成果上下文；提交失败保留输入。
- 面板、弹层、折叠、hover 和状态变化流畅；`prefers-reduced-motion` 下无功能损失。

### 7.2 响应式边界

- 窄屏只显示“对话 / 当前成果”一个主面板，侧栏和全部成果使用抽屉或 Sheet，不强制三栏并存。
- 长标题、计划、HumanGate、模式菜单和反馈表单可以换行或安全滚动，不裁切主要操作。
- V1 发布前仍服从当前权威门禁，不新增 390px 真实 Agent 黑盒；保留响应式合同、静态布局检查和历史证据，真实窄屏产品验收按后续阶段执行。

### 7.3 真实性

- 所有数量、版本、状态、耗时和质量结论绑定真实服务端事实。
- UI 不生成 Artifact、不批准 HumanGate、不选择下一 Tool、不现场拼装正式交付。
- 两名教师的项目、计划、消息、成果、偏好、反馈和面板恢复状态完全隔离。
- 无 mock、placeholder、deterministic fallback 或 degraded 成果冒充完成。

## 8. 完成定义

只有同时满足以下条件，才能声称 Demo 设计已经被主线吸收：

- 主线仍是唯一工作目录、业务 Runtime 和状态真源。
- 左右栏、计划、拍板、成果工作区、反馈、模式切换和动效已经按本规范落地。
- 教师不再被固定线性节点视觉主导，Main Agent 的动态计划和 Replan 可被准确理解。
- 回复层级自然，当前动作、Observation、质量结论和下一步不会机械重复。
- Demo 中列出的硬伤没有随视觉代码进入生产路径。
- 受影响合同测试、TypeScript、生产构建和桌面浏览器验收通过。

## 9. 证据边界

2026-07-15 已使用相同桌面视口和同一组结构化项目数据对新 Demo 与主线进行浏览器对比。结论是：Demo 的设计方向、成果审查和动态控制面呈现更优；主线的真实接线、权限、持久化、测试和响应式更完整。

该审查只支持本文件的设计吸收决策，不证明 Demo 已具备生产能力，也不替代主线后续阶段的真实产品验收。
