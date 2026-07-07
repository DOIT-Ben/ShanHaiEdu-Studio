# Frontend API-backed Workbench Stage 2 Test Plan

日期：2026-07-07

## 1. 测试目标

验证前端 API client 能把 Backend Workflow Lite 原始响应转换为现有 UI 可消费的工作台 snapshot，并且不再要求后端返回前端 mock shape。

## 2. 红绿测试清单

### T1：项目列表兼容 `{ projects }`

输入：

```json
{
  "projects": [
    {
      "id": "project-a",
      "title": "五年级百分数公开课",
      "status": "active",
      "currentNodeKey": "requirement_spec",
      "grade": "五年级",
      "subject": "数学",
      "textbookVersion": null,
      "lessonTopic": "百分数",
      "createdAt": "2026-07-07T00:00:00.000Z",
      "updatedAt": "2026-07-07T00:01:00.000Z"
    }
  ]
}
```

期望：

- `listProjects()` 返回 `ProjectItem[]`。
- `meta` 为教师可理解信息，不暴露 raw 字段名。
- `currentStep` 映射为中文节点标题。

### T2：raw snapshot 映射为前端 snapshot

输入：

- `project.currentNodeKey=requirement_spec`
- 8 个 `nodes`
- 1 条 teacher message
- 1 个 `requirement_spec` artifact

期望：

- `messages[0].speaker === "teacher"`。
- `artifacts` 至少包含全部 nodes。
- `requirement_spec` 节点有 artifact 内容，可复制、可作为输入、可确认。
- 没有 artifact 的节点显示“还没有生成内容”，不可复制、不可作为输入、不可确认。
- `activeArtifactKey` 优先匹配当前项目节点。

### T3：sendMessage 使用后端消息合同并重新读取 snapshot

步骤：

1. fake fetch 接收 `POST /messages`。
2. 断言 body 为 `{ role: "teacher", content, artifactRefs }`。
3. POST 成功后 fake fetch 返回一次 snapshot。

期望：

- `sendMessage()` 返回 normalized snapshot。
- 不伪造 assistant message。

### T4：createProject 兼容 `{ project }` 并读取 snapshot

步骤：

1. fake fetch 接收 `POST /projects`。
2. 返回 `{ project }`。
3. client 自动 `GET /projects/:id/snapshot`。

期望：

- `createProject()` 返回 normalized snapshot。

## 3. 集中验收命令

```powershell
npm test
npx tsc --noEmit
npm run build
rg -n "schema|manifest|provider|node_id|storage|API|debug|local path" src
```

`npm run lint` 仍按 Stage 1 记录为现有 Next 16 脚本债务，不作为通过项伪装。

