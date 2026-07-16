# M60 工程审查：异步队列、渐进展示与视频工作流

## 1. 审查结论

Stage：`products-plan-eng-review`

Recommendation：`go with constraints`

Gate：`continue`

M60 规划整体可执行：当前代码确实存在同步消息 API、前端长时间输入锁、缺少对话 turn 队列、视频工作流节点过粗等问题。新增项目级 `ConversationTurnJob`、将 `POST /messages` 改为入队返回、用 snapshot 暴露持久化队列状态、把视频拆为配置化节点契约，是符合当前架构边界的方向。

但实施时必须增加三个约束：

1. 第一阶段只改“消息入队 + 队列状态 + 前端可输入”，不要同时落完整视频 provider 并发生成。
2. `ConversationTurnJob` 不应复用 `GenerationJob`，两者职责不同；前者承载用户对话 turn，后者承载 PPTX / 图片 / 视频等素材生成任务。
3. 视频工作流先落 contract、planner、artifact 前置门禁和 provider profile；真实多段视频并发与拼接放到队列稳定后再接。

## 2. 已核验证据

审查读取了以下现有实现：

- `prisma\schema.prisma`：已有 `ConversationMessage`、`WorkflowNode`、`Artifact`、`AgentRun`、`GenerationJob`，但没有对话 turn 队列表。
- `src\app\api\workbench\projects\[projectId]\messages\route.ts`：`POST` 当前同步调用 `turnService.createTurn(...)`，完成后返回 201。
- `src\server\workbench\types.ts`：`ProjectSnapshot` 当前包含 messages、nodes、artifacts、agentRuns、generationJobs；没有 turnJobs。
- `src\server\workbench\service.ts`：snapshot 已有统一聚合点，适合加入 turnJobs。
- `src\server\workbench\repository.ts`：`GenerationJob` 已有 queued / running / succeeded / failed 状态与 start / finish / fail 方法，但没有项目级“同一项目只能一个 running”的全局互斥。

## 3. 架构边界审查

### 3.1 对话队列边界

通过：新增 `ConversationTurnJob` 应属于 workbench 后端业务层，而不是前端本地状态或 provider adapter。

理由：

- 队列状态需要刷新后恢复，必须持久化。
- 跨标签页和重复点击只能由后端约束。
- 前端禁用按钮只能做体验优化，不能作为并发门禁。

禁止做法：

- 用 React state 维护队列真相。
- 用 `sending` 继续锁住输入代替后端队列。
- 把对话 turn 塞进 `GenerationJob`，导致用户消息队列和素材生成任务混在一起。

### 3.2 ConversationTurnJob 与 GenerationJob 分工

通过，但必须明确分工：

```text
ConversationTurnJob：处理一条用户消息触发的整轮思考、规划、节点推进和 artifact 创建。
GenerationJob：处理某个已确认 artifact 派生出的真实文件生成任务，例如 PPTX、图片、视频片段。
```

二者可以关联，但不能互相替代。

建议后续字段预留：

```text
ConversationTurnJob.currentAgentRunId
ConversationTurnJob.currentNodeKey
GenerationJob.parentTurnJobId
GenerationJob.segmentKey
```

M60-A 可不一次性加全，但 schema 设计不要堵死关联。

### 3.3 视频工作流边界

通过：视频创意链路应放在 capability planner / registry / runtime guidance / artifact contract 中，而不是直接写死在某个 OpenAI prompt 或 Evolink adapter。

正确边界：

- `capability-registry`：定义节点、依赖、artifact kind。
- `capability-planner`：决定完整交付顺序。
- `agent-runtime` guidance：定义每个节点产物结构。
- `video-generation` provider adapter：只负责按已确认的 segment plan 调 provider、下载和校验文件。

## 4. 数据流与状态流转审查

### 4.1 推荐消息数据流

```text
前端提交消息
  -> POST /messages
  -> 后端保存 teacher ConversationMessage
  -> 创建 ConversationTurnJob(status=queued)
  -> 返回 202 + message + turnJob
  -> drainProjectConversationQueue(projectId)
  -> job queued -> running
  -> 调用原 conversation-turn-service 执行业务
  -> 写入 assistant message / workflow nodes / artifacts / generation jobs
  -> job running -> succeeded 或 failed / blocked
  -> snapshot 返回最新状态
```

审查结论：可行。

### 4.2 状态兼容建议

现有状态：

