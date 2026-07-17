# 当前前端工作台

本目录只保留当前入口和视觉证据，不再保存M44至M54等历史阶段路线。

## 当前实现边界

- assistant-ui通过ExternalStoreRuntime适配现有服务端消息与事件。
- 旧正文无损映射为text part；新消息保留类型化parts和安全回退正文。
- Artifact、计划、质量、HumanGate和错误只接受服务端引用，不从正文关键词猜测。
- 事件按project与sequence幂等恢复；Snapshot水位单调，断线后先校正再续接。
- 实时与刷新统一使用服务端`agentTimeline`：相邻文本合并，同Tool状态保留sequence首尾，Observation、Artifact和终态按真实sequence投影；queue终态后回写消息元数据，不依赖有限事件窗口恢复。
- 无当前turn持久活动时只显示“小酷正在回复”和真实耗时；客户端不得推测“正在理解、组织、保存”等阶段，历史completed投影不得隐藏当前等待。
- 失败只在reasonCode与完整evidenceRefs一致时去重；不同原因必须保留，但同一失败只提供一个恢复入口。
- 编辑、重试、分支和队列操作只有服务端存在安全合同时才显示。

## 当前验证

V1前只执行桌面真实浏览器门。长Markdown、表格、活动、成果引用、HumanGate、错误恢复和输入区必须无重叠、截断、裸Markdown和工程词。

视觉证据规则：`assets\references\README.md`。

未来设计吸收：`..\..\roadmap\ui\README.md`。

历史M54-A规格与28份stage-history已归档至：

```text
..\..\archive\2026-07-16-authority-convergence\historical\docs\ui\frontend-workbench\
```
