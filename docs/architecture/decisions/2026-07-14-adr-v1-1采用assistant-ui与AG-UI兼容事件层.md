# ADR：V1.1采用assistant-ui与AG-UI兼容事件层

日期：2026-07-14

状态：Accepted for V1.1 planning；V1发布前不实施

## 1. 背景

当前对话层把消息正文、计划卡、快捷回复、成果卡和运行状态分散在项目自有组件与完整Snapshot轮询中。回复呈现、长任务活动流、Tool状态、HumanGate、成果引用、重试和刷新恢复在多份需求中重复声明，继续逐项自研会形成多套消息语义。

V1仍在修复Main Agent自主编排与HumanGate，不能用前端框架迁移代替控制层修复，也不能让V1.1的UI改造提前阻塞V1上线。

## 2. 决策

V1.1采用以下唯一实现路线：

```text
现有Main Agent与业务状态真源
-> 项目自有MessagePart和运行事件合同
-> AG-UI兼容Adapter与可恢复流
-> assistant-ui ExternalStoreRuntime
-> 教师对话、活动、Tool、计划、成果引用与HumanGate组件
```

- assistant-ui是教师对话区唯一UI Runtime，不是Agent内核或业务状态机。
- AG-UI只作为前后端事件兼容协议；ShanHaiEdu业务事件使用命名空间扩展。
- 数据库持久化项目自有合同和业务引用，不持久化第三方库私有对象作为权威模型。
- BlockNote保留到V1.3-V1.5文档成果工作区，不进入本次对话Runtime迁移。
- 迁移采用加法字段、影子投影、受控账号切换和可回退功能开关，不长期双写。

## 3. 采用理由

- `ExternalStoreRuntime`允许现有系统继续拥有消息和状态，并通过Adapter提供assistant-ui所需格式，适合当前数据库与Snapshot底座的渐进迁移。
- assistant-ui按回调能力启用编辑、重试、分支和队列，便于保持服务端权威；未实现安全合同的能力可以不暴露。
- AG-UI已经定义运行、文本、Tool、状态、活动和自定义事件语义，可减少项目继续发明不兼容事件名，同时允许保留教育业务扩展。
- 项目自有中间合同隔离第三方升级风险，未来替换UI Runtime时不需要迁移Artifact、HumanGate和Quality Gate业务真源。

官方参考：

- assistant-ui ExternalStoreRuntime：`https://www.assistant-ui.com/docs/runtimes/custom/external-store`
- assistant-ui仓库与MIT许可证：`https://github.com/assistant-ui/assistant-ui`
- AG-UI Events：`https://docs.ag-ui.com/concepts/events`
- AG-UI Serialization：`https://docs.ag-ui.com/concepts/serialization`

实施阶段必须按锁定版本重新核对React 19兼容性、许可证、变更日志和安全公告，规划日期的调研不能代替安装时验证。

## 4. 不采用的方案

### 4.1 继续扩展现有ChatTranscript

不采用。它可以修复V1裸Markdown问题，但继续承载消息Parts、流式、活动、Tool、分支和恢复会重复建设通用聊天Runtime。

### 4.2 直接把assistant-ui类型写入数据库

不采用。第三方UI类型会成为业务数据合同，升级或替换Runtime时产生高迁移成本，也容易让客户端显示状态反向污染业务真源。

### 4.3 全量照搬AG-UI事件并替换业务表

不采用。事件协议不能替代Artifact版本、PendingDecision、QualityDecision、权限、幂等和费用事实；业务表继续权威，事件只做投影与恢复。

### 4.4 同时接入CopilotKit、Vercel AI SDK UI或OpenCode

不采用。多个主Runtime会制造重复状态和适配层。未来Agent内核变化只能通过现有AgentRuntime/Tool边界演进，不影响教师前端合同。

### 4.5 在V1阶段立即迁移

不采用。V1当前P0是Main Agent和HumanGate职责纠偏，提前迁移会扩大回归面并掩盖服务端状态错误。

## 5. 风险与控制

| 风险 | 控制 |
|---|---|
| assistant-ui升级破坏适配 | 项目自有合同、锁版本、Adapter合同测试 |
| 事件与Snapshot形成双真源 | 业务表权威；事件仅投影；重连后服务端快照校正 |
| 流式重复导致重复执行 | eventId/sequence幂等；Tool执行只由服务端运行状态触发 |
| 通用重试重放真实费用 | 按服务端能力开启回调；副作用任务走IntentEpoch和ActionPolicy |
| 历史消息丢失 | 旧content确定性映射text Part；影子期做顺序与引用对比 |
| 教师看到工程细节 | 教师安全事件白名单、自定义Renderer和浏览器文本扫描 |
| 双Runtime长期共存 | 旧UI有明确删除条件；禁止双写业务状态 |

## 6. 验证方式

- MessagePart与assistant-ui消息转换合同测试。
- AG-UI兼容事件顺序、重复、断线续接、压缩和恢复测试。
- 历史数据库、旧消息、旧成果引用与当前计划兼容测试。
- HumanGate、Quality Gate、Artifact、权限和双用户隔离回归。
- 1366x768和390x844真实浏览器流式、长内容、错误与键盘验收。
- 功能开关切换及旧UI回退演练。

## 7. 回退方式

关闭assistant-ui入口功能开关，恢复旧UI读取同一服务端消息和业务状态。保留加法字段与事件记录，不删表、不降级Artifact/HumanGate/Quality Gate，不重放Tool。回退验证通过前不得删除旧UI兼容路径。
