# Local Real MVP M2 Lesson Text Loop Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M2 的核心需求是让教师在 M1 已确认的需求规格基础上，继续得到可保存、可查看、可复制、可确认、可重做的教材说明和教案文本。M2 不是引入真实教材 OCR、真实 PPTX 或复杂队列，而是证明本地 MVP 可以沿着已确认上游连续生产下一批公开课材料。

M2 最小闭环为：

```text
确认需求规格说明书
-> 生成教材证据包/教材说明
-> 确认教材证据包
-> 生成公开课教案 Markdown
-> 查看完整教案
-> 确认、复制、重做教案
-> 上游需求规格重做并确认后，已确认教案标记为需重审
```

## 2. 可复用方案调研

当前主线已有可复用能力：

- `DeterministicRuntime` 已支持 `textbook_evidence` 和 `lesson_plan` 模板。
- `DEFAULT_WORKFLOW_NODES` 已定义 `requirement_spec -> textbook_evidence -> lesson_plan` 依赖。
- `WorkflowRepository` 已支持 artifact 版本、确认指针、重做版本和直接下游 stale 传播。
- `approve` route 已是用户确认的服务端边界，适合作为推进下一节点的最小编排点。
- `ArtifactRail`、`ArtifactSidePanel`、`ArtifactDetailSheet` 已支持查看、复制、作为输入和确认。
- 后端 `regenerate` route 已存在，但前端 `WorkbenchApiClient.regenerateArtifact()` 仍是 501 占位，需要接入。

不引入新库：

- 不新增队列。
- 不绕过后端持久化。
- 不把 OpenAI SDK 放进前端。
- 不把 deterministic 文案伪装成真实模型生成。

## 3. 复用、适配和必要自研

复用：

- 复用 deterministic runtime 生成教材证据包和公开课教案。
- 复用 artifact save/approve/regenerate 版本机制。
- 复用 mapper 让前端显示 latest artifact 和 node 状态。
- 复用 Stage 2 E2E 作为浏览器路径基础。

适配：

- `approve` route 在确认 `requirement_spec` 后，若尚无教材证据待确认/已确认版本，则生成 `textbook_evidence`。
- `approve` route 在确认 `textbook_evidence` 后，若尚无教案待确认/已确认版本，则生成 `lesson_plan`。
- `WorkbenchApiClient.regenerateArtifact()` 改为调用后端 regenerate route，并刷新 snapshot。
- E2E 从 M1 扩展为 M2：需求确认、教材确认、教案查看、教案确认、教案重做、复制入口可用、刷新恢复。

必要自研：

- 增加一个小型 deterministic orchestration helper，避免在 route 里堆长逻辑。
- 增加 M2 route contract 测试，确保确认上游会生成下一节点。
- 增加 API client regenerate 合同测试。
- 增加 M2 浏览器 E2E。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M2 阶段规划和测试定义。
2. 写失败测试：确认需求规格后生成教材证据；确认教材证据后生成教案；前端 regenerate 调用真实 route。
3. 实现最小 orchestration helper 和 API client regenerate。
4. 扩展 Playwright M2 真实浏览器闭环。
5. 集中验收：`npm test`、`npm run build`、M2 E2E、worker 残留检查。
6. 写 M2 report，审查提交范围、敏感信息和工程词。
7. 提交 M2。

主要风险：

- 自动生成下游如果不做幂等保护，重复确认会产生多份重复草稿。
- lesson_plan 必须基于已确认需求和已确认教材说明，不能只拿未确认草稿作为输入。
- regenerate route 当前需要 summary/markdownContent，前端重做要提供可理解的新版本内容，不能发空白版本。
- M2 仍是 deterministic 文本闭环，不代表真实教材解析或真实模型生成已完成。

验证标准：

- 后端确认需求规格后保存 `textbook_evidence` v1，状态为 `needs_review`。
- 后端确认教材证据后保存 `lesson_plan` v1，状态为 `needs_review`。
- 前端可打开完整教案 Markdown。
- 教案可确认、复制、重做；重做后保存 v2 且不覆盖旧版本。
- 需求规格重做并确认后，已确认教案节点标记为 `stale`。
- 用户可见界面不出现工程词。
