# ShanHaiEdu 需求总账

更新时间：2026-07-13（V1 产品内编排与课程锚点主线收口）

> 本文件记录未完成需求、新增需求、延期需求和优先级。当前产品质量门禁仍以 `docs\product\current-requirements-baseline.md` 为最高产品口径；本文件负责把“还没做完、刚发现、需要拆分”的需求集中管理。

## 1. 状态定义

| 状态 | 含义 |
|---|---|
| `accepted` | 已接受，进入后续阶段规划 |
| `split` | 已接受但必须拆成多个阶段 |
| `deferred` | 暂缓，等待前置条件 |
| `blocked` | 被技术、资源或产品边界阻塞 |
| `done` | 已完成并有 closeout / 验收证据 |

优先级分档：

```text
上线门槛：邀请内测用户前必须完成
第一档：内测阶段优先收口
第二档：完成一轮内测后再评估，现阶段不实现
```

## 2. 上线门槛

### RQ-042 业务 Skill 标准反馈闭环

- 状态：`accepted / A23 contract and executor done / real product artifacts pending new V1-9`
- 来源：2026-07-15 产品 Owner 要求在工程测试中持续对照 `shanhaiedu-技能系统`，将发现的业务逻辑、质量标准和流程缺口回写为可复用 Skill 合同，而不是只修代码。
- 目标：业务 Skill 保留领域语义、正式产物合同和质量门，产品 Runtime 保留 Main Agent 的 Tool 选择、Observation/Replan、重试/停止、权限、费用、副作用和状态提升权。发现产品基线、上游 Skill、下游 Skill 或执行器之间的标准漂移时，先写跨边界红测，再按版本规范升级现有 Skill；只有产生独立稳定产物且现有职责无法承载时才新增 Skill。
- 当前事实：A23已将`shanhai-imagegen 1.1`、`shanhai-video-generation 1.1`、`shanhai-delivery 1.3`正式Schema及图片、视频、PPT和最终包Adapter接入产品Runtime；失败原子保存ValidationReport/Observation且Artifact为0。剩余验收只是在A23新V1-9中证明真实产品产物与正式合同一致，不再重复开发Schema执行层。
- 验收：旧 Skill 版本保留；版本化升级图片、视频执行和一致交付合同，移除 Skill 内的 Provider 选择、fallback、重试和停止语义；新活动版本、注册表、Schema、校验器、渲染器、发布包与 Runtime 投影一致。产品必须在 Tool 成功提交前通过明确 Adapter 形成正式 Skill payload 并执行 Draft 2020-12 Schema；失败原子留下 ValidationReport 与 Observation，Artifact 为0。`create_final_package` 只在 Main Agent 选择该 Tool 后加载去编排权的交付语义 slice；不得现场拼包、自动选择最新版/未批准版、扩大 HumanGate 或调用 Provider。

### RQ-041 V1 图片生产统一使用 MiniMax

- 状态：`accepted / required for new A23 V1-9 preflight and real image acceptance`
- 来源：2026-07-15 用户明确要求“图片一律采用 MiniMax 进行生成”；业务 Skill 权威源仍为既有 `ShanHaiEdu-Studio\shanhaiedu-技能系统`，未切换到 `ShanHaiEdu-Conversion-Studio`。
- 目标：Main Agent 继续自主选择图片类高层业务 Tool，并只在选择该 Tool 后加载 `shanhai-imagegen`；Skill 只增强领域输入与质量约束，不选择 Provider 或下一 Tool。图片执行由服务端 Adapter 从 API 台账 `image_generation` 能力读取 MiniMax 凭据与模型，调用 MiniMax 原生图片接口。
- 禁止：V1 图片生产不得静默切到 `free`、`free_primary`、`primary`、`myself_fallback` 或其他图片 Provider；不得读取 Skill 私有密钥、调用裸 Provider、CLI fallback、placeholder 或 degraded 图片冒充成功。
- 验收：preflight、capability availability、运行时配置和结果血缘均绑定 `minimax`；API 台账公开/私有校验通过；真实 smoke 只在新的 MiniMax 通道健康证据门允许时执行一次并回写脱敏台账证据。

### RQ-040 互动课件规格与课堂活动模块基础

- 状态：`accepted / split / isolated foundation`
- 来源：2026-07-14 产品 Owner 指令；外包交付的互动课前端 MVP 仅含 Mock API 和静态构建包，需在 Studio 产品主线建立真实后端归属。
- 目标：以现有 `Project`、Artifact、质量门和 Agent Runtime 为基础，建立教师可编辑、可校验、可版本化的互动课件规格；后续由课堂运行端和课件共创智能体共同消费。
- 首切片：新增 `interactive_courseware_spec` Artifact 合同与确定性校验。输入为已批准的 `lesson_plan`，输出包含页面、活动、题目、答案判定、教师提示、时长和教学目标映射的结构化规格。规格校验通过只代表“可供后续编辑/运行”，不代表已经发布、已有学生答题数据或实时课堂可用。
- 必须复用：Project 授权、Artifact 版本化、Node Contract、ToolRouter、ValidationReport、Quality Gate、Conversation/Agent Runtime；不得另建账号、项目、Provider、文件存储、Agent Runtime 或课堂数据真源。
- 不纳入首切片：真实学生数据、实时 WebSocket、积分排名、课堂控制、白板、真实 Provider 调用、自动发布、未成年人数据出境。
- 验收：有效规格可被保存为项目内版本化 Artifact；无活动、重复 ID、不可判定答案、无教学目标映射或缺少结束条件的规格必须被拒绝；所有失败以结构化 locator 返回；项目权限、Artifact 审批和现有 V1 主线行为不回归。
- 需求规格：`docs\product\2026-07-14-interactive-courseware-requirements.md`。
- 阶段与测试：`docs\stages\interactive-courseware-spec-foundation-plan.md`、`docs\stages\interactive-courseware-spec-foundation-test-plan.md`。

### RQ-038 Main Agent 自主编排与 HumanGate 职责纠偏

- 状态：`accepted / R0-R5 and A10-A23 passed / immutable run-state v2 implemented / full preflight and new A23 V1-9 pending / blocks public cutover`
- 来源：2026-07-13 最新真实项目对话与截图验收；项目 `cmrj7iqm8001pboezl97iacic` 的 38 条消息连续形成 8 个 requirement spec，未推进到教案、PPT 或视频。
- 问题：Main Agent 已理解教师目标，但结构化输入在内部 Tool 边界丢失；22 个 Capability 全部要求逐 Tool 确认，执行确认与产物批准混用；业务 Tool 未进入 Main Agent 连续 ReAct，Tool 成功后又被强制停回 HumanGate；Runtime 失败还能静默形成 deterministic 草稿。
- 产品目标：明确的完整交付请求形成持久 `TaskBrief + IntentGrant`，在预算/积分策略已披露、被账号接受并绑定版本后，授权标准预算内的可逆内部动作；Main Agent 自主选择高层业务 Tool、Observe、Replan 和定点返修；HumanGate 只处理不可推断选择、无有效预算披露、超预算/最高强度、外发、权限、覆盖删除和教师明确要求的检查点。
- 必须完成：
  - “继续/确定”不覆盖完整任务，Tool 始终收到结构化目标、IntentEpoch、计划 revision、强度快照、授权、预算披露版本和幂等键。
  - 质量验证、独立审查、下游可用和教师签收拆分，不再由 `isApproved` 同时承担。
  - 白名单高层业务 Tool 对 Main Agent 可发现并可连续执行；原始 Provider、数据库、密钥和状态提升继续由系统 Guard 控制。
  - 生产路径禁止 deterministic/degraded fallback 冒充成功；超时、解析和校验错误可分类、可有限重试、可恢复。
  - 修复裸 Markdown、历史成果引用消失、强度状态错位、窄屏文字裁切和持久处理状态。
  - 两名教师不同项目并行时，TaskBrief、IntentGrant、PendingDecision、IntentEpoch、强度、费用、任务和产物完全隔离。
  - V1-9每次新运行开始前采用最新已验收`main`、需求基线、活动Registry、Runtime Projection、Binding Policy和Provider台账，并把非敏感摘要一次性冻结到manifest；运行内禁止静默升级。旧运行只读保留，合同实质变化只能终止当前run并以显式前序关系创建新run。
- 验收：一句话 PPT 与完整材料包不再逐节点确认；自然语言暂停、改道和局部任务正确；没有有效预算披露时零付费调用，真正风险仍零越权；产品 Main Agent 独立生成同一版本的结构化教案、真实 PPTX、课堂视觉图、完整 MP4、`ClassroomRunSpec`及manifest/hash一致ZIP；外部 Codex 只做成包后黑盒审核；P0=0、全量测试/构建/桌面通过、至少一名教师签收。V1发布前不运行新的390px真实黑盒，既有窄屏合同证据保留，V1发布后另行安排。
- 阶段计划：`docs\stages\local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-plan.md`。
- 测试计划：`docs\stages\local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-test-plan.md`。
- V1-9唯一运行计划：`docs\stages\local-real-v1-v1-9-unique-real-product-e2e-plan.md`。
- V1-9唯一运行测试：`docs\stages\local-real-v1-v1-9-unique-real-product-e2e-test-plan.md`。
- 版本关系：V1-3至V1-8的历史重开项已由R5和A10-A23收口；V1-9A-G、V1-10A-G的独立底座证据保留。旧V1-9运行只保留历史失败证据，A23新运行承担唯一真实完整包验收。

### RQ-008 内测反馈中心

