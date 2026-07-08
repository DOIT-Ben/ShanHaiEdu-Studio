# Local Real MVP M45 对话意图门禁与顶部真实项目信息验收报告

日期：2026-07-08

## 1. 阶段目标

修复 `你好` 被误当成备课需求生成 `需求规格说明书` 的问题，并移除顶部与对话区残留的原型硬编码信息。

## 2. 真实边界说明

- 当前页面已经走真实本地 API 与 SQLite 持久化。
- 当前对话生成仍是 deterministic 本地工作流，不是自由大模型对话。
- M45 不接入真实 LLM；只增加意图门禁，避免把问候语冒充成备课需求。

## 3. 实现结果

- `messages` route 在调用 deterministic runtime 前增加备课需求门禁。
- `你好` 等信息不足输入只保存消息并返回澄清回复，不生成 artifact。
- 明确包含年级、课题、教材、公开课、教案、PPT、导入视频等信号的输入继续生成需求规格。
- 顶部标题、保存时间和阶段从当前项目派生，不再硬编码旧课题与固定时间。
- 对话消息时间从后端 `createdAt` 映射，不再硬编码 `10:24`。

## 4. 验收记录

已执行：

```powershell
npm test
npm run build
```

结果：

- `npm test`：通过，Node 98/98，Vitest 24 files / 93 tests。
- `npm run build`：通过，Next.js 生产构建、TypeScript 与页面生成均成功。

浏览器复验：

- 地址：`http://127.0.0.1:3002/`
- 新建项目后发送 `你好`。
- 后端 `/messages` 返回 201。
- 页面显示澄清回复：要求补充年级、课题、教材版本和期望材料。
- 未生成 `需求规格说明书已生成`。
- 返回 payload 未包含 artifact。
- 页面未出现 `表内乘法（一）` 和 `已保存 10:24`。

截图证据：

- `test-results\m45-local-greeting-clarification.png`
