# ShanHaiEdu 当前架构入口

更新时间：2026-07-16

本目录只保留当前架构不变量和已接受ADR。历史架构包、早期五平面/十二系统材料和已被覆盖的ADR已归档。

## 架构不变量

- Project、TaskBrief、IntentGrant、IntentEpoch和Artifact版本是跨轮状态真源。
- 产品Main Agent是业务Tool选择、下一步、Observation、Replan、重试和停止的唯一编排者。
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

入口：`decisions\README.md`。

## 当前合同

- Provider台账绑定：`..\contracts\provider-ledger-runtime-contract.md`
- 产品不变量：`..\product\current-requirements-baseline.md`
- 当前Runner完整性阻塞：`..\mainlines\current-mainline-status.md`

## 未来候选

Codex SDK、互动课件和V1.5成果工作区只从 `..\roadmap\architecture\README.md` 进入。它们不改变当前Runtime、控制权或V1-9顺序。

历史材料索引见 `..\archive\README.md`，默认不读取。