- 状态：`accepted`（工程实现完成，生产发布门禁待关闭）
- 来源：2026-07-10 上线前新增需求。
- 问题：当前点赞/点踩只显示“反馈入口暂未开放”，没有真实保存；用户也不能直接粘贴截图。
- 目标：上线内测前提供引导式反馈中心，支持分类、预制提示、文字描述、图片选择和剪贴板图片粘贴，并保存到服务端持久化位置。
- 必须分类：页面/视觉、功能异常、内容结果、操作不清楚、功能建议、性能问题、其他。
- 验收：
  - 任意主要工作台页面都能打开反馈入口。
  - 支持 `Ctrl+V` / `Cmd+V` 直接粘贴截图，并显示预览、删除和错误提示。
  - 反馈元数据保存到数据库，图片保存到配置化持久化存储；刷新后仍存在。
  - 提交成功返回反馈编号；失败保留描述和图片，可重试。
  - 公网内测使用密码认证和邀请制账号；普通教师不能读取他人反馈，管理员可受控查看和导出。
- 需求文档：`docs\product\beta-feedback-requirements.md`。
- 阶段与测试：`docs\stages\local-real-mvp-m67-beta-feedback-center-plan.md`、`docs\stages\local-real-mvp-m67-beta-feedback-center-test-plan.md`。
- 建议阶段：M67，先于邀请内测用户。
- 收尾证据：`docs\stages\local-real-mvp-m67-beta-feedback-center-closeout.md`。

## 3. 第一档需求

### RQ-043 新 Demo 交互设计吸收与非线性工作台升级

- 状态：`accepted / split / required input for the next frontend implementation`
- 来源：2026-07-15 产品 Owner 对 `shanhai-frontend-demo` 与当前主线的同视口浏览器评审，明确要求保留 Demo 更美观、非线性、丝滑的左右栏、反馈、模型/生成模式切换、动效和成果审查体验，但不保留其 fixture、假能力、文本猜测和响应式硬伤。
- 决策：`main` 继续作为唯一产品主线、assistant-ui Runtime、消息合同和业务状态真源；Demo 只作为交互与视觉参考。后续前端阶段必须把优秀展示映射到主线真实 API、Artifact、HumanGate、Quality、权限、版本、费用和副作用合同，不复制第二套数据源或编排流程。
- 目标：减弱固定线性流水线的视觉暗示，让动态 Plan/Replan、Observation、单一 PendingDecision、当前成果、局部返修、反馈与模式切换自然可见；同时分层修正机械回复，不能只换气泡外观。
- 不吸收：剧本引擎、前端定时伪进度、客户端假持久化、硬编码 `reviewableKinds`、通过文字正则推断 locator/action、重复计划或 HumanGate、未实现按钮、现场拼装正式交付、窄屏强制三栏和任何 mock/degraded 成果。
- 时序：本轮只冻结设计权威，不打断当前 V1-9/V1-10；下一次正式前端实施必须先读取吸收规范并写真正会失败的特征测试，再分切片迁移。V1 前不新增 390px 真实 Agent 黑盒，响应式合同与静态布局检查继续保留。
- 详细规范：`docs\ui\frontend-workbench\2026-07-15-frontend-demo-design-absorption.md`。
- 验收：主线仍为单一状态源；桌面布局、动态计划、单一拍板、专用成果工作区、反馈、模式切换与 reduced-motion 通过；回复不机械重复；两用户隔离、权限、版本、门禁和真实交付能力无回归；Demo 硬伤未进入生产路径。

### RQ-021 统一基础交互设计系统

- 状态：`done`（工程、常用浏览器路径和 M77 owner 写路径均已验证）
- 来源：2026-07-11 基础列表、下拉框、表单和浮层一致性审查。
- 目标：用小型、可组合的 UI primitives 统一高频交互，同时保持业务语义、权限枚举、回调和后端合同不变。
- 统一约束：对象选择列表 hover 只改变背景、边框、文字和图标颜色，禁止位移、缩放、扩张、左侧竖线和 hover 阴影；Select 使用大圆角触发器、青色 open 状态、Popper 下方弹层、整行选中与右侧勾选；Input、Textarea、MenuItem、Popover、Tooltip、Dialog、Sheet 共享语义化边框、焦点和 elevation tokens。
- 范围：新增 Input 与 MenuItem；迁移指定普通表单输入、反馈 textarea 和菜单项；收敛 InteractiveListRow、Select 和浮层 primitives；保留隐藏 file input、PromptComposer 复合输入、tabs、chips、radio 和消息交互。
- 验收：M78 源码合同、旧 M75/M76/M77 合同、TypeScript、单 worker 全量测试、生产构建和 diff check 通过；浏览器由主代理验收。
- 阶段与测试：`docs\stages\local-real-mvp-m78-unified-ui-system-plan.md`、`docs\stages\local-real-mvp-m78-unified-ui-system-test-plan.md`。

### RQ-020 表单下拉框视觉与交互统一

- 状态：`done`（自动化、真实 owner Select 展开、键盘选择、保存、刷新恢复和 390px 弹层均已验证）
- 来源：2026-07-11 协作成员权限下拉框体验反馈。
- 问题：成员权限和账号角色仍使用浏览器原生 `select`，展开样式与山海课伴品牌、焦点反馈和弹层语言不一致。
- 目标：统一使用项目 Select 组件，提供品牌化悬浮、选中、展开和键盘焦点状态，同时保持权限值与真实回调不变。
- 验收：源码不再存在原生 `<select>`；成员新增、成员权限更新和账号角色选择均接入统一 Select；TypeScript、定向测试和构建通过。
- 阶段与测试：`docs\stages\local-real-mvp-m77-select-polish-plan.md`、`docs\stages\local-real-mvp-m77-select-polish-test-plan.md`。

### RQ-019 面向教师的交互列表行统一

- 状态：`done`
- 来源：2026-07-11 欢迎页最近项目行交互确认。
- 问题：欢迎页、项目侧栏和成果抽屉的主列表行各自维护 hover、selected、focus 和按下状态，张力粒度与窄屏约束不一致。
- 目标：封装低耦合的交互列表行，仅统一“进入详情/选择对象”的主列表行；保留破坏性确认、表单选项、tabs、chip、纯菜单项、消息气泡和按钮组的既有交互。
- 统一约束：hover 只改变背景、边框、文字和图标颜色，禁止位移、缩放、扩张、左侧竖线和 hover/selected 阴影；selected/active 静态颜色清楚，attention 使用可读颜色语义，focus-visible 清晰，触控目标不小于 44px，disabled 不响应 hover。
- 范围：新增 `InteractiveListRow`；迁移欢迎页最近项目、非 collapsed 项目主选择行和成果 drawer 行；不迁移项目菜单/重命名、rail 图标、成员/用户静态管理行、反馈分类与 ProfileMenu 菜单。
- 边界：不修改后端、真实回调、认证、对话生成或反馈服务；项目窄侧栏不得因整体横移产生横向滚动，菜单按钮不得触发项目选择。
- 验收：M76 定向合同覆盖组件 API、视觉状态、selected/disabled/focus/reduced motion、三个接入点、菜单阻止冒泡及不适当批量迁移；TypeScript、全量测试、构建和 diff check 通过；浏览器由主代理验收。
- 阶段与测试：`docs\stages\local-real-mvp-m76-interactive-list-row-plan.md`、`docs\stages\local-real-mvp-m76-interactive-list-row-test-plan.md`。
- 收尾证据：`docs\stages\local-real-mvp-m76-interactive-list-row-closeout.md`。

### RQ-018 登录后欢迎首页与主动项目进入

- 状态：`done`
- 来源：2026-07-11 登录后工作台进入方式确认。
- 问题：认证成功或刷新后，工作台会读取浏览器保存的项目并自动恢复旧对话，教师没有机会先判断本次要准备哪节课。
- 目标：登录或刷新后先显示安静的品牌欢迎首页；只有教师主动新建或选择最近项目后，才加载并进入项目对话。
- 产品决策：
  - 启动时只读取 active 项目列表，不读取 `activeProjectId` 本地记录、不抓取项目 snapshot、不默认选择第一项。
  - 欢迎首页提供“开始新的备课”和最多 4 个“继续最近项目”；无项目时只保留新建入口。
  - 左侧项目列表保持可用但不高亮旧项目；归档和回收站视图不自动进入项目。
  - 主动打开项目后仍可记录最近项目，但该记录不得用于启动恢复。
  - 欢迎页只使用一次性低幅度淡入，并遵守 `prefers-reduced-motion`。
  - 不修改认证 API、项目后端、对话数据或历史项目，不清除用户项目。
- 验收：
  - 初始化后 `activeProjectId`、消息、产物和任务为空，列表加载完成后 `loadState` 为 `ready`。
  - 登录或刷新不会读取 active 项目本地记录，也不会自动请求任何项目 snapshot 或显示旧对话。
  - 主动点击最近项目调用 `selectProject`；主动新建调用 `createProject`，失败时不误切入空对话。
  - 无 active 项目时中间仅显示欢迎首页，右侧产物阅读区与 rail 不显示且不占位；项目进入后恢复对话与产物区域。
  - 最近项目最多 4 项，展示标题、meta/currentStep 和更新时间；无项目空态、移动端与 reduced motion 有自动化合同覆盖。
- 阶段与测试：`docs\stages\local-real-mvp-m75-authenticated-welcome-plan.md`、`docs\stages\local-real-mvp-m75-authenticated-welcome-test-plan.md`。
- 收尾证据：`docs\stages\local-real-mvp-m75-authenticated-welcome-closeout.md`。

### RQ-017 品牌化认证入口

