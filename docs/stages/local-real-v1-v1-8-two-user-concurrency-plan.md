# ShanHaiEdu V1-8 两用户并发与恢复计划

更新时间：2026-07-13

状态：`done for single-process V1 topology`

## 1. 目标

证明两名受邀教师能够同时在不同项目中使用 Main Agent，而项目、对话、生成强度、租约、ConversationTurnJob、GenerationJob、Provider taskId、VideoShot、预算事件和 Artifact 完全隔离；同一项目仍只能有一个有效写者，恢复不能重复提交或重复计费。

## 2. 当前事实与差距

- 项目 owner/membership 服务端授权、账号停用与会话撤销已经实现。
- ProjectExecutionLease 已证明同项目互斥、不同项目可并行和旧 fencing token 失效。
- GenerationJob 已证明幂等键收敛、Provider taskId 恢复和 submission_unknown 停止重提。
- ConversationTurnJob 已按项目 FIFO，冻结 actor、fence 与生成强度。
- VideoShot 已按 `(projectId, sourceArtifactId, shotId)` 隔离。
- 当前缺少一条在同一隔离 SQLite 中使用两个 actor、单应用 Prisma singleton 和两个项目，贯通上述状态的综合测试。多 Prisma client 持租约并行写作为部署拓扑扩展单独审计。

## 3. 并发矩阵

| 场景 | 预期 |
|---|---|
| 用户甲/项目甲 + 用户乙/项目乙同时获取租约 | 同时成功，各自 fencingToken 从 1 开始 |
| 用户乙尝试读取或写项目甲 | 服务端拒绝，不返回项目存在性细节 |
| 两项目同时更新不同生成强度 | 各自版本独立，不串档 |
| 两项目同时创建/启动 GenerationJob | job、inputHash、taskId 和结果归属独立 |
| 同项目第二 worker 获取租约 | 失败，不影响另一项目 |
| 已保存 taskId 的任务恢复 | 只 poll，不重新 submit |
| 两项目各自保存 VideoShot/Artifact | 查询结果只包含本项目数据 |
| 两项目预算事件 | 只附着各自消息/任务，不产生跨项目聚合写入 |

## 4. 实施原则

- 优先新增综合测试；只有测试发现真实缺口时才修改生产代码。
- 不用全局 mutex 或全局队列换取表面稳定。
- 不把两个用户扩成组织多租户、SSO 或复杂 RBAC。
- 不调用真实 Provider；Provider submit/poll 使用可计数夹具。

## 5. 退出标准

- 双 actor、双项目、单应用 Prisma singleton 综合测试在隔离 SQLite 中通过。
- 不同项目并行，同项目互斥。
- 强度、任务、taskId、VideoShot、消息、预算事件和 Artifact 不串线。
- 恢复调用 submit 次数为 0，poll 次数为 1。
- 用户乙访问项目甲稳定拒绝。
- 专项、全量、构建、SQLite 和 diff 门禁通过。
