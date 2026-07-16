# V1 Stage 1C：生成结果原子提升与隔离计划

更新时间：2026-07-12
状态：implemented；验收见 `local-real-v1-stage1c-atomic-promotion-closeout.md`

## 1. 目标

关闭 Provider 文件已生成后，`Artifact`、`WorkflowNode` 与 `GenerationJob` 分两次提交造成的半成功窗口，确保 PPTX、图片、视频和对话内 Provider 工具统一遵守：

```text
Provider 长调用（事务外）
-> 持久化 staging 结果
-> 校验项目、输入代际、执行身份与 fence
-> 单个短事务原子提升 Artifact / WorkflowNode / GenerationJob
-> staging committed
```

Stage 1C 不改变 Agent 的 ReAct 决策方式，也不把 Main Agent 固化成线性 DAG；本阶段只收紧真实生成结果的提交边界。

## 2. 当前缺口

当前四条生成路径均执行：

```text
service.saveArtifact()
-> service.finishGenerationJob()
```

两次调用是两个独立事务，因此存在：

1. 文件已写入本地存储，但数据库尚无可对账记录。
2. Artifact 已创建并对教师可见，GenerationJob 却仍为 running/failed。
3. 旧 intent epoch 的结果先创建 Artifact，再把 Job 标记 quarantined。
4. 直接 PPTX、图片、视频入口没有把长调用与最终提交放在同一个项目租约生命周期内。

## 3. 数据模型

新增 `StagedArtifactCommit`，每个 `GenerationJob` 最多一个：

| 字段 | 用途 |
|---|---|
| `generationJobId` | 唯一幂等键，确保一个 Job 只提升一次 |
| `projectId` | 项目隔离与对账 |
| `state` | `awaiting_result / staged / committed / quarantined / orphaned` |
| `nodeKey/kind/title/status/summary/markdownContent` | 待提升 Artifact 草稿 |
| `structuredContentJson` | 文件 storage ref、Provider 证据与业务结构 |
| `storageRefsJson` | 从结构化内容提取的 `localOutput` 清单，供孤儿文件对账 |
| `intentEpoch/inputHash` | 绑定创建 Job 时的不可变输入代际 |
| `holderId/fencingToken` | 绑定产生结果的执行租约；无后台 guard 的兼容路径允许为空 |
| `actorUserId/actorAuthMode/authSessionId` | 绑定产生结果的执行身份；仅完全相同且仍有效的身份可在新 fence 下恢复 |
| `resultArtifactId` | committed 后指向唯一 Artifact |
| `quarantineReason` | stale intent、fence rejected 等隔离原因 |

创建 GenerationJob 时，在同一事务内创建 `awaiting_result` 槽位。这样即使 Provider 已写文件而后续数据库更新失败，系统仍有持久化 Job/slot 可定位并对账，且不会创建公开 Artifact。

## 4. 统一提交合同

### 4.1 stage

`stageGenerationResult(projectId, jobId, draft, guard?)` 必须：

1. 验证 Job 属于项目且处于 `running`。
2. 验证 `inputHash`、`intentEpoch` 与预建 slot 一致。
3. 有 guard 时，在同一事务内验证身份、holder 与 fencing token，并保存执行身份快照。
4. 将 Artifact 草稿和 storage refs 写入 slot，状态改为 `staged`。
5. 重复提交相同 Job 时覆盖同一 slot，不新增记录。

### 4.2 promote

`promoteStagedGenerationResult(projectId, jobId, guard?)` 必须在单个数据库事务内：

1. 读取 Job、slot、Project。
2. 若已经 committed/succeeded，返回原 Artifact 和 Job。
3. 校验 `Project.intentEpoch === Job.intentEpoch === slot.intentEpoch`。
4. 有 guard 时校验当前 lease、身份及 slot fence；若是新 fence，只有 actor/auth/session 快照完全相同且仍有效时才允许接管。
5. 计算该 node 的下一版本并创建一个 Artifact。
6. 更新 WorkflowNode 状态。
7. 更新 GenerationJob 为 `succeeded/completed/resultArtifactId`。
8. 更新 slot 为 `committed/resultArtifactId/committedAt`。

上述 5-8 任一步失败必须整体回滚。重试只能得到同一个 Artifact，不得产生双版本。

### 4.3 quarantine

intent epoch 已变化、当前 fence 已被接管或执行身份失效时：

- 不创建 Artifact；
- Job 改为 `quarantined`；
- slot 改为 `quarantined` 并记录原因；
- storage refs 保留用于人工对账或后续清理。

## 5. 项目租约

对话队列继续复用现有 ProjectExecutionLease 和心跳。三个直接生成路由新增统一租约执行器：

```text
acquire lease
-> create guarded service
-> start/recover Job
-> Provider 调用
-> stage + atomic promote
-> release lease
```

Provider 调用期间只做租约心跳，不持有数据库事务。获取不到租约时返回可重试冲突，不并发写入同一项目。

## 6. 文件层边界

- 本阶段不移动已经由 Provider 校验后写入的文件，也不把文件 I/O 放进数据库事务。
- `localOutput` 从 structured content 提取到 `storageRefsJson`，数据库提升失败后文件保持不可见的 staging/orphan 状态。
- 只有 committed Artifact 能通过现有下载与最终包入口被教师访问。
- 后续存储治理阶段可依据 `state + storageRefsJson` 清理 quarantined/orphaned 文件；本阶段禁止自动删除，避免误删真实资产。

## 7. 修改范围

```text
prisma\schema.prisma
scripts\init-sqlite-schema.mjs
src\server\workbench\types.ts
src\server\workbench\repository.ts
src\server\workbench\service.ts
src\server\execution\project-execution-runner.ts
src\server\conversation\conversation-turn-service.ts
src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\coze-ppt\route.ts
src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\image\route.ts
src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\video\route.ts
tests\generation-result-promotion.test.ts
```

不修改 Provider 生成算法，不改 PPT/视频业务节点质量标准，不提交、不推送、不部署。

## 8. 回退

回退应用代码时保留新增表，旧代码会忽略它；不删除 staging 记录和文件。若必须回退数据库结构，应先导出 `StagedArtifactCommit` 对账清单，再在单独获批的数据库迁移中处理。

## 9. 完成标准

- Stage 1C 测试计划全部通过。
- PPTX、图片、视频与对话 Provider 路径不再出现 `saveArtifact -> finishGenerationJob` 双事务。
- stale intent/旧 fence 结果不会进入 Artifact 表。
- `npm test`、`npm run build`、`git diff --check` 均通过。
- 新增 closeout，主线状态再切换到 Stage 2。