- 状态：`done`
- 来源：2026-07-11 登录/注册入口品牌体验确认。
- 问题：现有密码认证页只有基础表单，缺少山海教育品牌识别、具体产品定位和适合教师使用情境的响应式入口体验。
- 目标：面向小学教师提供简约高级、温柔专业的品牌化登录/创建账号页面，让教师明确登录后会回到自己的备课项目，同时不改变认证合同与生产注册门禁。
- 产品决策：
  - 桌面采用约 54% 封面与 46% 认证区的双栏布局；封面使用既有品牌图片和克制的深蓝底部遮罩，不做营销页、渐变大屏、玻璃拟态或悬浮卡片。
  - 母品牌保留“山海教育”，产品品牌统一为“山海课伴”；认证区使用原版山海教育 Logo 和“山海课伴 / 山海教育 · AI 备课工作台”的品牌签名，登录/创建账号标题动态切换，模式切换具备 `aria-pressed`。
  - 登录页首次进入提供一次性低幅度欢迎动效和“今天也一起，从容备好一节课”提示；登录提交态明确显示正在进入备课空间；全部动效遵守 `prefers-reduced-motion`，不得循环播放。
  - 保留账号、显示名（仅注册）、密码的字段顺序，以及自动聚焦、自动填充、错误、提交中和禁用行为；注册入口只在运行时 `registrationEnabled` 开启时出现。
  - `lg` 以下隐藏桌面封面，改用约 140-180px 横向品牌图头；小屏不横向溢出，主要按钮触控高度不低于 44px。
  - 只陈述项目与材料的真实可见范围，不虚构加密、学校背书或未实现能力。
- 验收：
  - Logo、封面、三段具体定位文案、动态标题和返回个人备课项目说明可由源码合同测试验证。
  - 注册门禁、字段顺序、`aria-pressed`、自动填充、移动/桌面布局和可信说明具备自动化覆盖。
  - 不修改 `onLogin` / `onRegister` 合同、认证服务或 API，不增加依赖。
  - 定向测试、认证测试、TypeScript、全量测试、生产构建和 `git diff --check` 通过；浏览器验收由主代理另行执行。
- 阶段与测试：`docs\stages\local-real-mvp-m74-branded-auth-page-plan.md`、`docs\stages\local-real-mvp-m74-branded-auth-page-test-plan.md`。
- 收尾证据：`docs\stages\local-real-mvp-m74-branded-auth-page-closeout.md`。

### RQ-016 产物能力导航与安静抽屉

- 状态：`done`
- 来源：2026-07-11 产物导航与抽屉体验确认方案。
- 问题：桌面窄 rail 按产物数量逐个绘制圆形节点，项目产物增多后形成“糖葫芦串”并可能溢出；移动抽屉仍使用线性节点语言、大下拉和时间线式列表，预览卡与阅读区动作密集、视觉层级突兀。
- 目标：把产物入口稳定收敛为教案与教材、PPT、图片、视频、最终交付五类能力及“全部产物”，按组聚合需处理状态；单产物直接阅读，多产物进入安静的分组抽屉。
- 产品决策：
  - 桌面 rail 固定最多 6 个入口，不随产物数量增长；能力入口约 44px，并提供 tooltip、aria-label、数量和可读聚合状态。
  - 聚合状态按 `blocked > needs_review/stale > in_progress > approved > not_started` 取最需关注项，不只依赖颜色表达。
  - 抽屉标题统一为“备课成果”，使用紧凑能力 chips 和安静列表行；完整覆盖空项目与筛选无结果。
  - 从成果抽屉进入完整详情时必须保留来源分组；详情提供“返回备课成果”和“关闭”两个独立动作，返回恢复原分组，关闭直接回工作台。
  - hover 预览不与侧边阅读或抽屉同时出现；预览默认只保留“打开阅读”主动作，复制、作为输入、下载保留在真实阅读/详情区域。
  - 不修改后端、产物数据契约、对话认证和反馈行为，不引入图标或 UI 新依赖。
- 验收：
  - 任意数量产物在桌面 rail 只显示有内容的能力组及“全部产物”，总入口不超过 6 个。
  - 能力映射、状态聚合、单项直开、多项抽屉、全部入口、drawer 筛选、空态、aria/tooltip 有自动化测试。
  - 移动/窄屏可见标题不含“线性产物”，列表不再逐项绘制圆点或时间线。
  - 从任一分组进入详情后无需关闭重开即可返回刚才的成果分组；直接从侧边阅读进入详情时不显示误导性的返回入口。
  - 定向测试、TypeScript、全量测试、生产构建和 `git diff --check` 通过；桌面与窄屏浏览器需实际验收，登录阻塞时明确记录。
- 阶段与测试：`docs\stages\local-real-mvp-m73-artifact-capability-navigation-plan.md`、`docs\stages\local-real-mvp-m73-artifact-capability-navigation-test-plan.md`。
- 收尾证据：`docs\stages\local-real-mvp-m73-artifact-capability-navigation-closeout.md`。

### RQ-015 非线性按需生产、多用户内测与反馈体验收口

- 状态：`control-plane behavior closed by R5 and A10-A23 / full real delivery pending new V1-9`
- 来源：2026-07-11 用户真实使用反馈。
- 问题：反馈类型切换会动态插入“快速补充”并改变弹窗高度和滚动位置；消息赞踩缺少明确结果提示；自然语言确认与直接工具意图仍可能被 HumanGate 错误阻断；已有多用户能力缺少真实双账号和历史数据归属验收。
- 目标：允许教师从任意可用能力切入，模型负责理解目标、选择工具和解释缺失输入，不强迫从固定线性节点开始；明确完整任务通过已披露、版本绑定的任务级授权覆盖标准预算内真实生成，不可逆写入、外发、权限变化、超预算和最高强度仍需必要安全确认。
- 产品决策：
  - 反馈类型切换不得改变弹窗主要结构、视口高度或滚动位置；快速补充区域始终占位，仅替换内容。
  - 点赞和点踩保存后给出短暂、可访问的正向/负向提示；取消评价也有提示。
  - 需求整理、结构化草稿、内部审查和任务授权范围内的真实生成不逐Tool要求HumanGate；外部写入、权限变化、破坏性动作、超预算和最高强度仍需明确确认。
  - 自然语言明确任务形成或更新TaskBrief；“继续”只在唯一active任务或唯一PendingDecision下解释，不能覆盖原目标或扩大授权，否则具体消歧。
  - 教师可直接请求视频脚本、分镜、PPT 大纲、教案等任一能力；缺少硬前置时只补最小必要材料，不强迫走完整线性链路。
  - 密码账号的数据按 owner / membership 服务端隔离；现有本地项目可受控绑定到指定账号，迁移不删除项目和产物。
- 验收：
  - 桌面和 390px 下切换所有反馈类型，弹窗外框、底部操作区和当前滚动位置稳定。
  - 赞、踩、取消评价均有提示，刷新后评价状态恢复。
  - “确认需求并生成大纲”“只做视频脚本”“先生成分镜”等自然语言不再进入无解确认循环。
  - 无 pending action 的直接工具请求能执行低副作用能力，或生成一个真实可确认 ActionOffer，而不是返回“没有有效确认”。
  - 两个密码账号之间无法读取对方未共享的项目、消息、产物、下载和反馈。
  - 指定账号可登录并看到迁移后的历史项目；密码不写入源码、文档、日志或响应。
- 阶段：M72，拆为反馈体验、对话控制、账号归属与真实内测审查四个实施切片。
- 收尾证据：`docs\stages\local-real-mvp-m72-nonlinear-beta-readiness-closeout.md`。

### RQ-012 多用户与用户管理

- 状态：`done`（工程实现完成；真实用户开放统一等待V1-9产品内E2E与V1-10发布门，不再单列前段Provider smoke）
- 来源：2026-07-10 用户指定 M67 后的下一阶段需求。
- 已有基础：M67 已具备 `LocalUser`、密码认证、管理员/教师角色、持久会话、项目成员关系、关闭公开注册、管理员 bootstrap、教师 invite API/CLI 和脱敏审计。
- 问题：当前准入能力仍以脚本和单次邀请为主，缺少可供管理员日常使用的用户列表、状态管理、角色管理、会话撤销和项目归属检查；不能把“能创建两个测试账号”当作完整多用户产品能力。
- 目标：让多个不同用户安全登录并使用系统，由管理员受控管理账号，同时保证项目、对话、产物和反馈按用户/成员关系隔离。
- 验收：
  - 管理员可查看、搜索、邀请、启用/停用教师账号，并安全重置登录凭据；任何响应、日志和审计不回显明文密码。
  - 教师只能访问自己拥有或被明确加入的项目、对话、产物和反馈；跨用户 ID 伪造必须被拒绝。
  - 角色变更、账号停用和密码重置会撤销既有会话，并写入脱敏审计。
  - 公开注册保持关闭；普通教师不能调用用户管理接口，也不能提升自身角色。
  - 桌面和窄屏具备可用的管理员用户管理入口，并有真实多账号 E2E 证据。
- 不纳入：组织架构、学校多租户、SSO、社交登录、计费和复杂 RBAC；这些能力需要单独需求判断。
- 阶段与测试：`docs\stages\local-real-mvp-m69-beta-user-management-plan.md`、`docs\stages\local-real-mvp-m69-beta-user-management-test-plan.md`。
- 收尾证据：`docs\stages\local-real-mvp-m69-beta-user-management-closeout.md`。

### RQ-009 M54-A 前端聊天式工作台未完成项

