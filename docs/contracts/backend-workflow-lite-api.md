# Backend Workflow Lite API Contract

日期：2026-07-07
适用分支：`feature/mvp-backend-workflow-lite`

## 1. 合同定位

本文档是 ShanHaiEdu Media Workbench MVP 后端状态真源合同，供 Frontend API-backed Workbench、Agent Runtime Adapter 和 E2E Verification 主线接入。

本合同提供：

- Project 保存与读取。
- ConversationMessage 保存与读取。
- WorkflowNode snapshot 恢复。
- Artifact 保存、读取、approve、regenerate。
- Approved upstream inputs 读取。
- AgentRun start / finish 与失败恢复。
- projectId 隔离和 409 冲突合同。

本合同不提供：

- OpenAI 或任何真实 provider 调用。
- PPTX、图片、视频文件生成。
- 用户登录、租户、计费、生产权限。
- 前端教师态文案映射。

## 2. 状态与节点字典

### WorkflowNodeKey / ArtifactKind

```text
requirement_spec
textbook_evidence
lesson_plan
ppt_draft
intro_video_plan
image_prompts
video_storyboard
final_delivery
```

### WorkflowNodeStatus / ArtifactStatus

```text
not_started
in_progress
needs_review
approved
blocked
stale
failed
```

### AgentRunStatus

```text
running
succeeded
failed
```

## 3. 通用规则

- 所有项目内资源必须带 `projectId` 路径参数访问。
- 跨项目读取或写入 artifact / run 会返回 404 或 service error。
- `snapshot` 是前端刷新恢复的主入口。
- `approved-inputs` 是 Runtime 读取已确认上游输入的主入口。
- `regenerate` 永远创建未确认的新版本，不会覆盖旧版本。
- `approve` 会把同项目同 nodeKey 的其他 artifact 取消 approved。
- 上游新版本 approve 后，已确认的直接下游 node 会变为 `stale`，但旧 artifact 保留。
- failed AgentRun 不删除旧 artifact，不清空 node 的 `approvedArtifactId`。

## 4. Endpoints

### GET /api/workbench/projects

返回项目列表。

Response:

```json
{
  "projects": [
    {
      "id": "project_id",
      "title": "五年级《百分数》公开课",
      "status": "active",
      "currentNodeKey": "requirement_spec",
      "grade": "五年级",
      "subject": "数学",
      "textbookVersion": "人教版",
      "lessonTopic": "百分数",
      "createdAt": "2026-07-07T00:00:00.000Z",
      "updatedAt": "2026-07-07T00:00:00.000Z"
    }
  ]
}
```

### POST /api/workbench/projects

创建项目，并初始化 8 个默认 workflow nodes。

Request:

```json
{
  "title": "五年级《百分数》公开课",
  "grade": "五年级",
  "subject": "数学",
  "textbookVersion": "人教版",
  "lessonTopic": "百分数"
}
```

Response: `201`

```json
{
  "project": {
    "id": "project_id",
    "title": "五年级《百分数》公开课",
    "status": "active",
    "currentNodeKey": "requirement_spec"
  }
}
```

### GET /api/workbench/projects/[projectId]

读取单个项目。当前合同中不存在项目返回 `200 { "project": null }`。

Response:

```json
{
  "project": {
    "id": "project_id",
    "title": "五年级《百分数》公开课"
  }
}
```

### GET /api/workbench/projects/[projectId]/snapshot

刷新恢复主入口。

Response:

```json
{
  "project": {},
  "messages": [],
  "nodes": [],
  "artifacts": [],
  "agentRuns": []
}
```

`nodes` 按 `order` 升序返回；`artifacts` 按 `nodeKey` / `version` 升序返回；`agentRuns` 按 `startedAt` 升序返回。

### GET /api/workbench/projects/[projectId]/messages

返回项目消息。

Response:

```json
{
  "messages": [
    {
      "id": "message_id",
      "projectId": "project_id",
      "role": "teacher",
      "content": "我要做百分数公开课",
      "artifactRefs": [],
      "createdAt": "2026-07-07T00:00:00.000Z"
    }
  ]
}
```

### POST /api/workbench/projects/[projectId]/messages

保存消息。

Request:

```json
{
  "role": "teacher",
  "content": "我要做百分数公开课",
  "artifactRefs": ["artifact_id"]
}
```

Response: `201`

```json
{
  "message": {
    "id": "message_id",
    "role": "teacher",
    "content": "我要做百分数公开课",
    "artifactRefs": ["artifact_id"]
  }
}
```

### GET /api/workbench/projects/[projectId]/artifacts

返回项目全部 artifacts。

Response:

```json
{
  "artifacts": []
}
```

### POST /api/workbench/projects/[projectId]/artifacts

保存 artifact draft。Runtime 可用此接口写入节点产物。

Request:

```json
{
  "nodeKey": "requirement_spec",
  "kind": "requirement_spec",
  "title": "需求规格",
  "status": "needs_review",
  "summary": "百分数公开课需求",
  "markdownContent": "# 需求规格",
  "structuredContent": {}
}
```

