# ShanHaiEdu 需求总账

更新时间：2026-07-12（V1 Stage 0R 本地门禁收口）

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

- 状态：`done`（实现、安全隔离和按需视频脚本桌面/390px 真实浏览器路径均已验证）
- 来源：2026-07-11 用户真实使用反馈。
- 问题：反馈类型切换会动态插入“快速补充”并改变弹窗高度和滚动位置；消息赞踩缺少明确结果提示；自然语言确认与直接工具意图仍可能被 HumanGate 错误阻断；已有多用户能力缺少真实双账号和历史数据归属验收。
- 目标：允许教师从任意可用能力切入，模型负责理解目标、选择工具和解释缺失输入，不强迫从固定线性节点开始；同时保持真实外部生成、不可逆写入和高成本调用的必要安全确认。
- 产品决策：
  - 反馈类型切换不得改变弹窗主要结构、视口高度或滚动位置；快速补充区域始终占位，仅替换内容。
  - 点赞和点踩保存后给出短暂、可访问的正向/负向提示；取消评价也有提示。
  - 普通文本分析和结构化草稿不要求 HumanGate；真实 provider、文件生成、外部写入和高成本调用仍需一次明确确认。
  - 自然语言明确复述目标可确认已披露动作；模糊“继续”只在唯一低副作用计划下继续，否则具体消歧。
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

- 状态：`done`（工程实现完成；真实用户开放仍等待生产门禁和真实 provider smoke）
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
  - 如果请求涉及真实 provider 或高风险动作，模糊继续不能授权执行，仍需已披露动作后的显式 HumanGate。
- 建议阶段：M68，与 RQ-011 合并实施。

### RQ-011 对话承诺与执行一致性

- 状态：`accepted`
- 来源：2026-07-10 对话截图；助手承诺回复“继续做视频/改做 PPT”即可执行，教师回复“我让你接着做啊”后仍被“没有有效确认”阻断。
- 问题：助手话术、上下文语义、quick reply 隐藏 actionId、pending plan 生命周期、PlanGuard 和失败状态作用域不一致。
- 目标：按钮和自由输入都能安全控制当前计划；多分支时具体消歧；改道会 supersede 旧计划；历史失败保留审计但不污染新分支。
- 验收：
  - 唯一低副作用 active 计划下，“我让你接着做啊”能继续正确计划；真实 provider 动作仍要求已披露动作后的显式 HumanGate。
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
- 目标：形成可被真实视频 provider 使用的结构化前置产物。
- 验收：
  - 能按顺序生成并确认知识锚点、创意主题、视频脚本、分镜、资产 brief、资产图、片段计划。
  - 缺前置材料时不调用真实视频 provider。
- 建议阶段：`M69-M71`。

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

- 状态：`accepted`（工程实现已完成；真实外部 Provider 与教师全链路验收未完成，不能标记 done）
- 来源：M64-R / M66-R 收尾后剩余主线缺口。
- 问题：ToolRegistry 和 Runtime native loop 已接通，但 `asset_image_generate`、`concat_only_assemble` 和工具层真实最终包仍未实现；provider 工具也不能从 native loop 直接使用裸 artifact refs。
- 目标：用服务端 resolved Artifact、真实 Provider 和质量门禁跑通一个教师任务从输入到最终下载包的完整链路。
- 验收：
  - `asset_image_generate` 生成真实、可校验、可保存的视频资产图产物。
  - `concat_only_assemble` 只按分镜顺序拼接已通过校验的视频片段，不重排、不加转场、不重写内容。
  - `final_package` 产出真实 ZIP/材料包，包含 PPTX、图片、视频、清单和校验 metadata，不再只是交付检查清单。
  - provider 工具只接受同项目、已批准、ID/kind/nodeKey 匹配的服务端 resolved Artifact。
  - 使用一个真实小学数学公开课任务完成需求、教案、PPT 设计、PPTX、图片、视频和最终材料包下载验收。
- 优先级：下一阶段，先于公开注册和完整多用户管理。
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

- 状态：`done`（Stage 2A 可执行合同/ValidationReport、Stage 2B Critic/QualityDecision、Stage 2C Observation/Replan 与 finish 证据门均已完成）
- 收尾证据：`docs\stages\local-real-v1-stage2a-contract-validation-closeout.md`、`docs\stages\local-real-v1-stage2b-quality-decision-closeout.md`、`docs\stages\local-real-v1-stage2c-observation-replan-closeout.md`。
- 来源：节点合同草案、RQ-015 非线性按需生产和当前 Agent Harness。
- 目标：Main Agent 基于 WorldState 执行有界 Observe、Plan、Guard、Act、Observe、Replan；合同和确定性门禁约束提交，不把顶层 Agent 固化成线性 DAG。
- 验收：
  - 关键节点具有可执行 pre/post contract、类型化错误 locator 和结构化 ValidationReport。
  - Critic 只评价语义与效果，不能覆盖文件、页数、hash、血缘、参考图实传等硬门。
  - 教师可在 Brief、大纲、视觉系统、PageSpec、样张、分镜、镜头和时间线处暂停、修改、改道或局部返修。
  - 达到步骤、费用、重试或时间预算时暂停并请求教师决定，不无限循环。

### RQ-024 PPT Quality 纵向闭环

- 状态：`first real course complete / two fixed tasks pending`
- 来源：用户提供的 PPT V8 手册、PPT 生产工艺设计和现有 PPTX 真伪门禁。
- 目标：从教材证据、叙事大纲、视觉系统、逐页 PageSpec、关键样张和正式资产，生成真实可编辑 PPTX，并支持页级返修。
- 验收：
  - 教材主张可追溯；每页具备独立教学作用、布局、视觉、素材和教师动作。
  - 样张批准后再批量生产；批准资产真实嵌入，精确信息保持可编辑。
  - PPTX、PDF、逐页 PNG 和 contact sheet 页数一致；最终真实试点至少包含一套 12 页 PPTX。
  - 问题精确定位到 pageId/assetId；修一页不重跑整套。

### RQ-025 视频 Full Intro 逐镜头闭环

- 状态：`first real course complete / two fixed tasks pending`
- 来源：用户提供的《视频工作流制作手册V1.0》、视频工艺设计和现有视频门禁。
- 目标：从课程锚点和独立创意形成 Beat、ShotSpec、视频专属参考资产、逐镜头任务、音字后期与真实合成，并支持镜头级恢复和返修。
- 验收：
  - 每个镜头独立绑定 shotId、inputHash、providerTaskId、参考资产和验收条件。
  - 需要连续性的镜头能证明参考资产真实进入 Provider 请求；PPT 资产不得冒充视频参考资产。
  - 单镜头失败、重启或返修不重跑全片；FFmpeg 合成结果与 TimelineManifest、ffprobe 一致。
  - QA 覆盖课程回接、答案泄露、儿童安全、连续性、字幕、音轨和技术参数。

### RQ-026 整堂课一致性、最终包与邀请制上线

- 状态：`in_progress`
- 来源：V1 快速上线目标和当前最终材料包真伪门禁。
- 目标：教案、PPT、视觉图和视频形成可上课的同一版本，通过真实 Provider、服务器恢复和教师任务后开放邀请制 V1。
- 验收：
  - `ClassroomRunSpec` 对齐视频结束点、PPT 页面、教师操作、答案揭示和课堂节奏。
  - 最终包只收录当前 `final_eligible` 版本；ZIP、manifest、hash、数据库记录和真实目录一致。
  - 完成三个固定、递增难度的小学数学真实任务，至少一套 12 页 PPTX，三套真实 MP4/最终包，P0 为 0。
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
