# 架构决策记录 ADR

本目录用于保存长期架构决策。只有跨阶段、跨模块、会影响后续实现边界的决策才写入这里。

命名规则：

```text
YYYY-MM-DD-adr-主题.md
```

每份 ADR 至少包含：

1. 背景
2. 决策
3. 不采用的方案
4. 风险
5. 验证方式
6. 回退方式

已接受决策：

- `2026-07-13-adr-当前成果工作区替代常驻糖葫芦.md`：V1.5 下线常驻糖葫芦视觉形态，采用对话控制台、当前成果工作区与全部成果抽屉。
- `2026-07-14-adr-main-agent-react-checkpoint-compaction.md`：Main Agent 单轮 ReAct 使用确定性检查点、最近一次 call/output 配对和脱敏遥测，不再重放完整 reasoning 与 Tool 输出历史。
- `2026-07-14-adr-r5-ppt-design-candidate-boundary.md`：R5 只验收真实模型生成、绑定 TaskBrief 与可信证据的紧凑逐页语义候选；完整 PageSpec、样张计划和 production gate 保留到 V1-9。
- `2026-07-14-adr-v1-1采用assistant-ui与AG-UI兼容事件层.md`：V1.1以assistant-ui作为教师对话区唯一UI Runtime，以项目自有MessagePart和AG-UI兼容Adapter接入现有服务端业务真源。
