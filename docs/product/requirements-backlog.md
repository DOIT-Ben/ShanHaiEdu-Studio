# ShanHaiEdu 未完成需求总账

更新时间：2026-07-17

本文件只记录尚未完成、延期或未来需求。已完成阶段和历史证据不在此重复列举。

## 1. 当前P0

| ID | 未完成项 | 完成条件 | 当前边界 |
|---|---|---|---|
| P0-05A | 真实Provider连续性与V1-9就绪（活动） | 先完成离线harness、来源绑定、隔离与V1-9入口审计；另获真实调用授权后，在最终候选SHA上完成四场景连续3组并通过receipt校验 | 当前`liveCallsAuthorized=false`；不调用真实Provider、图片、视频、PPTX、ZIP，不创建V1-9 runId |
| P0-05B | 唯一V1-9真实产品链路 | P0-05A Go后重新冻结plan、manifest和runId，通过桌面真实全链路、文件验真与外部产物验收 | 不恢复整改前旧run、旧manifest或旧固定流程；不进入教师签收和release |
| P0-06 | V1签收与发布门 | V1-9通过后完成教师签收、候选环境、恢复、原子切流和发布后验证 | 部署与生产写入另取当次授权 |

V1.0智能体原子Tool控制面整改已完成并从本总账移除，证据见当前主线状态和归档。`node_modules`未逐文件字节冻结、依赖审计中危项、Lint warning和Turbopack动态追踪warning仍是发布级残余，只在未来release门重新评估。

## 2. 当前阶段固定边界

- 不恢复旧宏节点、固定Tool顺序、外层`toolPlan`/`deliveryPlan`编排、approve自动推进或固定五阶段UI。
- 不把Agents SDK、LangChain、LangGraph、Skill、Director或Critic升级为第二编排者。
- 不以Provider探针、离线fixture、历史运行或旧R5证据冒充当前重构通过。
- 不调用真实图片、视频、PPTX、ZIP或V1-9整包Provider。
- 不创建manifest/runId，不启动390px真实黑盒，不进入教师签收、部署、生产写入或公网切流。
- 不使用mock、placeholder、deterministic fallback或degraded结果冒充成功。
- 不做无关重构或批量格式化；commit与push只按用户当次授权执行，不部署、不移动标签。

## 3. 已接受未来需求

除P0-05A、P0-05B和P0-06外，未来需求统一从 `..\roadmap\README.md` 进入：

- 产品：反馈闭环、回复呈现、阶段QA、成果工作区、互动课件、容量与持续审查。
- 架构：Codex SDK候选、互动课件边界、V1.5成果工作区。
- UI：已审查的Demo设计吸收。
- 发布：反馈闭环实施、互动课件基础、V2.0前生产化和V1邀请制恢复手册。

这些事项未进入当前阶段，不得因文档已存在而自动实施。

## 4. 状态变更规则

新需求先在本表记录目标、验收层和优先级。进入当前阶段后移动到阶段plan；完成后从本表移除，并把阶段证据归档或写入当前状态，不保留`done`流水账。
