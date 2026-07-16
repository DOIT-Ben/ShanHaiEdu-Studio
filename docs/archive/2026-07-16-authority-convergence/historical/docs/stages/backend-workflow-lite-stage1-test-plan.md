# Backend Workflow Lite Stage 1 Test Plan

日期：2026-07-07

## 1. 测试目标

Stage 1 测试先于实现，用来锁定后端状态真源和 API 合同的最小可信闭环：

- 项目能创建并初始化默认节点。
- 消息能按 projectId 保存和读取。
- artifact 能按 projectId 和 nodeKey 保存和读取。
- snapshot 能恢复项目、消息、节点、artifact。
- 两个项目的数据不会串。

## 2. 测试边界

本阶段测试：

- repository/service 合同。
- API 路由背后的数据 shape。
- SQLite 开发库下的真实 Prisma 写入读取。

本阶段不测试：

- OpenAI 或任何真实 provider。
- 前端视觉和浏览器交互。
- PPTX、图片、视频文件生成。
- approve/regenerate 的完整版本守卫。

## 3. 测试环境

- 测试框架：Vitest。
- 数据库：独立 SQLite 测试库，来自 `DATABASE_URL`。
- 资源限制：Vitest worker 固定为 2，避免本机高并发测试占用过高。

推荐命令：

```powershell
$env:DATABASE_URL="file:./dev.db"; npm run db:push
$env:DATABASE_URL="file:./dev.db"; $env:VITEST_MAX_WORKERS="2"; npm run test:stage1
npm run build
git diff --check
```

## 4. 红绿测试清单

### T1：创建项目会初始化节点

步骤：

1. 调用 `WorkbenchService.createProject({ title })`。
2. 读取 snapshot。

期望：

- 返回 project id。
- snapshot 中包含 Project。
- snapshot 中包含默认工作流节点。
- 当前节点为首个节点。

### T2：消息按项目保存与读取

步骤：

1. 创建 Project A。
2. 写入 teacher message。
3. 读取 Project A messages。

期望：

- messages 数量为 1。
- role 为 `teacher`。
- content 与输入一致。

### T3：artifact 按项目和节点保存与读取

步骤：

1. 创建 Project A。
2. 写入 `lesson_plan` artifact。
3. 读取 Project A artifacts。

期望：

- artifacts 数量为 1。
- nodeKey 为 `lesson_plan`。
- markdownContent 保持原文。
- version 为 1。

### T4：snapshot 聚合项目状态

步骤：

1. 创建 Project A。
2. 写入 message。
3. 写入 artifact。
4. 读取 snapshot。

期望：

- snapshot.project 存在。
- snapshot.messages 包含写入消息。
- snapshot.nodes 包含默认节点。
- snapshot.artifacts 包含写入 artifact。

### T5：两个项目互不串数据

步骤：

1. 创建 Project A 和 Project B。
2. 分别写入不同消息和 artifact。
3. 读取两个项目 snapshot。

期望：

- Project A snapshot 只包含 A 的消息与 artifact。
- Project B snapshot 只包含 B 的消息与 artifact。
- 任一 snapshot 不出现另一项目的标题、消息或 artifact 摘要。

## 5. 集中验收记录模板

阶段完成时在提交前记录：

```text
Stage 1 验收：
- npm run test:stage1: [exit code]
- npm run build: [exit code]
- git diff --check: [exit code]
- 数据隔离结论：
- 未覆盖风险：
```