- 状态：`split`
- 来源：用户页面参考图及 M54-A 正式规格、路线和测试计划。
- 已有基础：自动滚动、输入框自适应、生成提示、快捷回复、消息操作、Logo、糖葫芦交付链、Markdown 阅读、头像菜单、M67 真实反馈弹窗和 M70 首次欢迎态/附件/工具菜单收口。
- M70 已完成：首次欢迎态、附件拖放、截图粘贴、PDF/DOCX/图片真实状态、工具菜单、假入口清理和桌面/390px 响应式验收。
- 未完成重点：真实 token streaming、PDF/DOCX 自动解析、OCR/图片文字识别；这些能力不能在界面中伪装为已接通。
- 当前决策：第一档 UI 收口已完成；真实流式和文档解析能力后置到独立阶段。
- 需求文档：`docs\product\frontend-workbench-priority-requirements.md`。
- UI 状态：`docs\ui\frontend-workbench\local-real-mvp-m54a-open-items.md`。
- 阶段与测试：`docs\stages\local-real-mvp-m70-frontend-workbench-polish-plan.md`、`docs\stages\local-real-mvp-m70-frontend-workbench-polish-test-plan.md`。
- 收尾证据：`docs\stages\local-real-mvp-m70-frontend-workbench-polish-closeout.md`。

### RQ-014 项目生命周期与工作台反馈体验

- 状态：`done`
- 来源：2026-07-11 本地产品验收反馈。
- 问题：反馈选项的选中态辨识度不足；轻量问候时助手回复过度罗列固定流程；左侧项目不支持重命名、归档、删除和恢复，回收站入口缺失。
- 目标：在不重做三栏工作台的前提下，补齐反馈控件状态、自然对话开场、项目标题编辑、归档、软删除和恢复能力。
- 产品决策：
  - 项目标题支持双击编辑和 hover 铅笔图标编辑。
  - 项目菜单提供重命名、归档、移入回收站。
  - 归档与删除是两个独立生命周期状态，不复用项目业务进度状态。
  - 删除只进入回收站并支持恢复；本阶段不提供永久物理删除，不清理本地产物文件。
  - 回收站固定在侧栏底部，已归档入口位于回收站上方。
  - 轻量问候回复保持自然简短，不主动罗列完整生产链路；用户提出明确任务后再给出下一步计划。
- 验收：
  - 反馈类型、快速补充和影响程度具备清晰且可访问的默认、hover、focus、selected 状态。
  - 项目 owner 和成员角色 owner 可重命名、归档、移入回收站和恢复；editor/viewer、非成员和未加入项目的系统 admin 被服务端拒绝。
  - 普通项目列表不出现已归档或已删除项目；归档和回收站列表互相隔离。
  - 重命名支持双击、铅笔图标、Enter/失焦保存和 Escape 取消；空标题和超长标题不会覆盖原值。
  - 删除后的项目可从回收站恢复，项目对话、产物和成员关系保持不变。
  - 跨标签页旧请求不能覆盖新标题或重复改变生命周期；queued/running 项目在任务完成或对账前不能归档或删除。
  - 桌面和 390px 窄屏均可完成重命名、归档、删除和恢复。
- 需求与设计：`docs\product\2026-07-11-project-lifecycle-and-feedback-polish-requirements.md`。
- 建议阶段：M71A，不与 M71 视频结构化前置链路混合提交。
- 收尾证据：`docs\stages\local-real-mvp-m71a-project-lifecycle-feedback-closeout.md`。

### RQ-001 自然语言确认与改道执行

- 状态：`accepted`
- 来源：2026-07-10 截图反馈；用户输入“直接开始做视频”但系统回复“没有有效确认”。
- 问题：当前系统只承认按钮传入的 `confirmedActionId`，不承认教师自然语言确认或改道。
- 目标：用户不点推荐按钮，也能通过自然语言确认当前计划、切换任务或请求继续执行。
- 验收：
  - 用户输入“直接开始做视频”时，不再回复“我还没有拿到这一步的有效确认”。
  - 如果视频前置材料不足，系统明确说明缺哪些材料，并给出下一步建议。
  - 模糊“继续”不能创建新授权；已有完整TaskBrief和有效IntentGrant时可继续预算内真实生成，超预算、外发、权限或破坏性动作仍需已披露影响后的显式HumanGate。
- 建议阶段：M68，与 RQ-011 合并实施。

### RQ-011 对话承诺与执行一致性

- 状态：`accepted`
- 来源：2026-07-10 对话截图；助手承诺回复“继续做视频/改做 PPT”即可执行，教师回复“我让你接着做啊”后仍被“没有有效确认”阻断。
- 问题：助手话术、上下文语义、quick reply 隐藏 actionId、pending plan 生命周期、PlanGuard 和失败状态作用域不一致。
- 目标：按钮和自由输入都能安全控制当前计划；多分支时具体消歧；改道会 supersede 旧计划；历史失败保留审计但不污染新分支。
- 验收：
  - 唯一active任务下，“我让你接着做啊”能在现有IntentGrant范围内继续正确计划；没有有效授权或动作超出预算/副作用边界时，先披露影响并进入HumanGate。
  - 多分支不明确时只追问“视频还是 PPT”，不显示“没有有效确认”。
  - 用户实质修改 quick reply 文本后，旧 actionId 不再授权原动作。
  - 助手只对真实 ActionOffer 承诺“回复一句即可执行”。
  - superseded 旧分支失败不阻断新分支，历史审计仍保留。
- 需求文档：`docs\product\conversation-commitment-execution-consistency-requirements.md`。
- 阶段与测试：`docs\stages\local-real-mvp-m68-conversation-control-plan.md`、`docs\stages\local-real-mvp-m68-conversation-control-test-plan.md`。
- 优先级：第一档；M67 反馈中心后与 RQ-001 合并实施。

## 4. 核心产品与交互需求

### RQ-002 视频结构化前置链路补齐

- 状态：`split`
- 来源：`current-requirements-baseline.md` 视频交付门禁。
- 问题：视频生成前必须有主题、脚本、资产图、分镜提示词、镜头时长、画面动作、旁白或字幕、课堂边界约束；当前链路仍未完全可真实执行。
- 目标：先形成移除教材知识任务和教师讲解依赖后仍成立的独立创意，再建立唯一最小课程锚点；儿童、教师或教室可以服务独立叙事，但不能由小学受众身份强制推出。根据当前WorldState补齐可被真实视频Provider使用的最小必要结构化前置，不把顶层交互固化成单向顺序。
- 验收：
  - 产品Main Agent能从当前已有合格产物切入；先验证独立创意，再形成唯一最小课程锚点，并按缺口补齐视频脚本、分镜、资产brief、资产图和片段计划。
  - 缺前置材料时不调用真实视频 provider。
- 建议阶段：V1-7视频内部编排闭环；真实媒体只在V1-9执行。

### RQ-003 PPTX 真实交付与 slideCount 门禁持续验收

- 状态：`accepted`
- 来源：`current-requirements-baseline.md` PPTX 真实交付门禁。
- 问题：PPTX 不能用文本 fallback、目标页数或文件名冒充真实交付。
- 目标：PPTX 必须是真实 zip、包含 `ppt/presentation.xml`，且真实 slideCount 等于目标页数。
- 验收：
  - 不合格 PPTX 不保存为真实完成态。
  - 下载按钮和状态来自真实校验结果。
- 建议阶段：作为每次 provider / final package 阶段的回归门禁。

### RQ-004 断点续跑与单项目生成锁

- 状态：`accepted`
- 来源：`current-requirements-baseline.md` 断点续跑与并发门禁。
- 问题：失败节点不能卡死整个项目；同一项目不能并发多个生成任务。
- 目标：失败保留可重试状态；队列和锁由后端控制，前端禁用只做体验优化。
- 验收：
  - 失败节点能继续、重试或改道。
  - 快速重复点击、跨标签页、多项目并发不会写乱状态。

## 5. 架构后续需求

### RQ-005 OpenAIRuntime native tool loop 主线接入

- 状态：`done`（首批 internal tools；provider 工具进入 native loop 另拆后续阶段）
- 来源：M65/M66-R runtime tool loop 规划。
- 问题：M65 已完成协议层和 `OpenAIRuntime` 可选接线，但尚未进入主链路。
- 目标：通过显式环境开关、单工具 allowlist、server-authoritative mapper 和无递归 `toolExecutionRuntime` 安全接入。
- 当前决策：M66-R 已通过显式开关接入生产 Runtime Factory，默认关闭；首批只暴露 internal capability tools，provider、阻断工具和真实最终包继续由后续真实工具金路径阶段处理。
- 关联文档：`docs\stages\local-real-mvp-m66-runtime-tool-loop-mainline-plan.md`。
- 收尾证据：`docs\stages\local-real-mvp-m66-runtime-tool-loop-mainline-closeout.md`。

### RQ-013 真实工具金路径闭环

- 状态：`technical tool golden path implemented / product-internal E2E deferred V1-9`
- 来源：M64-R / M66-R 收尾后剩余主线缺口。
- 当前事实：`asset_image_generate`、`concat_only_assemble`、工具层真实最终包和服务端resolved Artifact门禁已经实现并有历史真实链证据；尚未证明的是产品Main Agent自主规划、调用、审查、返修和成包。
- 目标：保留现有真实Tool金路径，在V1-9由产品Main Agent从教师UI独立完成一次真实任务；不在V1前段单独重复Provider smoke或外部编排整包。
- 验收：
  - `asset_image_generate` 生成真实、可校验、可保存的视频资产图产物。
  - `concat_only_assemble` 只按分镜顺序拼接已通过校验的视频片段，不重排、不加转场、不重写内容。
  - `final_package` 产出真实 ZIP/材料包，包含 PPTX、图片、视频、清单和校验 metadata，不再只是交付检查清单。
  - provider 工具只接受同项目、已批准、ID/kind/nodeKey 匹配的服务端 resolved Artifact。
  - V1-9使用一个真实公开课任务完成需求、教案、PPT设计、PPTX、图片、视频和最终材料包下载验收，运行中外部Codex干预为0。
