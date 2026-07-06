# ShanHaiEdu 媒体工作台 MVP 到生产架构方案

日期：2026-07-07

## 0. 结论

当前前端原型继续保留，作为第一版产品的主界面基础。第一版目标不是继续做 mock 原型，而是做一个真实可用的 MVB/MVP：

- 支持 1-2 人真实同时使用，架构上预留 5 人并发试运行。
- 使用真实大模型生成需求规格、教材证据摘要、教案、PPT 大纲、视频导入方案和最终交付清单。
- PPTX、视频成片、图片资产第一阶段可以先做“真实任务入口 + 可降级产物”，但不能把 mock 假装成真实完成。
- 前端继续按当前 Codex 风格工作台推进：左侧项目、中间对话、右侧压缩节点、点击侧栏详情。
- 后端按可迁移架构做，不为了快而把业务状态写死在前端或单个 prompt 里。

推荐路线：

```text
MVP 阶段：
Next.js 全栈应用
  - 前端工作台
  - Next API Routes / Server Actions
  - Postgres / Supabase 或本地 Postgres
  - Prisma
  - OpenAI Agents SDK / Responses API 服务端调用
  - 文件先落对象存储接口，开发期可用本地兼容层

生产阶段：
Next.js 前端
  -> BFF/API 服务
  -> Workflow Service
  -> Agent Runtime Adapter
  -> Python Agent Worker / OpenAI Agents SDK / Coze / 视频 / 图片 Adapter
  -> Postgres + Redis + Object Storage
  -> Temporal 或等价 durable workflow
```

## 1. 第一性原理：当前阶段真正要验证什么

本阶段的核心不是证明“所有节点质量都顶级”，而是证明：

1. 教师能不能从一句话开始走完整链路。
2. 系统能不能把每一步产物沉淀为节点。
3. 上游确认产物能不能进入下游。
4. 用户能不能查看、复制、复用、重做和确认。
5. 多用户同时使用时，项目、对话、节点、产物不会串。
6. 后续接 Coze、图片、视频、TTS、审查智能体时，不需要推翻第一版。

因此 MVP 的真实标准是：

- 不是 mock 静态数据。
- 可以真实登录或至少通过项目隔离识别不同用户。
- 可以真实新建项目。
- 可以真实发送对话。
- 可以真实调用模型生成文本类产物。
- 可以真实保存产物和状态。
- 可以真实恢复刷新后的项目状态。
- 可以真实下载 Markdown / JSON-free teacher-facing 文档。

第一版不强求：

- PPTX 生成质量一次到位。
- 视频成片真实可商用。
- 教材检索覆盖所有版本。
- 多租户计费和企业权限完整。
- 长任务全量 durable workflow。

## 2. 已有方案与可复用能力

### 2.1 当前前端原型

当前项目 `E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main` 是独立 Next.js 前端工作台：

- 技术栈：Next.js 16、React 19、TypeScript、Tailwind CSS 4、Radix UI、lucide-react。
- 主壳：`src\components\layout\MediaWorkbench.tsx`。
- 状态控制：`src\hooks\useWorkbenchController.ts`。
- 数据结构：`src\lib\types.ts`。
- mock 数据：`src\lib\mock-artifacts.ts`、`src\lib\mock-flow.ts`、`src\lib\mock-projects.ts`。

优点：

- UI 架构已经接近最终产品形态。
- 组件边界清楚，适合接真实 API。
- 右侧节点、详情侧栏、对话输入、复制/复用交互已经成型。

限制：

- 当前是纯客户端状态。
- 刷新后状态不可恢复。
- 没有用户隔离。
- 没有真实模型调用。
- 没有持久化项目、对话、产物。

### 2.2 OpenAI Agents SDK / Responses API

OpenAI Agents SDK 适合承载：

- 主控智能体。
- 需求分析智能体。
- 教材/教案智能体。
- PPT 规划智能体。
- 视频创意智能体。
- 审查智能体。
- 工具调用、handoff、guardrail、trace。

但它不应该承载：

- 项目数据库真源。
- 产物版本真源。
- 用户权限真源。
- 工作流长期状态真源。
- 文件存储真源。

MVP 可先用服务端 Agent Runtime Adapter 包一层：