- `GenerationJobStatus = queued | running | succeeded | failed`
- `WorkflowNodeStatus = not_started | in_progress | needs_review | approved | blocked | stale | failed`

建议 `ConversationTurnJobStatus` 使用：

```text
queued | running | succeeded | failed | canceled | blocked
```

映射到教师界面时必须转换为中文教学语言，不暴露内部枚举。

### 4.3 SQLite 并发风险

当前 datasource 是 sqlite。SQLite 对高并发写入敏感，因此 M60 不适合上复杂多 worker 并发。

约束：

- 同项目严格单 running。
- 全局 drain 初期使用保守并发。
- repository 的“获取 running 锁”必须在事务内完成。
- 若 Prisma + SQLite 无法可靠做复杂锁，MVP 采用 `updateMany where status=queued` 或事务内二次检查实现保守互斥。

## 5. 依赖审查

推荐不新增队列依赖。

理由：

- 当前是本地 MVP，sqlite + Next 服务端足够先做轻量队列。
- 引入 Redis / BullMQ 会增加部署和运维复杂度。
- 当前核心问题是状态持久化和 API 行为，不是高吞吐队列。

允许复用：

- 现有 Prisma repository。
- 现有 `GenerationJob` 的状态流转设计作为参考。
- 现有 `ProjectSnapshot` 作为前端恢复状态入口。

## 6. 错误处理与恢复审查

### 6.1 必须处理的失败

- 用户消息为空或过长。
- 重复 idempotency key。
- 同项目已有 running job。
- job running 中服务进程重启。
- provider 失败。
- artifact 质量门禁失败。
- PPT slideCount 不匹配。
- 视频前置节点缺失。

### 6.2 推荐错误策略

- 参数错误：API 返回 400，不创建 job。
- 入队成功但执行失败：job 标 `failed`，保存教师可理解错误。
- 质量门禁失败：job 或节点标 `blocked`，说明未达标原因和下一步建议。
- provider 瞬时失败：可重试，记录 attempts。
- running 超时：标记可恢复或 failed，不允许永久占锁。

### 6.3 错误文案红线

教师界面不得出现：

```text
provider
node_id
capabilityId
runtimeKind
storage
local path
debug
token
```

内部日志和测试可以保留工程字段，但不要进入教师可见 response。

## 7. 测试性审查

M60 测试计划可执行，但建议实施时先补最小红灯测试：

1. `POST /messages` 不应等待完整生成，而应返回 queued / running turn job。
2. 同项目连续 3 条消息最多一个 running。
3. 刷新 snapshot 后仍能看到 queued turnJobs。
4. 生成中前端 textarea 不因 projectBusy 被禁用。
5. 视频 provider 调用前必须存在 storyboard 和 asset pack。
6. PPT 设计稿含范围合并页时 blocked，不调用 Coze。

浏览器验收仍然必要，因为前端体验是本阶段核心目标。

## 8. 发布与回退风险

### 8.1 最高影响风险

最高风险：把消息 API 改为 202 入队后，前端或旧测试仍假设 201 返回完整 assistant response，导致界面暂时看不到结果。

缓解：

- 前后端同一切片改造。
- snapshot 中同时返回 messages + turnJobs。
- 前端收到 202 后立即刷新或启动轮询。
- 保留原 `conversation-turn-service.createTurn`，只改变调用方式，不重写核心生成逻辑。

### 8.2 回退策略

- 若队列 drain 有问题，暂停自动 drain，只保留 queued job 和用户消息，不丢数据。
- 若前端渐进展示有问题，仍可用 snapshot 展示最终 artifacts，但不能回退到丢消息。
- 若视频新 contract 影响完整交付，可先将视频节点停在待确认/blocked，不调用真实 provider。

## 9. 最小修正要求

规划已足够进入实现，但实施前需将以下约束写入开发任务：

1. `ConversationTurnJob` 独立于 `GenerationJob`。
2. `POST /messages` 返回结构必须有后端持久化 job id。
3. snapshot 必须包含 turnJobs，刷新可恢复队列状态。
4. 第一实现切片不得同时做完整视频并发生成；先做队列和 contract。
5. 所有教师可见状态必须经过 mapper 脱工程词。

## 10. 下一步

Next：进入 `products-test-driven-development`。

建议第一实现切片：

```text
M60-A/B/C：ConversationTurnJob schema + repository + POST /messages 入队 + snapshot turnJobs
```

暂不进入真实视频 segment 并发生成，避免队列底座未稳时放大复杂度。