- 优先级：历史工具底座已完成；产品内真实E2E统一延后到V1-9，当前下一阶段仍是V1-2封板。
- 阶段与测试：`docs\stages\local-real-mvp-m68-real-tool-golden-path-plan.md`、`docs\stages\local-real-mvp-m68-real-tool-golden-path-test-plan.md`。
- 收尾证据：`docs\stages\local-real-mvp-m68-real-tool-golden-path-closeout.md`。

### RQ-006 文档结构治理

- 状态：`done`
- 来源：2026-07-10 用户要求“需求、架构、主线、阶段开发分开”。
- 问题：历史阶段文档数量多，需求、架构、主线和阶段验收口径混杂。
- 目标：建立文档入口、需求总账、交互需求、架构 README、主线状态，不急于批量移动旧文件。
- 验收：
  - `docs\README.md` 清楚说明目录职责和权威级别。
  - `AGENTS.md` 写明项目文档结构规则。
  - 新增需求先进入需求总账，再进入阶段计划。
- 收尾证据：`docs\stages\local-real-mvp-doc-governance-closeout.md`。

## 6. V1 交付质量与邀请制上线需求

### RQ-022 执行身份、租约、幂等与恢复

- 状态：`done`（Stage 1A 执行身份/租约、Stage 1B 输入代际/幂等恢复、Stage 1C 原子提升与隔离均已完成）
- 来源：V1 Agent 与交付质量审计、当前断点续跑和并发门禁。
- 目标：后台任务携带真实 actor 和输入快照；同项目只允许一个有效写执行者；Provider 请求可去重、可恢复，旧结果不能覆盖新意图。
- 验收：
  - 缺失、停用或失效 actor 的后台写入 fail-closed。
  - 同项目并发只有一个有效 lease；不同项目可并发；旧 fencing token 无法提交。
  - GenerationJob 保存 idempotencyKey、inputHash、providerTaskId 和恢复状态；有 taskId 时只继续 poll，不重复付费提交。
  - 教师修改上游意图后，旧 epoch 结果保留审计但进入 quarantine，不成为当前有效 Artifact。
- Stage 1A 收尾：`docs\stages\local-real-v1-stage1a-execution-identity-lease-closeout.md`。
- Stage 1B 收尾：`docs\stages\local-real-v1-stage1b-input-idempotency-provider-recovery-closeout.md`。
- Stage 1C 收尾：`docs\stages\local-real-v1-stage1c-atomic-promotion-closeout.md`。

### RQ-023 可执行合同、质量决策与受控 ReAct

- 状态：`control-plane closed through A23 / full real delivery pending new V1-9`（Stage 2A至2C、R5真实桌面及A10-A23已关闭合同、Observation/Replan和单一编排；完整真实包轨迹仍由V1-9证明）
- 收尾证据：`docs\stages\local-real-v1-stage2a-contract-validation-closeout.md`、`docs\stages\local-real-v1-stage2b-quality-decision-closeout.md`、`docs\stages\local-real-v1-stage2c-observation-replan-closeout.md`。
- 来源：节点合同草案、RQ-015 非线性按需生产和当前 Agent Harness。
- 目标：Main Agent 基于 WorldState 执行有界 Observe、Plan、Guard、Act、Observe、Replan；合同和确定性门禁约束提交，不把顶层 Agent 固化成线性 DAG。
- 验收：
  - 关键节点具有可执行 pre/post contract、类型化错误 locator 和结构化 ValidationReport。
  - Critic 只评价语义与效果，不能覆盖文件、页数、hash、血缘、参考图实传等硬门。
  - 教师可在 Brief、大纲、视觉系统、PageSpec、样张、分镜、镜头和时间线处暂停、修改、改道或局部返修。
  - 达到步骤、费用、重试或时间预算时暂停并请求教师决定，不无限循环。

### RQ-024 PPT Quality 纵向闭环

- 状态：`production craft and control-plane orchestration proven / real editable deck pending new V1-9`（既有真实PPT证明工艺和Provider可行，R5/A10-A23证明控制面；不再要求前段追加固定真实任务）
- 来源：用户提供的 PPT V8 手册、PPT 生产工艺设计和现有 PPTX 真伪门禁。
- 目标：从教材证据、叙事大纲、视觉系统、逐页 PageSpec、关键样张和正式资产，生成真实可编辑 PPTX，并支持页级返修。
- 验收：
  - 教材主张可追溯；每页具备独立教学作用、布局、视觉、素材和教师动作。
  - 样张批准后再批量生产；批准资产真实嵌入，精确信息保持可编辑。
  - PPTX、PDF、逐页 PNG 和 contact sheet 页数一致；最终真实试点至少包含一套 12 页 PPTX。
  - 问题精确定位到 pageId/assetId；修一页不重跑整套。

### RQ-025 视频 Full Intro、独立创意与课程锚点闭环

- 状态：`technical pipeline and control-plane orchestration proven / real final video pending new V1-9`（既有视频证明Provider、镜头生成与合成链，R5/A10-A23证明控制面；课程锚点失败包保留为负例）
- 来源：用户提供的《视频工作流制作手册V1.0》、视频工艺设计和现有视频门禁。
- 目标：先形成移除教材知识任务、PPT结构和教师讲解依赖后仍成立的独立创意，再用唯一最小课程锚点回接学习任务，形成 Beat、ShotSpec、视频专属参考资产、逐镜头任务、音字后期与真实合成，并支持镜头级恢复和返修。儿童、教师或教室可以服务独立叙事；课程锚点不得被扩大成小学课堂世界观，也不得因为受众是小学生就强制儿童主角、教室场景或课堂教学活动。
- 验收：
  - 产品内`delivery_critic.review(domain="video", stage="course_anchor")`执行六硬门审查；Main Agent依据CriticReport自主Replan或触发HumanGate，外部Codex不代做选案、批准和返修决策。
  - 合成后由产品内`delivery_critic.review(domain="video", stage="video_final_review")`读取真实MP4、字幕或转写、采样帧、音轨和时间线证据，复核独立创意与唯一最小课程锚点没有在生成中漂移；finding定位到`shotId`、时间范围或字幕/音轨片段，Main Agent只返修受影响组件。
  - 每个镜头独立绑定 shotId、inputHash、providerTaskId、参考资产和验收条件。
  - 需要连续性的镜头能证明参考资产真实进入 Provider 请求；PPT 资产不得冒充视频参考资产。
  - 单镜头失败、重启或返修不重跑全片；FFmpeg 合成结果与 TimelineManifest、ffprobe 一致。
  - QA 覆盖独立创意、最小课程回接、教材/PPT动画化、课堂/儿童角色强绑定、答案泄露、儿童安全、连续性、字幕、音轨和技术参数。

### RQ-026 整堂课一致性、最终包与邀请制上线

- 状态：`new A23 V1-9 immutable-run preflight in progress / release pending V1-10`
- 来源：V1 快速上线目标和当前最终材料包真伪门禁。
- 目标：教案、PPT、视觉图和视频形成可上课的同一版本；前段以产品内编排证据为主，收尾时由产品Main Agent完成一次真实交付，再由外部验收者黑盒审核，通过服务器恢复和教师任务后开放邀请制 V1。
- 验收：
  - `ClassroomRunSpec` 对齐视频结束点、PPT 页面、教师操作、答案揭示和课堂节奏。
  - 最终包只收录当前 `final_eligible` 版本；ZIP、manifest、hash、数据库记录和真实目录一致。
  - V1不再以外部Codex制作更多整包作为前置；产品内Main Agent必须独立完成至少一次真实PPTX、MP4和最终包E2E，运行中外部干预为0，P0为0。
  - 成包后的外部黑盒审核形成只读`ExternalAcceptanceReport`，绑定最终包版本与digest、Rubric版本、finding locator、责任层、严重度和建议回归用例；报告不得伪装成产品内计划、批准、CriticReport或返修执行证据。
  - 记录首次可授课率、人工修改时间、返修次数、成本、耗时和 Provider 失败率，并取得至少一名真实教师签收。
  - 目标服务器共享卷重启、release 回滚、备份恢复和公开注册关闭复核通过后，才允许邀请真实用户。

### RQ-027 教师可控生成强度与受控升级建议

- 状态：`accepted / pending implementation`
- 来源：2026-07-13 用户提出的四档生成强度、积分提示和复杂任务升级确认需求。
- 当前事实：Main Agent 当前实现为 `gpt-5.6-terra + high`；本条只记录目标产品行为，不代表默认档已经改为 Medium，也不代表前端滑杆已经实现。
- 目标：教师侧只感知“生成强度”，不暴露模型名称；V1 默认使用标准档。任务持续未解决时，系统可以建议提高强度，但必须说明积分消耗影响并取得明确确认，禁止静默升级。
- 四档内部映射：

| 教师可见档位 | 内部模型策略 | 使用边界 |
|---|---|---|
| 标准 | `gpt-5.6-terra + medium` | 目标默认档，普通对话、规划和常规生产 |
| 增强 | `gpt-5.6-terra + high` | 较复杂规划、首次升级建议 |
| 深度 | `gpt-5.6-terra + xhigh` | 多约束冲突、连续质量返修或复杂影响分析 |
| 极致 | `gpt-5.6-sol + high` | 万不得已；只有前三档持续未解决且用户再次确认后使用 |

- 交互要求：
  - 在“高级”设置中提供四个稳定停靠点的生成强度滑杆，视觉参考为浅灰轨道、已选进度和单一圆形滑块。
  - 默认展示“标准”；教师界面不得出现 Terra、Sol、模型 ID、reasoning effort 或 Provider 名称。
  - 拖动时显示“强度越高，消耗的积分越快”；进入“极致”前必须再次提示更高积分消耗。
  - 当前积分余额、预计消耗或价格没有可靠数据时，不得虚构具体积分数，只提示相对消耗趋势。