```ts
export interface AgentRuntime {
  runTurn(input: WorkbenchTurnInput): Promise<WorkbenchTurnResult>;
}
```

第一阶段至少有两个实现：

```text
DeterministicRuntime：用于稳定端到端联调，不伪装成真实生成。
OpenAIRuntime：真实调用 OpenAI，生成文本类产物。
```

### 2.3 数据库与存储

MVP 推荐：

- Postgres：项目、用户、对话、节点、产物、任务记录。
- Prisma：类型化数据访问，和当前 Next.js/TypeScript 栈匹配。
- 对象存储接口：产物文件、Markdown、PPTX、图片、视频。
- 开发期可以先用本地文件兼容层，但代码层必须通过 `ArtifactStorage` 接口，不直接散落本地路径。

生产推荐：

- Postgres 主库。
- Redis 做短期缓存、任务状态广播、限流。
- S3 / R2 / MinIO 做对象存储。
- Temporal 承载长流程、重试、恢复、人工确认。

## 3. MVP 与最终产品的架构分层

### 3.1 MVP 架构

```text
Browser
  -> Next.js App Router UI
  -> Workbench API
      -> Project Service
      -> Conversation Service
      -> Artifact Service
      -> Workflow Lite Service
      -> Agent Runtime Adapter
          -> OpenAI Runtime
          -> Deterministic Runtime
      -> Prisma
      -> Artifact Storage
  -> Postgres
```

MVP 可以保持单体 Next.js，但必须按模块边界写：

```text
src\app\api\workbench\...
src\server\projects\...
src\server\conversation\...
src\server\artifacts\...
src\server\workflow\...
src\server\agent-runtime\...
src\server\storage\...
src\server\db\...
```

这样后续拆成独立 NestJS / Python worker 时，迁移的是模块，不是重写产品。

### 3.2 生产架构

```text
Next.js Web
  -> BFF / API Gateway
  -> Auth / Tenant / Project
  -> Workflow Service
      -> Temporal Workflow
      -> Task Queue
  -> Agent Runtime Service
      -> OpenAI Agents SDK
      -> Python specialized workers
      -> Review workers
  -> Provider Adapter Layer
      -> Coze PPT
      -> Image generation
      -> Video generation
      -> TTS
      -> Document export
  -> Postgres
  -> Redis
  -> Object Storage
  -> Observability
```

生产阶段的核心变化：

- Workflow Lite 迁移到 Temporal。
- Next API 中的 Agent Runtime Adapter 迁移到独立 worker。
- 本地/简化 storage 迁移到对象存储。
- 简单用户隔离升级为完整 auth / tenant / permission。
- 轮询状态升级为事件流 / WebSocket / Server-Sent Events。

## 4. MVP 必须真实可用的范围

### 4.1 必须真实

1. 新建项目。
2. 保存项目配置。
3. 对话发送与模型回复。
4. 需求分析与缺失字段追问。
5. 需求规格说明书 Markdown。
6. 教材证据包：可先由用户粘贴/上传文本，真实生成摘要和页码依据。
7. 教案 Markdown。
8. PPT 大纲和逐页脚本。
9. 导入视频创意方案。
10. 最终交付清单。
11. 节点状态保存。
12. 刷新恢复。
13. 复制、作为输入、查看详情。

### 4.2 可以降级但必须明示

1. PPTX 文件：第一版可先输出 PPT 大纲 + Markdown / HTML 预览，再接 Coze PPTX。
2. 视频成片：第一版可先输出视频脚本、分镜、镜头提示词，不假装已生成视频。
3. 图片资产：第一版可先输出 prompt 和用途，后接真实图片生成。
4. 教材检索：第一版可先支持上传/粘贴教材，不强行做全网教材库。

### 4.3 不做

1. 企业级账号体系。
2. 计费。
3. 大规模并发。
4. 完整视频剪辑。
5. 所有教材版本自动检索。
6. 复杂权限审批。

## 5. 数据模型草案

