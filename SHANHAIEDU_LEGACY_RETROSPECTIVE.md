# ShanHaiEdu 初代产品系统复盘与可复用资产吸收 V1

日期：2026-07-07
来源项目：`E:\desktop\AI\02_Agents\lab\ShanHaiEdu`
目标项目：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio`

> 本文档用于把初代 ShanHaiEdu 的成熟资产、失败教训和缺失能力，转化为 ShanHaiEdu-Studio 可复用、可审计、可迁移的工程资产。本文不复制旧项目业务代码，不复刻旧项目屎山，不暴露任何密钥或私有 provider 配置。

## 1. 复盘结论

初代 ShanHaiEdu 不是没有价值，而是“好机制分散在多个分支和文档中，执行内核仍然被旧代码路径拖住”。它已经沉淀出大量优质资产：workflow schema、规则门禁、skills 分层、provider adapter、安全策略、多角色协作、教师侧工程词红线、视频/PPT 生产经验等。

失败的根因不是单点技术差，而是四类失控叠加：

- 运行真源漂移：workflow、prompt、rules、Python service、provider adapter 多套真源并存。
- 重构不彻底：新控制平面和旧 `project_service.py`/前端旧链路长期并行，旧分支中心没有退出机制。
- 迭代面过宽：PPT、视频、素材、provider、前端、agent、安全同时推进，阶段冻结和验收边界不够硬。
- 交付定义混乱：代码级完成、测试通过、阶段封板、真实 provider 可用、教师可用经常被混用。

ShanHaiEdu-Studio 应吸收“机制”，不搬“实现”。核心方向是：

```text
代码负责运行机制
配置负责业务流程
PromptPack 负责表达策略
Skill 负责可复用能力
Artifact 负责上下游传递
ReviewGate 负责质量底线
HumanGate 负责人工可控
```

## 2. 本次证据来源

### 2.1 Git 迭代记录

只读查看旧项目 `main` 最近提交，代表性来源包括：

- `b88c490 docs: 历史吸收远程收口分支 | branch-closeout | 2026-07-07 03:10`
- `95f37a4 fix: 收口工作台端到端体验与验收同步 | workbench-e2e | 2026-07-07 02:19`
- `c6786e9 feat: 统一 Coze PPT Agent vNext 工作流 | vNext | 2026-07-07 01:25`
- `50ca61f docs: 创建工作流智能体重构主线规划 | workflow-runtime | 2026-07-06 13:35`
- `5fcab66 docs: 创建工作流智能体重构主线规划 | workflow-runtime-agentic-rearchitecture | 2026-07-06 11:36`
- `0da535a feat: 归档 skills system 本地成果 | archive | 2026-07-06 13:58`
- `36a4b22 feat: 归档 agent tool layer 本地成果 | archive | 2026-07-06 13:58`
- `a44cf35 docs: 归档 agent security hardening 本地成果 | archive | 2026-07-06 13:58`
- `8d2384b feat: 归档 creative video omni 本地成果 | archive | 2026-07-06 13:58`

判断：旧项目已经经历多轮架构、安全、skills、前端、provider、视频链路、PPT 链路尝试，但多数成果以分支归档或文档吸收结束，说明“探索产出多，主线收敛弱”。

### 2.2 核心文档与目录

本次只读采样了以下来源：

- `docs\mainlines\workflow-runtime-agentic-rearchitecture.md`
- `docs\multi-agent\README.md`
- `workflow\schema.md`
- `workflow\runtime\policies.yaml`
- `workflow\workflow.yaml`
- `workflow\rules\*.yaml`
- `workflow\prompts\**\*.md`
- `workflow\multi-agent\*.md`
- `skills\_catalog\skills-inventory.json`
- `skills\ppt-template-router\SKILL.md`
- `skills\coze-PPT\SKILL.md`
- `skills\videogen\SKILL.md`
- 本机 Claude Code 分析：`E:\desktop\AI\02_Agents\prod\Claude-code\claude-code-hb\claude的架构设计.md`

### 2.3 当前状态风险

旧项目 `E:\desktop\AI\02_Agents\lab\ShanHaiEdu` 的 `main` 当前存在未提交改动，包括后端、前端测试和文档目录。因此本文仅作为吸收复盘，不在旧项目中写入任何文件。

## 3. 可直接复用的优势资产

### 3.1 Workflow 字段合同与节点产物模型

来源：`workflow\schema.md`

可复用点：

- 项目元数据、项目配置、视觉契约、角色字典。
- 教案、导入设计、PPT 总装、PPT 页面脚本、图片资产、视频文稿、剧本、分镜、最终视频、最终交付等节点字段。
- `node_version` 版本字段：`version_id`、`node_id`、`project_id`、`status`、`generated_by`、`seed_params`、`is_current`。

适配方式：

- 不原样搬旧 schema；抽象成 ShanHaiEdu-Studio 的 `ArtifactKind`、`WorkflowNodeKey`、`ArtifactVersion`、`NodeRun`。
- 教师端展示必须走 public projection，不暴露旧字段名如 `node_id`、`provider`、`schema`。
- 对 MVP 先保留文本产物字段，PPTX/视频/图片完整字段后置。

### 3.2 Runtime policy 与安全门禁

来源：`workflow\runtime\policies.yaml`

可复用点：

- 成本动作和状态变更需要确认与幂等：`L2_cost`、`L3_state_change`。
- 敏感动作默认阻断：`L4_sensitive`。
- 工具执行只允许通过 `tool_gateway_only`。
- prompt 缺失 fail closed。
- provider fallback 必须显式声明。
- 真实 provider 需要用户授权、预算、证据目录、停止条件和回退计划。
- 教师侧禁词：`JSON`、`provider`、`manifest`、`node_id`、`StateEngine`、`schema`、`token`、`secret`、`internal_path` 等。

适配方式：

- 在 ShanHaiEdu-Studio 中拆成：`RuntimePolicy`、`ProviderPolicy`、`PublicOutputGuardrail`。
- E2E 主线必须加入教师侧工程词扫描。
- Runtime 主线必须提供 deterministic 和 real provider 的明确标签，不允许伪装。

### 3.3 Project-local Skills 体系

来源：`skills\_catalog\skills-inventory.json`

旧项目稳定入口技能 8 个：

- `coze-ppt`
- `imagegen-myself`
- `interactive-courseware`
- `jiaocai-to-jiaoan`
- `pdf`
- `ppt-template-education`
- `ppt-template-router`
- `videogen`

可复用点：

- 项目内 skill catalog 可验证，旧记录显示 `skill_count=8`、`all_skill_count=39`、`issue_count=0`。
- vendor skills 与 entry skills 分层，避免把所有能力常驻加载。
- PPT 能力拆成 router/template/execution adapter 三层。

适配方式：

- ShanHaiEdu-Studio 不应直接复制全部旧 `skills/`；先建立 `docs\agent-runtime\skill-binding-contract.md`，定义节点如何绑定 skill。
- 每个业务节点只声明允许使用的 skill，不让 agent 自由访问所有工具。
- 旧 `skills` 可作为参考源，迁移前必须逐个做 trigger、输入输出、敏感配置审查。

### 3.4 PPT 三层分离

来源：`skills\ppt-template-router\SKILL.md`、`skills\coze-PPT\SKILL.md`

成熟经验：

```text
ppt-template-router：只负责选模板家族和输出 platform-neutral prompt
ppt-template-education：只负责教育类 PPT prompt 生成
coze-ppt：只负责执行适配，把 final prompt 交给 Coze PPT Agent
```

可复用点：

- 模板选择不进入执行 adapter。
- Coze adapter 不持有教育模板逻辑。
- 先 dry-run final prompt，再消耗 Coze 点数。
- Coze event stream 需要逐行解析，不可当单个 JSON 对象。

适配方式：

- 新项目后续 PPT 主线应直接采用 `PromptPack -> ProviderAdapter` 分离。
- MVP 阶段只接 PPT 大纲和逐页脚本，不急着做 PPTX。
- 接 Coze 前必须通过私有 API 台账确认当前能力和费用，不凭旧经验调用。

### 3.5 视频工作流与 provider 经验

来源：`skills\videogen\SKILL.md`、`workflow\rules\R040-R052`、旧提交中的 Evolink/OTU/Omni 记录。

可复用点：

- 视频不是一条长 prompt：应按文稿、剧本、资产、分镜、首帧、逐镜头、片段验收、拼接成片推进。
- `omni_flash-10s` 一类模型需要一镜一镜生成，批量前先测试。
- 参考图优先本地下载后 multipart 提交，避免 provider 端拉临时 URL 403。
- 首帧测试和角色一致性门禁必须前置。
- completed MP4 下载失败与 reference preprocess 403 是两类不同错误。

适配方式：

- 新项目视频主线先做“导入视频方案 + 分镜 prompt + 资产计划”，不要在 MVP 中强行成片。
- 后续视频主线必须引入 `ShotRun`、`ReferenceAssetPack`、`FirstFrameGate`、`ClipReviewGate`。
- provider 真实调用必须经过私有 API 台账和用户授权。

### 3.6 多角色协作与验收门禁

来源：`docs\multi-agent\README.md`、`workflow\multi-agent\*.md`

可复用点：

- 主 Codex 单入口，总控拆任务，专业角色执行。
- 角色交付只能声明“代码级完成”，不能越权声明阶段封板。
- 测试验收和架构复核分层。
- 重要任务必须绑定参考文档、契约文档、测试验收文档。
- 并行冻结区：测试复测/红线返工/封板复核时，其他角色不能改当前验收面。

适配方式：

- ShanHaiEdu-Studio 已采用 4 worktree 并行，应继续保留“main 只集成、feature 分支阶段推进”。
- 每条主线必须有 stage plan 和 test plan；不能把 handoff 当计划。
- 监控自动化应持续检查错误目录写入、main 污染、跳过阶段文档。

### 3.7 Claude Code 可借鉴的运行时思想

来源：`E:\desktop\AI\02_Agents\prod\Claude-code\claude-code-hb\claude的架构设计.md`

可复用点：

- Tool 是能力边界，不是 prompt 装饰。
- Skill 是可发现、可限制工具、可条件激活的 Markdown 包。
- 权限验证、危险命令警告、只读约束、安全检查是 runtime 的一部分。
- 子 Agent 只是调度出来执行特定任务，不是自由改业务状态。
- allowed-tools、paths、hooks、变量替换可作为 ShanHaiEdu skill binding 的参考。

适配方式：

- ShanHaiEdu-Studio 的 `AgentRuntime` 不应只接模型；它要加载 `NodeDefinition + PromptPack + SkillBinding + ToolPermission + ReviewGate`。
- 人工调优不是改代码，而是改版本化 PromptPack/SkillBinding/ReviewGate。

## 4. 失败短板与避坑规范

### 4.1 不彻底重构造成双真源

旧项目已有 `workflow\workflow.yaml`、`workflow\prompts`、`workflow\rules`，但执行中心仍由 Python service、provider adapter、前端状态等多处决定。

避坑：

- 新项目每一类状态只能有一个真源。
- 前端不是业务状态真源。
- prompt 文件不是状态真源。
- Runtime adapter 不是项目/产物真源。
- 所有 artifact 和节点确认必须由后端业务层持久化。

### 4.2 过早接真实 provider

旧项目中 provider spike、真实 smoke、成本台账、失败处理并行出现，造成验证面复杂。

避坑：

- MVP 先 deterministic runtime 跑通闭环。
- OpenAI/Coze/图片/视频/TTS 接入必须走 ProviderAdapter 主线。
- 每次真实调用前必须有预算、停止条件、证据目录和回退计划。
- 不把 provider 成功一次等同于产品链路完成。

### 4.3 前端体验与工程状态混杂

旧项目多次强调教师界面不能出现工程词，说明历史上工程字段泄漏反复发生。

避坑：

- 用户界面只显示教师可理解任务、产物、失败恢复。
- 开发诊断必须默认折叠。
- E2E 必须扫描普通主界面的工程词。
- 不能用源码词命名直接投射到 UI。

### 4.4 多分支并行缺少冻结区

旧项目有大量归档分支和收口提交，说明并行探索较多，主线收敛成本高。

避坑：

- 每条主线写入范围必须明确。
- 集成顺序固定：Backend contract -> Runtime -> Frontend -> E2E。
- 封板复核期间冻结 API contract、页面主流程、状态字段。
- 不允许多个分支同时改同一核心合同。

### 4.5 文档很多但执行合同不够硬

旧项目文档丰富，但有些规划长期停在“等待确认/未开发”。

避坑：

- 文档必须连接到测试和验收脚本。
- 每阶段必须有 stage plan、stage test plan、开发、集中测试、收尾提交。
- 不能只靠“写了规划文档”宣布推进完成。

### 4.6 路径漂移与工作区误写

当前四条新主线已经暴露过误写父目录风险，旧项目也有路径漂移经验。

避坑：

- 每个 agent 动手前必须 `git status --short --branch`。
- 文件编辑必须使用当前 worktree 绝对路径。
- 监控必须扫描 `E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\docs` 这类非 worktree 误落点。

## 5. 当前 ShanHaiEdu-Studio 未覆盖但应补齐的能力

### 5.1 Agent Workflow Runtime Mainline

缺口：当前 4 条 MVP 主线覆盖 backend/frontend/runtime/e2e，但缺少“可人工调优的节点运行时设计”。

应新增主线：`feature/agent-workflow-runtime-studio`

目标：建立版本化、可审计、可回滚的节点配置与人工调优系统。

核心合同：

- `NodeDefinition`
- `NodeRun`
- `PromptPack`
- `SkillBinding`
- `ToolPermission`
- `ReviewGate`
- `HumanGate`
- `RuntimeTrace`
- `Checkpoint`

第一阶段建议：只做文档和最小 deterministic 样例，不接真实 provider。

### 5.2 Skill Registry & PromptPack Mainline

缺口：旧项目有 skills catalog，新项目只有全局 skills 和私有 API 台账提示，缺少项目级 skill binding 真源。

应新增主线：`feature/skill-registry-promptpack`

目标：将技能、提示词、模板、provider adapter 拆成可版本化注册表。

不做：不复制旧 skills 全量代码；先建 contract 和 curated shortlist。

### 5.3 ReviewGate & Teacher Projection Mainline

缺口：新项目需要系统性质量门禁和教师侧脱敏投影，不应散落在 E2E。

应新增主线：`feature/review-gate-teacher-projection`

目标：定义所有节点产物的 public projection、工程词扫描、质量评分、失败恢复和人工确认策略。

### 5.4 Provider Adapter Mainline

缺口：私有 API 台账已存在，但尚未形成统一 ProviderAdapter 层。

应新增主线：`feature/provider-adapter-ledger-integration`

目标：基于私有 API 台账建立 OpenAI/Coze/Image/Video/TTS 统一 adapter 选择、能力矩阵和调用边界。

硬约束：不得提交台账、密钥、真实 endpoint 细节；所有引用只能写“已参考私有 API 台账”。

### 5.5 Video Pipeline Mainline

缺口：MVP 只做视频方案，未覆盖可控视频生产链。

应新增主线：`feature/intro-video-pipeline`

目标：导入视频从创意方案推进到分镜、资产、首帧、片段、拼接、验收。

前置依赖：ProviderAdapter、ReviewGate、ArtifactStorage。

## 6. 推荐新增主线优先级

在当前四条主线完成并集成后，推荐顺序：

```text
1. MVP Integration & Hardening
2. Agent Workflow Runtime Mainline
3. Skill Registry & PromptPack Mainline
4. ReviewGate & Teacher Projection Mainline
5. Provider Adapter Ledger Integration
6. PPT Generation Mainline
7. Intro Video Pipeline Mainline
```

原因：

- 先集成现有 MVP，不继续扩大分支面。
- 再补运行时可调优能力，否则 PPT/视频能力会再次堆到代码或 prompt 里。
- Provider 和真实生成后置，避免重演旧项目 provider 先行导致的失控。

## 7. 可迁移模块封装建议

### 7.1 配置化节点运行时

目标文件建议：

```text
docs\agent-runtime\node-definition-contract.md
docs\agent-runtime\prompt-pack-contract.md
docs\agent-runtime\skill-binding-contract.md
docs\agent-runtime\review-gate-contract.md
docs\agent-runtime\human-gate-contract.md
```

核心字段建议：

```text
node_key
title
agent_role
input_artifact_kinds
output_artifact_kind
prompt_pack_ref
skill_binding_refs
allowed_tools
review_gate_refs
human_gate
retry_policy
stale_downstream_policy
public_projection
```

### 7.2 人工调优台

目标：让产品/教研人员调节点，而不是改代码。

可调项：

- PromptPack 版本。
- 节点说明和任务卡文案。
- 允许使用的 skills。
- 模型/provider 偏好。
- 质量评分阈值。
- 人工确认点。
- 样例输入输出。
- 禁用词和教师侧文案。

MVP 形态：先做 Markdown/YAML + 管理文档，不急着做 UI。

### 7.3 质量门禁

门禁类型：

- ContractGate：输出字段和结构。
- TeacherProjectionGate：教师侧文案脱敏。
- ContentQualityGate：教学目标、重难点、流程、锚点质量。
- AssetGate：图片/视频资产是否存在、可下载、可预览。
- CostGate：是否需要真实 provider、预算和授权。
- DownstreamStaleGate：上游变更后下游需重审。

## 8. 严格禁止复刻的旧模式

- 不把 workflow 画布暴露给普通教师。
- 不把 prompt、schema、provider 调用散落在 UI 事件和后端 if 分支里。
- 不把真实 provider smoke 当成产品验收。
- 不把 fixture/mock/local preview 说成真实完成。
- 不在脏旧项目上继续开发。
- 不让多分支同时修改同一合同。
- 不复制旧 skills 全量目录到新项目。
- 不把私有 API 台账、解压目录、密钥或环境配置提交到仓库。

## 9. 新项目立即可执行的吸收动作

当前不建议马上新开更多开发分支，因为 4 条 MVP 主线正在运行。建议先做以下动作：

1. 将本文作为 `main` 权威吸收文档。
2. 四条 MVP 主线完成 Stage 1 后，要求它们阅读本文并检查是否与自身合同冲突。
3. MVP 集成前，新增 `docs\agent-runtime\` 合同文档，不写实现。
4. MVP 集成通过后，再新开 `Agent Workflow Runtime Mainline`。
5. Provider 能力只通过 `docs\private-api-ledger.md` 指向私有台账，不在公开文档摘录敏感内容。

## 10. 当前裁决

Decision：吸收旧项目资产，但暂不新开实现分支。

Reasoning：

- 当前四条主线已经并行运行，立即再开第五条实现主线会扩大协调面。
- 旧项目主 `main` 是脏的，不适合作为开发源。
- 当前最需要的是把旧项目机制变成新项目文档合同，供四条主线和后续集成引用。
- `Agent Workflow Runtime Mainline` 很重要，但应在 MVP Integration & Hardening 后启动。

Gate：continue。

Next：四条 MVP 主线 Stage 1 完成后，将本文纳入集成审查清单；如 Backend/Runtime 已经稳定，再启动 `Agent Workflow Runtime Mainline` 的文档阶段。

## 11. 五分支落点与同步策略

当前项目五个 worktree：

```text
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\backend-workflow-lite
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\frontend-api-backed-workbench
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\agent-runtime-adapter
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\e2e-verification
```

本文先落在 `main` 根目录，作为五分支共同读取的权威复盘文档。原因是四条功能 worktree 正在并行开发，其中部分工作区已有未提交阶段成果；若现在直接复制同名文件到这些 worktree，后续从 `main` 合并时可能造成 untracked 文件覆盖风险，反而干扰正在运行的主线。

同步原则：

- `main`：立即提交本文，作为权威来源。
- 四条功能 worktree：Stage 1 收尾或下一次从 `main` 集成时，通过正常合并获得本文，不手工复制未跟踪副本。
- 监督与 handoff：四条主线在阶段收尾、集成审查、合同调整前必须阅读本文。
- 如果某条主线已经完成阶段提交且工作区干净，再由该主线自行合并 `main`，让复盘文档进入该分支根目录。

这一策略满足“五分支共享复盘文档”的目标，同时避免把文档同步动作变成新的并行污染源。
