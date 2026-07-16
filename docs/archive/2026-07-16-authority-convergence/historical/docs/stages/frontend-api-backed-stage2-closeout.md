# Frontend API-backed Workbench Stage 2 Closeout

日期：2026-07-07

## 1. 阶段结论

Stage 2 已完成，可提交并推送本阶段变更。

本阶段完成的是 Backend Workflow Lite raw contract 到前端 view model 的适配层。它不声明真实后端 route 已合并到当前前端分支，也不声明真实 runtime 已生成 assistant 回复。默认 development adapter 仍仅用于本主线本地可运行；`NEXT_PUBLIC_WORKBENCH_DATA_SOURCE=api` 时，API client 已能处理后端 Stage 1 raw shape。

## 2. 完成内容

- `src\lib\workbench-api.ts`
  - 增加 Backend Workflow Lite raw types。
  - 增加项目列表 `{ projects }` 响应归一化。
  - 增加 raw `ProjectSnapshot` 到 `WorkbenchSnapshot` 的映射。
  - 支持 workflow node 没有 artifact 时仍生成右侧节点项。
  - `sendMessage` 改为后端合同：`role/content/artifactRefs`，POST 后重新读取 snapshot。
  - `createProject` 兼容后端 `{ project }` 响应，随后读取 snapshot。
- `src\lib\types.ts`
  - 增加 `requirement_spec` 节点类型。
  - 为 `ArtifactItem` 增加 `artifactId`、`nodeKey`、`version` 可选字段，用于后续动作接真实 artifact id。
- `tests\workbench-api.test.mjs`
  - 增加 raw project list 归一化测试。
  - 增加 raw snapshot 归一化测试。
  - 增加后端 createProject shape 测试。
  - 保留 Stage 1 development adapter 和错误归一化测试。

## 3. 验证证据

自动化：

- `npm test`：通过，5 个测试全部通过。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过，Next.js 16.2.10 production build exit 0。
- `git diff --check`：通过。
- `rg -n "schema|manifest|provider|node_id|storage|API|debug|local path" src`：无命中。

浏览器：

- 桌面本地回归 `127.0.0.1:3028`：
  - 项目、对话、产物节点可见。
  - 发送消息后用户消息和 development adapter 回复可见。
  - 无横向溢出。
  - 无工程词暴露。
- 窄屏 `390x844`：
  - 项目入口和产物入口可见。
  - 无横向溢出。
  - 无工程词暴露。

已知测试脚本债务：

- `npm run lint` 仍未通过，原因同 Stage 1：现有 `next lint` 脚本在 Next 16 下被解释为目录 `lint`。

## 4. 自审结论

- 未改 UI 视觉结构，符合“不重写 UI”边界。
- 后端 raw 字段只在 `workbench-api.ts` 内部使用，未直接泄露给组件。
- `artifactId/nodeKey/version` 仅为内部 action 标识，不在用户界面展示。
- `workbench-api.ts` 当前约 437 行，接近 500 行警戒线。Stage 3 如果继续增加 approve/regenerate/stale 映射，应优先拆成 `workbench-mappers.ts` 或同等边界文件。

## 5. 风险与后续处理

- Backend Workflow Lite Stage 2 尚未合并到本前端分支，真实 approve endpoint 仍可能变化。
- 当前 API client 的 approve/regenerate endpoint 仍沿用 Stage 1 路径假设，Stage 3 必须改为 artifact id 优先，并兼容后端确认接口实际返回 shape。
- 后端当前 `POST /messages` 只保存消息，不生成 assistant 回复；前端已按真实 snapshot 显示，不补假回复。

## 6. 下一阶段入口

Stage 3 进入产物动作接入：

- 拆分 `workbench-api.ts` 映射层，避免超过 500 行继续堆叠。
- `approveArtifact` 使用 `artifactId` 调用真实后端确认接口。
- 对后端 `{ artifact }` 或 raw snapshot 返回做兼容，动作后统一刷新 snapshot。
- `regenerate` 在后端合同未完成时保持明确开发态，不伪装为真实版本闭环。