```text
User
  id
  displayName
  createdAt

Project
  id
  ownerId
  title
  grade
  subject
  textbookVersion
  lessonTopic
  status
  currentNodeKey
  createdAt
  updatedAt

ConversationMessage
  id
  projectId
  role
  content
  artifactRefs
  createdAt

WorkflowNode
  id
  projectId
  key
  title
  status
  upstreamNodeKeys
  approvedArtifactId
  staleReason
  updatedAt

Artifact
  id
  projectId
  nodeKey
  title
  kind
  status
  summary
  markdownContent
  structuredContent
  version
  isApproved
  createdAt
  updatedAt

AgentRun
  id
  projectId
  nodeKey
  status
  runtime
  startedAt
  finishedAt
  errorMessage
```

用户可见界面不显示这些字段名；它们只用于后端和开发。

## 6. API 契约草案

```text
GET    /api/workbench/projects
POST   /api/workbench/projects
GET    /api/workbench/projects/:projectId

GET    /api/workbench/projects/:projectId/messages
POST   /api/workbench/projects/:projectId/messages

GET    /api/workbench/projects/:projectId/artifacts
GET    /api/workbench/projects/:projectId/artifacts/:artifactId
POST   /api/workbench/projects/:projectId/artifacts/:artifactId/approve
POST   /api/workbench/projects/:projectId/artifacts/:artifactId/regenerate

POST   /api/workbench/projects/:projectId/use-as-input
GET    /api/workbench/projects/:projectId/snapshot
```

MVP 可以先用普通 request/response；生成时间变长后升级：

```text
GET /api/workbench/projects/:projectId/events
```

用于 Server-Sent Events 推送节点进度。

## 7. 智能体职责设计

### 7.1 MVP 智能体

MVP 可以先做 1 个主控 runtime + 4 个任务模式，而不是一开始拆成很多真实独立 agent：

1. `requirement_intake`：需求分析、缺失字段、配置清单、需求规格。
2. `lesson_planning`：教材证据、教案。
3. `ppt_planning`：PPT 大纲、风格、逐页脚本。
4. `video_intro_planning`：视频创意、课程锚点、分镜提示。
5. `delivery_summary`：最终交付清单。

### 7.2 生产智能体

生产再拆：

- 主控智能体。
- 需求智能体。
- 教材智能体。
- 教案智能体。
- PPT 规划智能体。
- Coze PPT 执行适配器。
- 视频创意智能体。
- 分镜智能体。
- 图片资产智能体。
- 视频生成智能体。
- 剪辑智能体。
- 审查智能体。
- 交付智能体。

## 8. 并行开发分工

建议至少拆成 4 条并行分支，而不是一个人从头到尾排队：

### 分支 A：前端真实数据接入

目标：保留现有美学与交互，把 mock controller 改成 API-backed controller。

职责：

- 拆 `useWorkbenchController`。
- 引入 workbench API client。
- 支持项目列表真实加载。
- 支持消息发送后追加真实回复。
- 支持节点产物从后端加载。
- 保留 hover、侧栏、复制、作为输入、确认、重做交互。

验收：

- 不破坏现有视觉。
- 刷新后项目状态还在。
- 1 个项目完整链路能走到最终交付清单。

### 分支 B：后端数据与工作流 Lite

目标：建立 MVP 的真实状态真源。

职责：

- Prisma schema。
- Project / Message / Artifact / WorkflowNode。
- API routes。
- Workflow Lite 状态推进。
- Artifact approve / regenerate。
- 基础并发隔离。

验收：

- 两个项目互不串。
- 两个浏览器用户同时操作不覆盖。
- API contract tests 通过。

### 分支 C：Agent Runtime Adapter

目标：真实调用 OpenAI，同时保留 deterministic runtime 用于稳定测试。

职责：

- AgentRuntime interface。
- DeterministicRuntime。
- OpenAIRuntime。
- 节点 prompt templates。
- 输出 Markdown artifact。
- 错误恢复。

验收：

- 无 key 时 deterministic runtime 可跑完整 E2E。
- 有 key 时 OpenAI runtime 能生成真实文本产物。
- 模型失败时前端显示教师可理解恢复态。

### 分支 D：E2E 验证与试运行

目标：把“能跑”变成“可被信任地跑”。

职责：

- Playwright E2E。
- 1-2 用户并发 smoke。
- 构建检查。
- 关键路径截图。
- 失败恢复用例。

验收：

