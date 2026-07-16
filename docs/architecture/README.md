# ShanHaiEdu 当前架构入口

更新时间：2026-07-16

本目录只保留当前架构不变量、V1.0重构设计和已接受ADR。历史架构包、早期五平面/十二系统材料和已被覆盖的ADR已归档。

## 当前设计基线

- `V1.0 重构设计.md`：把产品收敛为Main Agent唯一编排、工作流能力原子Tool化、服务端守门和assistant-ui实时投影的目标架构。
- 该设计覆盖旧宏节点、外层计划器、forced-next-tool、approve自动推进和固定阶段UI的生产控制权；历史文档不得恢复这些路径。

## 架构不变量

- Project、TaskBrief、IntentGrant、IntentEpoch和Artifact版本是跨轮状态真源。
- 产品Main Agent是业务Tool选择、下一步、Observation、Replan、重试和停止的唯一编排者。
- 原生function-call + Observation + ReAct是唯一生产业务控制循环；工作流、宏节点、Capability计划和阶段模板只能作为参考策略、迁移证据或展示投影。
- 高层业务能力必须拆为可独立发现、执行、校验和恢复的原子Tool；Tool不得自行选择下一业务Tool。
- `ToolExecutionGateway`强制ExecutionEnvelope、ActionPolicy、幂等和实际参数对账。
- ToolInvocation、ValidationReport、Observation、Artifact、GenerationJob和事件按同一结果原子提交。
- checkpoint与SemanticSnapshot保存跨轮目标、约束、排除项、计划revision、可信Artifact和Observation引用。
- assistant-ui只消费项目自有MessagePart和AgentEventEnvelope，不成为业务真源。
- Provider和Skill通过Adapter与Binding Policy接入，不进入React组件，不取得编排权。
- mock、deterministic、placeholder和degraded产物不能提升为生产Artifact。

## 当前已接受ADR

1. `decisions\2026-07-14-adr-assistant-ui前移并统一控制面消息边界.md`
2. `decisions\2026-07-14-adr-main-agent-react-checkpoint-compaction.md`
3. `decisions\2026-07-14-adr-r5-ppt-design-candidate-boundary.md`
4. `decisions\2026-07-16-adr-main-agent唯一编排与工作流原子Tool化.md`

入口：`decisions\README.md`。

## 当前合同

- Provider台账绑定：`..\contracts\provider-ledger-runtime-contract.md`
- 产品不变量：`..\product\current-requirements-baseline.md`
- 当前Runner完整性阻塞：`..\mainlines\current-mainline-status.md`

## 未来候选

Codex SDK、互动课件和V1.5成果工作区只从 `..\roadmap\architecture\README.md` 进入。它们不改变当前Runtime、控制权或V1-9顺序。

本次权威切换前的Streaming阶段与旧V1-9计划保存在 `..\archive\2026-07-16-v1-agent-refactor-authority-switch\`，仅作历史证据。历史材料索引见 `..\archive\README.md`，默认不读取。
