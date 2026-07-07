# Frontend API-backed Workbench Stage 3 Test Plan

日期：2026-07-07

## 1. 测试目标

验证 Stage 3 的产物动作边界：

- mapper 拆分后 Stage 2 raw contract 兼容性不退化。
- approve 使用 artifact id，而不是 UI node key。
- approve 后重新读取 snapshot。
- regenerate 不伪装成真实后端版本闭环。

## 2. 红绿测试清单

### T1：mapper 拆分不改变 raw snapshot 输出

沿用 Stage 2 raw snapshot fixture。

期望：

- `normalizeSnapshot` 仍输出 2 个 ArtifactItem。
- `requirement_spec` artifact key 仍为 `artifact-requirement-v1`。
- node placeholder 仍可打开详情但不可复制/确认。

### T2：approve 使用 artifact id 并刷新 snapshot

步骤：

1. 调用 `client.approveArtifact("project-a", "artifact-requirement-v1")`。
2. fake fetch 记录 URL。
3. approve response 返回 `{ artifact }`。
4. client 再 GET snapshot。

期望：

- 第一次请求 URL 为 `/api/workbench/projects/project-a/artifacts/artifact-requirement-v1/approve`。
- 第二次请求 URL 为 `/api/workbench/projects/project-a/snapshot`。
- 返回值为 normalized snapshot。

### T3：sendMessage 仍使用后端消息合同

期望：

- POST body 为 `{ role: "teacher", content, artifactRefs }`。
- POST 后读取 snapshot。

### T4：development adapter 继续保留本地动作

期望：

- approve/regenerate 仍能更新 development snapshot。
- 文档和测试名称明确 development，不把它当真实后端完成。

## 3. 集中验收命令

```powershell
npm test
npx tsc --noEmit
npm run build
rg -n "schema|manifest|provider|node_id|storage|API|debug|local path" src
```

`npm run lint` 继续记录为 Next 16 脚本债务。