- 升级建议机制：
  - 只有同一 IntentEpoch 内出现可审计的复杂度或持续失败信号时才允许建议升级，例如同一质量定位连续两轮未关闭、达到当前档重试预算、上下游约束冲突无法收敛。
  - Main Agent只生成升级建议；服务端策略根据真实状态决定是否允许展示，不能由模型文本自行切换模型。
  - 提示必须说明建议档位、触发原因和“会消耗更多积分”，并提供“提高强度继续”和“保持当前强度”两个动作。
  - 用户确认后生成受控 actionId，从下一次计划或返修调用开始升级；当前已提交的Provider任务不取消、不重复提交。
  - “极致”不得自动推荐为第一次升级；只有增强/深度仍未解决时才可建议，并需要独立二次确认。
  - 同一问题、同一档位只提示一次；拒绝后不循环打扰，除非任务状态或IntentEpoch发生实质变化。
- 验收：
  - 默认新任务落到标准档，内部映射为 Terra Medium。
  - 四档滑杆支持鼠标、触摸和键盘操作，桌面与390px均无溢出；档位名称、当前值和积分提示可被辅助技术读取。
  - 教师可见页面、消息、下载物和普通错误中不出现底层模型名称。
  - 未确认升级时模型与强度不变；确认后只影响约定范围内的后续调用，记录可审计但不向其他用户泄露。
  - 两名用户同时使用时，各自强度选择、升级建议、确认状态和积分提示互不串扰。

## 7. 第二档需求

### RQ-028 当前制作计划

- 状态：`accepted / scheduled for V1.1`（V1-10 验收与发布收口通过后实施，纳入 V1.1 正式验收）
- 来源：2026-07-13 长任务计划可见性与对话输入区交互确认。
- 问题：当前 `DeliveryPlan` 只跟随某条助手消息显示，教师在长任务执行中不能持续看到当前有效计划、总体进度、正在处理的步骤、等待确认位置和自然语言改道后的计划变化；任务运行时间较长时容易被误认为卡住。
- 目标：Main Agent 理解长期任务并经 PlanGuard 校验后，将当前有效计划实时挂载在对话输入框正上方；教师始终可以继续输入自然语言暂停、补充、改道或局部返修，面板随 Observe、Plan、Guard、Act、Observe、Replan 更新。
- 产品位置：`ConversationWorkbench` 的聊天滚动区与 `PromptComposer` 之间，由工作台级 `ConversationActionDock` 承载，不把计划状态、输入、附件和任务逻辑继续堆入 `PromptComposer`。
- 数据边界：
  - 复用现有 `DeliveryPlan`、`pendingDeliveryPlan`、ConversationTurnJob、HumanGate、IntentEpoch、Observation 和 Snapshot 轮询。
  - 增加项目级只读 `activePlan` 投影，绑定 projectId、IntentEpoch、planId、revision、currentStepId 和步骤状态；历史计划保留，但界面只挂载当前有效 revision。
  - V1 首版优先从已持久化的计划消息 metadata 解析 `activePlan`，不为展示需求提前新增独立数据库表；若后续计划查询、协作或历史规模证明需要，再单独评估一等计划表。
  - Main Agent 可以提出和修订计划，但节点、依赖、HumanGate、Quality Gate 和可执行性必须由服务端 PlanGuard 校验；不得实现为写死十步的固定 DAG。
- 教师可见规则：
  - 普通问答和单次低成本动作不挂载计划；两个以上业务节点、异步媒体任务、多个 HumanGate 或明确完整交付目标才进入长期计划模式。
  - 同一 `activePlan` 提供“计划视图”和“进度视图”两种表现，不创建两份计划状态。计划视图按真实业务步骤逐行展示全貌；进度视图在执行和收尾阶段紧凑显示计划名称、当前活动、分段进度和总体状态。
  - 新计划首次出现、revision 发生实质变化、等待确认、失败或阻塞时，计划视图自动展开一次；进入稳定执行或收尾阶段后，如果教师没有手动选择过视图，可以收起为进度视图。教师的手动展开/收起优先，直到下一次实质 Replan。
  - 进度视图中绿色表示已完成、蓝色表示正在执行、浅灰表示未开始；等待确认使用琥珀色，失败使用红色。颜色必须同时配合状态文字、图标或可访问名称，不得只依赖颜色。
  - 折叠/进度视图仍显示当前步骤、等待确认或阻塞摘要；展开/计划视图显示完整步骤、依赖和教师可理解的执行活动。
  - 只显示“分析教材、设计样张、独立审查、返修第 6 页、等待确认”等业务语言，不显示模型原始思维链、Prompt、Provider、API、数据库字段、本地路径、密钥或调试日志。
  - 自然语言改道后旧 revision 退出活动状态，新 revision 实时替换；已完成产物在血缘合法时继续复用，不强制从头执行。
- UI 约束：
  - 桌面端与输入框同宽并固定挂载于其上方；展开时向聊天区占用空间，不遮挡输入框。
  - 计划视图使用纵向步骤列表；进度视图使用单行或双行紧凑结构：计划标题与真实耗时、当前活动、分段进度轨和状态标签。切换入口使用可访问的展开/收起图标并提供 tooltip。
  - 分段进度只代表教师可理解的业务里程碑，不为每次 Tool、Observation 或模型调用生成细碎分段；步骤过多时按已验证的父级里程碑聚合，完整细节仍在计划视图中可见。
  - 已耗时根据真实开始时间计算；只有存在可信历史统计时才允许显示标注为“预计”的剩余时间，不能由前端定时器或模型臆测 ETA。
  - 计划完成后所有有效分段进入完成态，显示“已完成”和最终成果入口；不得继续显示蓝色进行中或阻塞输入。
  - 390px 下计划视图限制高度并内部滚动；进度视图允许标题和当前活动换行。长标题、10 个以上步骤、失败、暂停和等待确认状态不得溢出或遮挡发送操作。
- 验收：
  - 刷新、重新进入项目和 Snapshot 轮询后，当前计划、revision、步骤状态和进度恢复一致。
  - Tool 成功、Quality Gate 失败、HumanGate 等待、暂停、取消、自然语言改道和局部返修均能驱动真实状态变化，不使用前端定时器伪造进度。
  - 同一项目只挂载一个当前有效计划；两名教师、不同项目的计划和活动完全隔离。
  - 计划完成后进入可折叠历史，不继续阻塞输入；被 supersede/canceled 的旧计划不得重新成为活动计划。
  - 自动化覆盖 activePlan resolver、mapper、双视图投影、自动/手动切换优先级、Replan revision、HumanGate 和响应式合同；真实浏览器覆盖 1366×768 与 390px 两种视图、状态色语义、长计划、收尾完成、等待确认和自然语言改道。
- 触发条件：V1-1 至 V1-10 全部通过，产品内真实交付 E2E、两用户隔离、目标服务器恢复门和 V1 发布验收已完成；不得为提前实现本需求打断当前 V1 主线。
- 建议阶段：`V1.1-2 AG-UI兼容事件流与当前制作计划`；通过RQ-039统一对话Runtime承载，与反馈闭环保持独立业务边界。

### RQ-029 V1.1 反馈闭环与教师体验

- 状态：`split / scheduled for V1.1`
- 来源：2026-07-13 V1 上线后真实内测体验与反馈闭环讨论。
- 版本定位：V1.1 是 V1 邀请制上线后的首个正式增强版本；不重做产品架构，不打断 V1-9/V1-10，上线目标仍为邀请制真实内测，不自动开放公网注册。
- 核心问题：现有反馈中心已经能真实提交、持久化、查看和导出，但还不能把一条教师反馈稳定推进到局部定位、内部归因、责任分配、版本修复、回归验证和教师回告；PPT、视频和教案也缺少页级、镜头级和段落级反馈定位。
- 目标：把反馈从“可提交的记录”升级为“可追踪的产品改进闭环”，同时在现有 Codex 风三栏工作台上完成适合年轻小学教师的温柔、专业、清爽、可信的视觉收敛。
- 必须交付：
  - 保留现有反馈上传状态，新增独立业务处理状态、分诊、责任层、优先级、重复归并、关联需求/版本和回归证据。
  - 提供教师自己的反馈状态与处理结果，不允许普通教师读取他人反馈。
  - 支持 PPT 页级、视频 shot/time range 级、教案 section 级和整包级反馈，自动绑定真实产物版本。
  - 系统报错、任务卡住或重试耗尽时提供“反馈问题”，一键打开已预填表单并附带脱敏错误现场；教师确认和补充后才提交，不静默上报。
  - 管理端提供轻量分诊工作台，不建设大型客服或 Jira 式工单系统。
  - 接入 RQ-028 当前制作计划，强化等待确认、失败恢复、自然语言改道和局部返修可见性。
  - 增加教师可见的长任务执行活动流，持续展示业务动作、工具摘要、Observation、现有门禁状态和最终收尾，但不在V1.1新增通用阶段QA或持续多轮审查。
  - 提供渐进式“搜索与快捷操作”面板，统一查找有权访问的项目、当前任务、成果和常用操作。
  - 形成内测指标、版本回告和至少两条从提交到解决的真实闭环证据。