Response: `201`

```json
{
  "artifact": {
    "id": "artifact_id",
    "projectId": "project_id",
    "nodeKey": "requirement_spec",
    "kind": "requirement_spec",
    "status": "needs_review",
    "version": 1,
    "isApproved": false
  }
}
```

### GET /api/workbench/projects/[projectId]/artifacts/[artifactId]

读取单个 artifact。跨项目 artifact 返回 404。

Response:

```json
{
  "artifact": {
    "id": "artifact_id",
    "version": 1,
    "markdownContent": "# 需求规格"
  }
}
```

### POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/approve

确认 artifact。

Response:

```json
{
  "artifact": {
    "id": "artifact_id",
    "status": "approved",
    "isApproved": true
  }
}
```

行为：

- 同项目同 nodeKey 仅保留一个 approved artifact。
- 对应 node 更新为 `approved`。
- 如果确认的是上游新版本，已确认的直接下游 node 标记为 `stale`。

### POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/regenerate

重做 artifact，创建新版本。

Request:

```json
{
  "expectedLatestVersion": 1,
  "title": "需求规格 v2",
  "summary": "百分数公开课需求 v2",
  "markdownContent": "# 需求规格 v2",
  "structuredContent": {}
}
```

Response: `201`

```json
{
  "artifact": {
    "id": "new_artifact_id",
    "nodeKey": "requirement_spec",
    "version": 2,
    "status": "needs_review",
    "isApproved": false
  }
}
```

冲突：

- 如果传入 `expectedLatestVersion` 且与当前 latest version 不一致，返回 409。
- 不传 `expectedLatestVersion` 时保持兼容，按当前 latest version + 1 创建。

### GET /api/workbench/projects/[projectId]/approved-inputs?nodeKey=lesson_plan

返回目标 node 的已确认上游 artifacts。

Response:

```json
{
  "artifacts": [
    {
      "id": "artifact_id",
      "nodeKey": "requirement_spec",
      "isApproved": true,
      "markdownContent": "# 需求规格"
    }
  ]
}
```

错误：

- `nodeKey` 非法返回 400。

### POST /api/workbench/projects/[projectId]/agent-runs

创建运行记录，并把对应 node 标记为 `in_progress`。

Request:

```json
{
  "nodeKey": "lesson_plan",
  "runtime": "deterministic"
}
```

Response: `201`

```json
{
  "run": {
    "id": "run_id",
    "projectId": "project_id",
    "nodeKey": "lesson_plan",
    "status": "running",
    "runtime": "deterministic",
    "finishedAt": null
  }
}
```

错误：

- `nodeKey` 非法返回 400。

### POST /api/workbench/projects/[projectId]/agent-runs/[runId]/finish

结束运行。

Request:

```json
{
  "status": "failed",
  "errorMessage": "生成未完成，请稍后重试。"
}
```

Response:

```json
{
  "run": {
    "id": "run_id",
    "status": "failed",
    "errorMessage": "生成未完成，请稍后重试。",
    "finishedAt": "2026-07-07T00:00:00.000Z"
  }
}
```

行为：

- 只接受 `succeeded` / `failed`。
- 非 running run 再次 finish 返回 409。
- 旧 run 迟到 finish 时只更新 run 自身，不覆盖新 run 对应的 node 状态。
- latest run failed 时 node 标记 `failed`。
- succeeded 不会自动 approve node。

## 5. 错误码

| 场景 | HTTP |
| --- | --- |
| 非法 nodeKey | 400 |
| 非法 run status | 400 |
| 跨项目 artifact / run 或资源不存在 | 404 |
| 已完成 run 重复 finish | 409 |
| artifact expected latest version 冲突 | 409 |

## 6. Runtime 接入顺序

推荐 Runtime 执行一个节点时按以下顺序：

```text
GET snapshot 或 GET approved-inputs
POST agent-runs
POST artifacts
POST agent-runs/[runId]/finish succeeded
等待用户 POST approve
```

失败时：

```text
POST agent-runs
POST agent-runs/[runId]/finish failed
```

失败不会删除旧 artifact；前端可继续展示旧 approved artifact 和 failed node。

## 7. 前端接入边界

- 前端刷新项目时优先调用 `GET snapshot`。
- 用户点击确认时调用 `POST approve`。
- 用户点击重做时调用 `POST regenerate`，建议传 `expectedLatestVersion`。
- 用户查看下游输入时调用 `GET approved-inputs`。
- 用户界面不应直接展示 API 字段名；`nodeKey`、`status`、`staleReason` 等需要映射为教师可读文案。

## 8. 已验证命令

Stage 7 closeout 使用以下命令验证：

```powershell
npm run test:stage1
npm run test:stage2
npm run test:stage3
npm run test:stage4
npm run test:stage5
npm run test:stage6
npm run test:stage7
npm run build
git diff --check
```
