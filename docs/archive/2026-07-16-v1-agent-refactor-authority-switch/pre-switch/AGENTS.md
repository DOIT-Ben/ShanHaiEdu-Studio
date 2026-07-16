# ShanHaiEdu-Studio 项目准则

> 本文件只记录跨阶段长期有效的工程规则。优先级：平台与安全限制 > 用户当前明确指令 > 本文件 > 活动需求与计划。历史文档只能提供证据，不能恢复旧流程。

## 1. 当前权威与读取顺序

开始新会话、新阶段或接管工作前，按顺序读取：

1. `AGENTS.md`
2. `docs\README.md`
3. `docs\product\current-requirements-baseline.md`
4. `docs\product\requirements-backlog.md`
5. `docs\mainlines\current-mainline-status.md`
6. `docs\architecture\README.md`及当前相关 ADR
7. `docs\stages\README.md`及唯一活动阶段的 plan / test-plan

冲突时按以下顺序裁决：

```text
当前明确指令
> 产品需求基线
> 当前主线状态
> 已接受架构决策
> 当前阶段 plan / test-plan
> Roadmap
> Archive 与历史证据
```

`docs\archive\` 默认不参与搜索、规划、开发或验收判断。只有追溯历史原因、校验证据或用户明确要求时才定向读取；不得从 archive 恢复过时断言、固定流程、旧 run 或旧 Provider/Skill lock。

## 2. 文档职责

- `docs\product\current-requirements-baseline.md`：只写产品不变量和质量门禁，不写 runId、测试计数或阶段年表。
- `docs\product\requirements-backlog.md`：只写未完成、延期和未来需求，不保存已完成流水账。
- `docs\mainlines\current-mainline-status.md`：只写当前事实、五层证据、阻塞和下一动作。
- `docs\architecture\`：只保留当前架构入口和已接受 ADR。
- `docs\stages\`：只保留唯一活动阶段的 plan、test-plan 和索引。
- `docs\roadmap\`：保存已接受但尚未进入当前阶段的未来工作；不得自动启动。
- `docs\archive\`：保存历史原文、迁移清单和审计证据；不得作为活动权威。
- `docs\contracts\`、`docs\runbooks\`：只保留当前仍生效的合同或操作边界。

新增需求先进入 backlog；进入当前阶段后再写 plan 和 test-plan。完成或失效的阶段材料通过带 SHA-256 的迁移清单归档，不堆回活动目录。

## 3. 产品与控制面不变量

- ShanHaiEdu 是由产品 Main Agent 自主编排的非固定 DAG 教师备课工作台，不是线性审批台或 mock 展示页。
- Main Agent 是业务 Tool 选择、下一步、Observation、Replan、重试和停止的唯一编排者。兼容层、Runner、Skill、Director、Critic和外部 Codex均不得取得第二编排权。
- 明确交付任务必须形成完整 `TaskBrief`、`IntentGrant`、`IntentEpoch`、强度、预算和计划版本；所有可执行 Tool 必须通过有效 `ExecutionEnvelope`。
- 标准授权范围内的可逆内部工作零例行确认。只有缺少不可推断选择、有效授权或预算，或涉及外发、权限变化、覆盖删除等真实副作用时进入 `HumanGate`。
- Tool结果先原子持久化 `ToolInvocation`、`ValidationReport`、`Observation`、事件和允许的 Artifact，再由同一 Main Agent 决定后续动作。
- mock、placeholder、deterministic draft、文本 fallback、degraded 产物和未验证文件不得冒充真实完成。
- 最终包必须来自正式持久化的当前版本 package asset；不得从最新版、未批准版、不同任务或临时路径现场拼装。
- 业务 Skill 只能增强 Main Agent 已选择的高层 Tool，不能选择下一 Tool、批准、返修或接管控制面。
- 现行业务 Skill 权威源是集合根既有 `shanhaiedu-技能系统`；运行时 projection 是冻结投影，不是新的 Skill 系统。

## 4. 教育交付不变量

- 教案必须结构化并可被 PPT、图片和视频继续消费。
- PPT 设计必须逐页表达底图、元素、文字、排版、教学动作和视觉重点；真实 PPTX 以文件结构和实际 slideCount 验真。
- 视频先作为脱离教材仍成立的独立创意短片，再以唯一最小课程锚点回接任务。不得自动收缩为儿童、教师、教室或课堂活动。
- 完整视频必须保留脚本、镜头、资产、声音、字幕、时间线和质量证据；真实交付时长为30至90秒。
- 教师签收、内部质量通过和下游可用是不同事实，不得互相伪造。

## 5. 工程实施

- 动手前明确目标、范围、成功标准、风险和回退；只改与当前目标直接相关的内容。
- 先读目标文件、相关测试和一个相似实现，先检查 `git status --short`，保留来源不明和用户在途改动。
- 需求或架构实质变化先更新活动文档，再写会失败的特征测试，再做最小实现和定向回归。
- 同一责任层连续两轮没有新证据时，记录已知事实、失败点和恢复入口，转向不依赖项，不做等价循环。
- 配置、端点、模型、凭据和开关不得硬编码进业务代码；Provider事实以API台账和运行时选择合同为准。
- 不绑定 `superpowers` 等开发方法 Skill。成熟库可以用于实现，但不得改变产品控制权和验收边界。
- 单文件约超过500行、单函数或组件约超过150行，或承载多个无关职责时，新增功能前先评估拆分。

## 6. 前端与消息边界

- 教师对话区以 `assistant-ui` 为唯一目标 UI Runtime；项目自有 `MessagePart` 和 `AgentEventEnvelope` 是数据库与 API 合同。
- 前端只投影线程、消息、计划、Tool状态、Artifact引用、HumanGate和错误恢复，不成为业务真源，不从正文关键词猜测状态。
- 保留安静、工作导向的三栏工作台；中间对话是主视觉，不做营销页、大Hero、卡片套卡片或无意义动效。
- 教师界面不得暴露 schema、provider、node_id、storage、debug、local path、token或内部推理。
- V1发布前的真实浏览器门只运行桌面视口；不新增390px真实黑盒，除非用户当次明确要求。既有窄屏合同与历史证据保留。

## 7. 验收与发布边界

所有结论分别标记：

```text
contract / executor / model orchestration / product E2E / release
```

低层通过不得上推为高层完成。fixture只能证明仓内合同；真实模型、真实文件、真实产品链路和发布必须分别有新鲜证据。

- R5已经关闭，默认不重跑。
- V1-9是唯一一次产品 Main Agent 真实全链路；只有当前Go/No-Go全部通过后才允许创建新运行。
- 运行开始时冻结合同与摘要；实质升级必须终止旧运行并创建显式后继，不得在同一run静默换规则。
- V1-9通过前不得进入教师签收、部署、生产写入或V1-10切流。
- 部署、不可逆操作和教师签收需要当次授权；未经要求不commit、不push、不移动历史标签。

## 8. 验证与安全

- 声称完成前执行与风险相称的定向测试、TypeScript、构建、链接、哈希或实际环境验证；只有实际执行成功的命令才能报告为通过。
- 文档迁移必须先保存原文快照和逐文件 SHA-256 manifest；历史原文迁移后字节保持不变。
- 更新本文件前，必须在项目 archive 和 `C:\Users\HB\.codex\AGETNS-bak\` 各保存一份时间戳备份，并在更新后立即重新读取。
- 不触碰 `.env`、密钥、私有API台账、SQLite/WAL/SHM、用户上传、Artifact、真实媒体、旧run状态或Git标签，除非用户明确授权具体操作。
- 不在回复、日志、提交、文档或截图中明文展示密钥、token、账号和个人敏感信息。