- 视觉口径：不将年轻女性教师等同于粉色或卡通化；保持白色低噪声工作台，保留山海绿，增加克制的珊瑚与琥珀状态色，统一 6-8px 圆角、清晰焦点、短动效和桌面/390px 响应式行为。
- 不做：公开反馈广场、完整客服评论线程、自动录屏、未经授权上传完整对话、复杂组织工单和公开自助注册。
- 需求规格：`docs\product\v1-1-feedback-closed-loop-requirements.md`。
- 阶段规划：`docs\stages\v1-1-feedback-closed-loop-plan.md`。
- 验收计划：`docs\stages\v1-1-feedback-closed-loop-test-plan.md`。
- 触发条件：V1-10 发布门关闭并形成 V1 基线；实施前重新核对生产拓扑、数据库备份和真实内测用户范围。

### RQ-030 错误现场一键反馈

- 状态：`accepted / scheduled for V1.1`
- 来源：2026-07-13 竞品错误条、已预填反馈面板和自动附带报错现场参考。
- 问题：教师遇到系统报错、任务卡住或连续重试失败时，通常只能描述“刚才不能用了”；错误发生的任务、步骤、版本、重试和运行上下文与反馈分离，团队难以复现。
- 目标：在受影响消息、任务或输入区附近显示教师可理解的错误条，提供“查看详情、复制编号、反馈问题、关闭”；点击“反馈问题”直接打开已预填反馈面板，自动附带经过脱敏和权限校验的问题现场。
- 渐进式交互：
  - 第一层只显示简短错误摘要和四个低噪声操作，不直接展开技术日志。
  - 第二层“查看详情”显示教师可理解的发生时间、当前步骤、重试情况、影响和恢复建议。
  - 第三层“反馈问题”打开现有 FeedbackDialog 的错误上下文模式，预选功能异常或性能问题，预填标题、“当时正在做什么”和“期望结果”，允许教师编辑、补充和上传截图。
  - “已附带诊断信息”默认开启但可查看脱敏摘要并关闭；打开面板不等于提交，只有教师点击提交后才保存。
- 自动附带：errorId/安全错误码、发生时间、route、app/build version、project/message、plan/revision/currentStep、task/job、artifact/version、重试次数、最后成功步骤、trace/correlation ID 和脱敏 diagnostics digest；字段存在才附带，不用模型补造。
- 隐私边界：不得附带完整对话、Prompt、请求体、响应正文、token、密钥、Cookie、请求头、签名URL、本机路径、原始堆栈或用户未选择的屏幕内容。内部Provider/Executor类别只允许进入管理员诊断白名单，不出现在教师页面。
- 安全：所有 project/message/plan/artifact/task 关联由服务端重新验证 actor 权限；客户端预填和日志摘要不能作为可信事实直接入库。
- 建议阶段：`V1.1-6 现场与产物上下文反馈`。
- 验收：错误条不遮挡输入；面板打开后上下文准确、字段可编辑、截图可选；关闭诊断信息后不上传诊断包；提交失败保留内容；两用户错误现场完全隔离。

### RQ-031 搜索与快捷操作

- 状态：`accepted / scheduled for V1.1`
- 来源：2026-07-13 竞品渐进式搜索/命令面板参考。
- 问题：随着项目、成果、当前计划、反馈和设置增加，教师需要在侧栏、成果抽屉和个人菜单之间寻找入口；直接把所有入口常驻页面会破坏低噪声工作台。
- 目标：新增教师可见的“搜索与快捷操作”面板，以一个搜索入口和 `Ctrl/Cmd+K` 打开；空查询显示常用操作和最近内容，输入后按有权访问的操作、项目、任务和成果渐进筛选。
- 搜索范围：
  - 操作：开始新备课、上传教材、打开当前计划、查看成果、提交反馈、我的反馈、调整生成强度。
  - 项目：当前教师拥有或作为成员加入的活跃/最近项目；归档项目只在明确筛选时出现，回收站默认不出现。
  - 任务：当前计划、等待确认、失败可恢复任务和最近完成任务，使用教师业务语言。
  - 成果：教案、PPT、图片、视频和最终包，显示项目、类型、版本和达标状态。
  - 管理操作：只有管理员或项目owner具备权限时才出现成员管理、用户管理等入口。
- 渐进式设计：关闭时只保留搜索图标/快捷键提示；打开无查询时显示建议和最近；输入后显示分类标签与分组结果；选择结果后直接导航或执行低风险动作。
- 第一版分类标签固定为“全部、操作、项目、成果”；任务和反馈可以作为“全部”中的结果组，避免窄屏标签过多。
- 安全：搜索结果必须使用当前 actor 的服务端授权范围，不能先返回再靠前端隐藏；破坏性操作不直接执行，仍进入原确认流程；不得展示模型、Provider、MCP、Skill、API、路径或调试入口。
- 范围边界：V1.1 不做完整对话全文、教材正文或附件内容全文检索，不建设通用命令终端；后续有真实需求再单独评估索引方案。
- 响应式与可访问性：桌面支持上下键、Enter、Escape和可见焦点；390px 使用近全屏 Sheet，输入框固定，结果独立滚动，不遮挡键盘和主要操作。
- 建议阶段：`V1.1-7 搜索与快捷操作`。
- 验收：空查询、输入筛选、分类切换、无结果、加载、失败、权限变化、键盘和390px全部可用；教师甲无法搜索到教师乙未共享的项目、任务、成果或反馈。

### RQ-032 长任务执行活动流

- 状态：`accepted / scheduled for V1.1`
- 来源：2026-07-13 长任务自动化执行、阶段待办、逐步QA和最终收尾的完整对话参考。
- 问题：当前计划卡只能说明“准备做什么”，不能持续解释系统正在做什么、完成了什么、发现了什么、为何返修以及最终如何证明完成；长任务仍容易被误认为卡住。
- 目标：把真实 Plan、Tool摘要、Observation、HumanGate、现有Quality Gate、Artifact和Replan投影为教师可理解的执行活动流，与RQ-028计划双视图和底部进度Dock协同。
- 展示层级：
  - 当前阶段完整展示：下一步业务动作、执行摘要、观察结论和可操作结果。
  - 已完成阶段折叠展示：显示阶段名称、完成状态和事件数量，点击后查看证据摘要。
  - 计划清单只在新建、实质Replan和最终完成时完整出现；中间阶段以活动流和紧凑进度视图为主。
  - 最终收尾必须列出成果、真实版本、已有质量状态、未关闭事项和查看/下载/反馈入口。
- 事件边界：只展示“已读取教材”“已检查12页PPT”“发现第6页文字偏多”“正在返修第6页”等业务语言；不得展示命令、文件写入、API、Provider、模型、MCP、Skill、路径、原始日志和模型思维链。
- 数据边界：活动事件必须绑定projectId、IntentEpoch、runId、planId、revision、stepId、sequence、eventType、status、teacherText、evidenceRefs和createdAt；刷新、重新进入项目和双用户并发后顺序与状态保持一致。
- 版本边界：V1.1只实现通用活动事件投影，不新增“每阶段独立QA”业务；阶段QA活动与进度展示统一进入RQ-034 V1.2。
- 建议阶段：`V1.1-2 AG-UI兼容事件流与当前制作计划`。
- 验收：活动流来自真实事件而非前端定时器；重复事件可聚合；失败/等待确认/返修可打断；任务完成后有可核验收尾；桌面与390px均可扫描且不无限增长阻塞输入。

### RQ-039 assistant-ui对话Runtime与AG-UI兼容事件层

- 状态：`in progress / moved into current V1 control-plane refactor`
- 来源：2026-07-14 对当前消息协议、Main Agent控制、显示层和成果编辑边界的代码审计与开源方案适配讨论。
- 问题：当前消息仍以正文字符串和零散附属字段为主，计划、快捷回复、成果、活动和运行状态由自研组件及完整Snapshot轮询分别承载；RQ-028、RQ-032、RQ-036和前端工作台需求重复声明Markdown、流式、Tool状态、活动、重试和成果引用，继续逐项自研会形成多套消息语义。
- 目标：当前V1控制面重构以assistant-ui作为教师对话区唯一目标UI Runtime，通过ExternalStoreRuntime复用现有服务端消息和权限状态；建立项目自有MessagePart与AG-UI兼容事件Adapter，统一承载文本、活动、计划、Tool状态、Artifact引用、质量摘要、HumanGate、下一步和错误恢复。
- 唯一边界：
  - Main Agent继续负责理解、规划、Tool选择、Observation和Replan。
  - Artifact、HumanGate、Quality Gate、权限、版本、费用和副作用继续由现有服务端业务层权威管理。
  - assistant-ui只负责消息线程和交互承载；AG-UI只负责事件兼容与恢复；数据库不直接持久化第三方私有类型。
  - BlockNote属于V1.3-V1.5文档成果编辑，不进入当前对话 Runtime 重构。
- 实施：当前控制面重构冻结合同、完成assistant-ui Adapter、历史消息兼容、安全Renderer、兼容事件流、断线恢复和activePlan投影；反馈、搜索等后续需求只消费统一Runtime，不随本次提前实施。
- 迁移：加法字段、旧消息确定性映射、影子投影、测试账号功能开关、正式切换和旧UI回退；禁止双写业务状态，旧UI只在满足删除条件后另行清理。
- 验收：历史消息无损；真流式、重复/乱序/断线续接和快照校正通过；受控编辑/重试/分支不绕过IntentEpoch与ActionPolicy；两用户隔离；当前V1桌面无裸Markdown、注入、重叠、工程词或伪状态；V1业务路径和旧UI回退无回归。V1前不运行新的390px真实黑盒。
- 需求合同来源：`docs\product\v1-1-assistant-ui-conversation-runtime-requirements.md`（文件名保留历史版本号，当前时序由新 ADR 覆盖）。
- 当前架构决策：`docs\architecture\decisions\2026-07-14-adr-assistant-ui前移并统一控制面消息边界.md`；`2026-07-14-adr-v1-1采用assistant-ui与AG-UI兼容事件层.md`仅作被替代的历史技术来源。

