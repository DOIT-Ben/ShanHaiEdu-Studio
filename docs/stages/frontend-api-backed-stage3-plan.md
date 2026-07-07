# Frontend API-backed Workbench Stage 3 Plan

日期：2026-07-07

## 1. 当前目标

Stage 3 的目标是把产物动作从“按节点 key 的前端假动作”推进到“artifact id 优先的真实 API action 边界”，同时先拆分 Stage 2 已接近 500 行的 `workbench-api.ts`，避免继续堆叠。

本阶段仍保留现有 Codex 风格 UI，不重写视觉，不新增复杂面板。

成功标准：

- `workbench-api.ts` 拆出后低于 260 行。
- 后端 raw -> 前端 view model 映射迁移到独立文件。
- `approveArtifact(projectId, artifactKey)` 对真实 artifact 使用 `artifactId` 调用后端 Stage 2 计划中的 approve endpoint。
- approve 返回 `{ artifact }` 或 raw snapshot 时都能兼容，最终统一刷新 snapshot。
- 没有真实 artifact id 的开发态/节点占位不伪装为真实确认。
- `regenerateArtifact` 在真实后端合同未完成时保持可理解失败/开发态边界，不伪装真实版本闭环。

## 2. 第一性原理

用户动作必须落到真实产物，而不是落到前端节点标签。右侧节点串中的 `key` 可以是 UI key，也可以是后端 artifact id；如果确认仍使用 `intro-video-plan` 这种 UI key，后端无法知道确认的是哪个 artifact 版本。

因此 Stage 3 需要建立动作 ID 规则：

```text
有 artifactId -> 使用 artifactId 调后端动作
无 artifactId -> 这是开发态或未生成节点，不声明真实动作成功
动作后 -> 重新读取 snapshot，保证 UI 以真源为准
```

## 3. 调研与可复用方案

已核验 Backend Workflow Lite Stage 2 计划：

- 计划新增 `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/approve`。
- 计划新增 approved-inputs。
- regenerate/version guard 不属于后端 Stage 2 完成范围。

复用：

- Stage 2 的 raw contract normalizer。
- `ArtifactItem.artifactId/nodeKey/version` 可选字段。
- controller 现有 `confirmArtifact` / `regenerateArtifact` 调用面。

必要自研：

- 新增 `src\lib\workbench-mappers.ts` 承载 raw types 和映射函数。
- `createWorkbenchApiClient` 的 approve 逻辑使用 `item.artifactId ?? item.key`，但 UI controller 调用时仍传 `ArtifactItem` 更稳。

## 4. 开发方案

### 4.1 文件变更

- 新增 `src\lib\workbench-mappers.ts`
  - raw Backend types。
  - `normalizeProjects`。
  - `normalizeSnapshot`。
  - `normalizeActionResult`。
- 修改 `src\lib\workbench-api.ts`
  - 删除映射实现，只保留 client、development adapter 和错误处理。
  - `approveArtifact` 动作后统一调用 snapshot 刷新。
  - `regenerateArtifact` 对 API data source 返回教师可理解错误，直到后端合同明确。
- 修改 `src\hooks\useWorkbenchController.ts`
  - 传入 `item.artifactId ?? item.key` 给 data source。
  - 对无 artifactId 且非 development adapter 的失败显示可理解提示。
- 修改 `tests\workbench-api.test.mjs`
  - 验证 approve 使用 artifact id endpoint。
  - 验证 approve 后刷新 snapshot。
  - 验证 raw mapper 从新文件导出仍兼容 Stage 2。

## 5. 不做范围

- 不实现后端 approve route。
- 不实现 regenerate 真实版本。
- 不新增 OpenAI、provider 或 runtime 调用。
- 不修改 UI 布局和视觉风格。

## 6. 风险与回退

风险：

- 后端 Stage 2 未推送，真实 approve route 暂不可用：前端只完成合同边界和测试，不宣称真实确认闭环已上线。
- 拆分文件可能影响 Node 内置测试的 require stub：测试中补 `@/lib/workbench-mappers` 加载。
- `ArtifactItem.key` 兼具 UI key 和 artifact id：Stage 3 后真实后端 artifact item 的 `key` 等于 artifact id，node placeholder 的 `key` 等于 node id，动作使用 `artifactId` 优先。

回退：

- 若拆分引入问题，可回退 `workbench-mappers.ts` 并保留 Stage 2 单文件实现；但 Stage 4 前必须重新拆分，避免越过行数债务。

## 7. 验证标准

- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- `rg -n "schema|manifest|provider|node_id|storage|API|debug|local path" src`
- 桌面/窄屏最小浏览器回归。
- 自审确认 `workbench-api.ts` 低于 260 行，`workbench-mappers.ts` 低于 260 行。

