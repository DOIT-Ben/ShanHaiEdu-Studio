# 主线：MVP Backend Workflow Lite

## 1. 主线目标

建立 ShanHaiEdu Media Workbench MVP 的真实状态真源。

本主线负责项目、对话、节点、产物、确认状态和基础工作流推进。它不负责 UI 美学，也不直接负责模型生成质量。

## 2. 为什么先做这条主线

如果没有后端状态真源，前端只能继续停留在 mock。真实 MVP 必须先证明：

- 项目能保存。
- 对话能保存。
- 节点产物能保存。
- 用户确认能保存。
- 刷新后能恢复。
- 多项目不会串数据。

## 3. 可复用方案

- Next.js API Routes / Server Actions：适合 MVP 阶段快速建立本地全栈闭环。
- Prisma：类型化数据库访问，适合当前 TypeScript 栈。
- Postgres：生产可迁移的数据真源。
- 本地开发可先用 SQLite 或本地 Postgres，但 schema 设计必须可迁移到 Postgres。

## 4. 职责边界

负责：

- 数据模型。
- API 合同。
- 工作流节点状态。
- 产物版本。
- 用户确认。
- 刷新恢复。
- 基础并发隔离。

不负责：

- 前端视觉。
- OpenAI prompt 质量。
- PPTX 文件生成。
- 视频成片。
- 企业级权限和计费。

## 5. 长期阶段

### 阶段 1：数据模型与 API 合同

交付：

- `Project`
- `ConversationMessage`
- `WorkflowNode`
- `Artifact`
- `AgentRun`
- API contract 文档。
- contract tests。

验收：

- 可以创建项目。
- 可以保存和读取消息。
- 可以保存和读取 artifact。
- 可以返回项目 snapshot。

### 阶段 2：Workflow Lite

交付：

- 节点初始化。
- 节点状态推进。
- approve / regenerate。
- 上游变更后下游标记需重审。

验收：

- approved artifact 能成为下游输入。
- regenerate 保留旧版本。
- stale 节点不丢内容。

### 阶段 3：并发与恢复

交付：

- projectId 隔离。
- artifact version guard。
- 刷新恢复。
- 失败记录。

验收：

- 两个项目互不影响。
- 两个浏览器会话不会覆盖同一 artifact 的当前版本。

## 6. 测试策略

- 数据模型测试。
- API contract tests。
- service tests。
- snapshot 恢复测试。
- project isolation tests。

## 7. 集成输入输出

对前端输出：

- 项目列表。
- 项目 snapshot。
- 消息列表。
- 节点列表。
- artifact 详情。

对 Runtime 输入：

- 当前项目配置。
- 当前节点。
- 已确认上游产物。
- 用户消息。

接收 Runtime 输出：

- assistant message。
- artifact draft。
- node status update。
- run status。

## 8. 阻塞条件

- 数据模型未定，不允许前端硬写 API。
- API 合同未定，不允许 E2E 写死 mock shape。
- artifact 版本规则未定，不允许做重做和确认。