### RQ-033 持续多轮深度审查

- 状态：`deferred until after V2.0`
- 来源：2026-07-13 自动全面审查、审查待办、边审边定点修复和高强度多轮审校模式讨论。
- 目标：在基础阶段QA之上，引入多个独立Critic视角、多轮finding -> 返修 -> 复验循环、跨产物最终总审和可计费的高强度审校模式。
- 延期原因：该模式显著增加Agent调用、返修轮次、Provider成本、任务时长和依赖失效复杂度；应先由V1.2阶段QA积累真实问题率、返修收益和积分数据，再决定套餐、预算与默认策略。
- 边界：不进入V1.1或V1.2实施，不作为这两个版本的发布门；V1.2只实现单阶段独立QA及一次定点复验，不实现持续自主循环。
- 启动条件：V2.0已经发布，V1.2阶段QA稳定运行并有足够遥测，积分计量、影响分析、ReviewPolicy预算和多用户隔离达到可验证水平。
- 权限原则：未来实现仍不得在教师输入框伪装用户自动发送提示词；Critic不得直接执行有副作用Tool；模型强度升级、预算扩张和上游范围变化必须分别确认。
- 详细记录：`docs\product\v2-plus-continuous-review-requirements.md`。

### RQ-034 阶段QA与前端展示

- 状态：`accepted / scheduled for V1.2`
- 来源：2026-07-13 用户明确提出“每完成一个阶段，由独立质量审查智能体执行QA，并在前端展示”。
- 目标：每个主要生产阶段完成候选产物后，先由独立质量审查智能体按阶段Rubric检查，再由确定性QualityDecision决定通过、定点返修或阻塞；前端持续显示QA计划、当前检查、finding、返修复验和最终阶段结论。
- 核心流程：Stage Candidate -> deterministic Validator -> independent Stage QA -> QualityDecision -> pass / targeted repair / block；发现问题后由Main Agent生成RepairPlan，质量审查智能体不直接修改产物。
- V1.2范围：每阶段一次独立QA；发现问题后允许一次定位明确的返修复验，仍未通过则暂停并请求教师或进入人工处理。多Critic、多轮持续自动优化和付费深度套餐统一延期到RQ-033。
- 阶段范围：Brief/课程目标、教案、PPT叙事与PageSpec、关键样张、完整PPT、视频创意与课程锚点、分镜/成片、最终包一致性。
- 前端展示：阶段完成后显示“正在进行阶段检查”；使用逐项QA清单和活动流，绿色已通过、蓝色正在检查、灰色待检查、琥珀待返修/待确认、红色阻塞，并同时提供文字和图标。
- 数据与恢复：StageQAPlan、QAReport、QualityDecision、RepairPlan和QAEvent绑定projectId、IntentEpoch、planId/revision、stage、artifact/version/digest、rubricVersion和独立Reviewer来源；刷新和重新进入后可恢复。
- 现有复用：PPT/视频`delivery_critic.review`、ValidationReport、CriticReport、QualityDecision、页级/镜头级locator、ArtifactVersion和stale传播；V1.2补齐Brief/教案、最终包阶段QA及统一前端投影。
- 详细规格：`docs\product\v1-2-stage-qa-requirements.md`。
- 验收：所有主要阶段都存在独立QA证据；QA不自批自改；问题定位后只返修受影响范围；前端状态来自真实QA事件；桌面/390px可查看；两用户QA计划、报告和产物完全隔离。

### RQ-035 V2.0前生产化与容量门禁

- 状态：`accepted / required before V2.0`
- 来源：2026-07-13 用户明确要求一个月内达到至少50名真实用户在线、5名真实用户同时使用，并在V2.0发布前完成生产化基础设施、安全、并发、部署与恢复能力。
- 目标：在不重写现有Main Agent、PPT和视频业务主线的前提下，把当前单Node进程、SQLite和进程内执行边界升级为可恢复、可观察、可限流、可扩容的生产运行底座。
- 硬容量口径：50个不同邀请账号可同时保持有效在线会话；其中至少5名不同教师可在不同项目中同时对话、提交并推进长任务，允许受Provider容量控制进入可恢复队列，但不得串线、丢任务、重复计费或依赖HTTP请求持续存活。
- 必做范围：PostgreSQL与显式数据库迁移、Redis/BullMQ任务队列、独立Worker、对象存储、积分与Provider预算、分布式限流、结构化日志与告警、备份恢复、发布回滚、容量测试和分批放量。
- 边界：Redis只承担排队、限流和短期协调，业务事实仍由PostgreSQL保存；不在本阶段重写Main Agent、迁移LangGraph、拆微服务、引入Kubernetes或建设多地域架构。
- 版本关系：V1.1反馈闭环和V1.2阶段QA保持既定产品边界；RQ-035是两者之外的生产工程主线，必须在V2.0发布候选形成前关闭。RQ-033持续多轮深度审查仍在V2.0发布后评估。
- 详细规格：`docs\product\v2-0前生产化与容量要求.md`。
- 执行计划：`docs\stages\v2-0前生产化30天计划.md`。
- 验收计划：`docs\stages\v2-0前生产化验收计划.md`。

### RQ-036 智能体引导式回复与阶段成就摘要

- 状态：`accepted / required for V1 closeout, no later than V1.5`
- 来源：2026-07-13 用户提供的 MagicSchool Raina 阶段概要与完整对话截图，以及分享链接的登录页核验。
- 问题：现有计划卡和长任务活动流解决“进度是否可见”，但尚未统一智能体回复的信息层级、逐步引导、阶段成就感和可靠收尾；普通回复与复杂任务容易使用同一种信息密度。
- 目标：新增 `brief`、`guided`、`milestone`、`completion` 四种教师可见回复模式。普通问答自然简短；复杂任务说明已知信息、处理方式、预期产出、审核方法和下一步；阶段与收尾展示真实成果数量、质量状态、可展开证据和可执行下一动作。
- 证据边界：所有数量、状态、耗时、版本和质量结论必须绑定真实 Plan、Tool、Artifact、Critic、HumanGate、QualityDecision 或持久化活动事件；不得由模型或前端编造，不展示思维链、工程日志和内部工具名。
- 架构边界：Main Agent 继续决定内容、业务动作和编排；Response Presenter 只组织教师可见结构，Evidence Binder 注入真实事实，Safe Renderer 渲染标题、加粗、分隔线、列表、表格、检查项和折叠详情，不得限制 Main Agent 能力或替代门禁。
- 版本关系：与 RQ-028 当前制作计划和 RQ-032 长任务活动流协同，但不重复实现计划或事件源；纳入 V1 收尾体验门，最迟不得晚于 V1.5。
- 详细规格：`docs\product\v1-agent-guided-response-presentation-requirements.md`。
- 验收：问候不长篇、材料上传能逐步引导、PPT/视频阶段有真实成就摘要、HumanGate 状态明确、最终收尾可核验；桌面/390px可扫描且无工程词、伪进度、思维链或跨用户泄露。

### RQ-037 V1.5 当前成果工作区替代常驻糖葫芦

- 状态：`accepted / required for V1.5`
- 来源：2026-07-13 用户提供的 MagicSchool Raina 完整对话 HTML、浏览器渲染审查及产品形态讨论。
- 问题：常驻右侧产物 Rail 即使已从逐节点改为五类聚合，仍会强化固定线性链路的心智模型；现有成果侧栏默认仅 360px、只读且需要手动点击，完整成果还会在对话内重复呈现。
- 目标：V1.5 完成“对话控制台 + 当前成果工作区 + 全部成果抽屉”升级。Main Agent 负责指定当前主要成果和呈现动作；右侧工作区负责阅读、编辑、审查和版本；全部成果抽屉负责历史成果导航；当前制作计划继续独立展示。
- 下线边界：移除桌面常驻糖葫芦视觉形态，但保留 Artifact、版本、依赖、状态、权限、下载、HumanGate、Quality Gate 以及 RQ-016 已完成的成果分组抽屉。
- 分期：V1 收尾完成 RQ-036；V1.1 下线常驻 Rail、支持主要成果自动打开并减少聊天正文重复；V1.2 接入阶段 QA；V1.3-V1.4 补齐编辑、保存、版本、局部 Patch 和冲突处理；V1.5 完成总验收。
- 详细规格：`docs\product\v1-5-artifact-workspace-requirements.md`。
- 架构决策：`docs\architecture\decisions\2026-07-13-adr-当前成果工作区替代常驻糖葫芦.md`。
- 验收：桌面无常驻 Rail；主要成果按真实引用自动打开；直接编辑与自然语言修改进入同一版本体系；QA可定位；刷新恢复、响应式和两用户隔离通过；原成果、下载、门禁和最终交付无回归。

### RQ-010 竞品研究衍生能力

- 状态：`deferred`
- 来源：MagicSchool 与 Canva for Education 深度分析及横向汇总。
- 候选方向：Studio 式产物编辑、资源库、PPT/视频共享资产池、模板与教育素材、教师审核与版本、课堂分享和 LMS 集成。
- 当前决策：放入第二档，现阶段不实现；完成反馈中心、第一档 UI 收口和一轮真实内测后再按反馈决定取舍。
- 需求文档：`docs\product\competitor-derived-second-tier-requirements.md`。

## 8. 文档与历史治理需求

### RQ-007 旧阶段文档归档

- 状态：`deferred`
- 问题：`docs\stages\` 历史文件很多，但仍有审计和追溯价值。
- 决策：暂不移动、不删除；后续单独做归档计划，先查引用和历史作用。