- 新建项目 -> 输入需求 -> 需求规格 -> 教案 -> PPT 大纲 -> 视频方案 -> 最终交付。
- 两个独立项目并行运行。
- 页面无工程词暴露。

## 9. 推荐分支命名

```text
feature/mvp-frontend-api-backed-workbench
feature/mvp-backend-workflow-lite
feature/mvp-agent-runtime-adapter
feature/mvp-e2e-verification
```

合并顺序：

```text
backend contract skeleton
-> frontend API-backed shell
-> deterministic runtime E2E
-> OpenAI runtime
-> E2E verification
```

不要等所有分支都完美再集成。最早应在第一个工作日内合出一个 vertical slice：

```text
新建项目 -> 发送一句话 -> 后端保存消息 -> runtime 返回需求分析 -> artifact 保存 -> 前端显示节点
```

## 10. 迁移策略

MVP 阶段要避免三类锁死：

1. 不把 OpenAI SDK 直接写进 React 组件。
2. 不把文件路径直接写进 artifact 数据。
3. 不把节点推进逻辑散落在 UI 事件里。

必须保留这些接口：

```ts
AgentRuntime
ArtifactStorage
WorkflowRepository
WorkflowEngine
ProviderAdapter
```

后续迁移时：

- `WorkflowEngine` 从 lite implementation 换成 Temporal。
- `AgentRuntime` 从 Next server implementation 换成 Python worker。
- `ArtifactStorage` 从本地/开发实现换成 S3/R2/MinIO。
- `ProviderAdapter` 增加 Coze、图片、视频、TTS。
- 前端 API contract 尽量不变。

## 11. 风险

### 11.1 最大风险

为了快，把 MVP 写成“前端状态 + 一个大 prompt + 临时文件”。这会导致后续无法多人使用，也无法迁移。

控制方式：

- 第一版也必须有数据库。
- 第一版也必须有 artifact 状态。
- 第一版也必须有 runtime adapter。
- 第一版也必须有 deterministic fallback。

### 11.2 成本风险

真实 OpenAI 调用可能不稳定或有成本。

控制方式：

- 默认 deterministic runtime。
- 项目级 runtime 开关。
- 每次真实调用写 AgentRun。
- 失败不无限重试。

### 11.3 质量风险

节点产物质量可能不够好。

控制方式：

- MVP 明确低质量可接受，但不能伪装。
- 先保证链路，再优化 prompt 和审查。
- 每个节点保留重做和用户确认。

### 11.4 并发风险

1-2 人同时使用时，状态串扰或覆盖。

控制方式：

- 所有数据按 projectId 隔离。
- 更新 artifact 时带版本号。
- approve 操作只批准当前版本。

## 12. 验证标准

MVP 完成必须满足：

1. `npm run build` 通过。
2. 数据库 schema 可初始化。
3. 可以新建项目。
4. 可以发送对话并保存。
5. 可以真实生成至少 4 类文本产物：需求规格、教案、PPT 大纲、视频方案。
6. 可以刷新恢复。
7. 可以复制和作为下一步输入。
8. 可以确认节点。
9. 两个项目互不影响。
10. 两个浏览器会话同时跑不串数据。
11. 无 OpenAI key 时仍可用 deterministic runtime 跑完整链路。
12. 有 OpenAI key 时可真实调用并保存产物。
13. 用户可见界面无工程词。

## 13. 工程评审结论

Decision：拆分接受，先做 MVP，长期生产架构同步设计。

Reasoning：

- 用户需要尽快看到真实闭环，不应该继续停留在 mock 原型。
- 现有前端已经足够好，应该接真实状态，而不是重写 UI。
- 多用户试运行必须引入数据库和项目隔离。
- OpenAI SDK 适合做 runtime，不适合做业务状态真源。
- 分支并行可以加速，但必须先统一 API contract 和数据模型。

Gate：continue，但第一步必须先落 backend contract skeleton。

Next：

1. 创建 `feature/mvp-backend-workflow-lite`，先做 schema 和 API contract。
2. 创建 `feature/mvp-frontend-api-backed-workbench`，前端基于 contract 接入。
3. 创建 `feature/mvp-agent-runtime-adapter`，先 deterministic，再 OpenAI。
4. 创建 `feature/mvp-e2e-verification`，独立做 E2E 和并发 smoke。
