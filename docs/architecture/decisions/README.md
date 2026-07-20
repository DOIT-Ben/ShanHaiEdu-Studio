# 当前架构决策记录

本目录只保留仍控制当前实现的跨阶段决策。

| ADR | 状态 | 决策边界 |
|---|---|---|
| `2026-07-14-adr-main-agent-react-checkpoint-compaction.md` | accepted | ReAct只保留确定性checkpoint、最近call/output配对和脱敏遥测 |
| `2026-07-14-adr-r5-ppt-design-candidate-boundary.md` | accepted | 结构化语义候选与V1-9生产设计包分责 |
| `2026-07-16-adr-main-agent唯一编排与工作流原子Tool化.md` | accepted | Main Agent唯一拥有业务编排权；旧工作流拆为原子Tool、Tool级Skill和质量规则 |
| `2026-07-17-adr-project-development-gates.md` | accepted | 阶段路径、单调债务、SHA验证manifest和Provider receipt统一为失败关闭门禁 |
| `2026-07-20-adr-risk-based-complexity-governance.md` | accepted | 复杂度阈值触发风险评估；只拆职责混杂的高风险模块，稳定内聚大文件登记理由后可保留 |

未来候选ADR位于 `..\..\roadmap\architecture\`，不控制当前阶段。被覆盖或完成历史使命的ADR位于 `..\..\archive\`；2026-07-14 assistant-ui边界ADR已被2026-07-16唯一编排ADR覆盖并归档，旧文档不得恢复第二编排者、固定Tool顺序或宏节点自动推进。

新增ADR必须说明Context、Decision、Consequences、替代方案、迁移和回退；若替代现有ADR，先更新本索引，再归档旧文档。
