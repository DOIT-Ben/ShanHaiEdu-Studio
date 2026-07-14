# 用Codex-SDK加强shanhai-studio-V1

更新时间：2026-07-13
状态：`discussion snapshot / post-V1 candidate / not approved for implementation`
适用范围：`V1 全部完成并封板后的架构复审与升级评估`
当前约束：`本文件只沉淀讨论，不修改现有 V1 主线、既有计划、业务合同或运行时实现`

---

## 1. 文档目的

本文件沉淀一次关于 ShanHaiEdu Studio 智能体执行底座的架构讨论，供 V1 完成后重新审计。

当前不做以下事情：

- 不要求 V1 中途切换 Runtime；
- 不要求当前接入 Codex SDK；
- 不要求当前实现 MCP Server；
- 不替换现有 Main Agent；
- 不修改 ToolRegistry、ToolRouter、HumanGate、Quality Gate 或 Artifact 体系；
- 不把本文视为已批准 ADR；
- 不把当前讨论结论视为未来实施时仍然正确。

V1 封板后，必须以届时真实代码、测试、运行数据、官方接口和部署约束重新验证本文全部假设。

---

## 2. 当前讨论得出的核心判断

### 2.1 早期验证顺序可能偏重

理想的早期探索顺序本可以是：

```text
先使用成熟 Agent Runtime 做小范围能力验证
→ 再决定哪些通用执行能力需要自研
→ 把主要工程投入放在教育业务、质量、安全和交付闭环
```

当前项目已经投入较多自研 Runtime 和受控 ReAct 工作，因此现在不应因发现新的外部基座而推倒重来。

当前最合理策略是：

```text
先完成 V1
→ 固化 ShanHaiEdu 自主业务内核
→ 再评估 Codex 是否值得作为可选 Runtime
```

### 2.2 自研架构并非无效投入

现有自研能力具有长期价值，尤其是：

- 教师、用户、项目和对话身份；
- ToolRegistry 与 ToolRouter；
- 业务 Tool、Agent Tool、Provider Tool、Package Tool；
- Artifact、版本、血缘和最终包资格；
- HumanGate；
- ValidationReport、CriticReport、QualityDecision；
- ProjectExecutionLease、fencing token、IntentEpoch、inputHash；
- Provider 任务幂等、费用控制和恢复；
- PPT、图片、视频和最终交付业务工艺；
- 可审计、可测试、可替换的运行边界。

这些能力不应由第三方 Runtime 接管。

### 2.3 Codex 最适合替换的不是业务内核

Codex SDK 或 Codex App Server 若后续验证有效，最适合承担的是：

> 通用 Agent 执行与调度层。

候选职责包括：

- Thread / Turn；
- 多轮 Tool Loop；
- Observe → Plan → Act → Observe → Replan；
- 通用上下文续接；
- Agent 中断和恢复；
- 执行事件流；
- 通用工具调用决策；
- 通用审批交互；
- 运行时级别的会话管理。

Codex 不应替代：

- 教育业务规划；
- 教学规则和课程锚点；
- ToolRegistry / ToolRouter；
- 用户、项目、权限和数据隔离；
- HumanGate；
- Quality Gate；
- Provider 费用、幂等和恢复；
- Artifact 真值与版本；
- FinalDeliveryGate；
- 最终交付签收。

---

## 3. 目标架构原则

未来架构应保持以下分层：

```text
教师 / 前端
    ↓
ShanHaiEdu Business Main Agent
    ↓
ExecutionBrief / ToolCallEnvelope
    ↓
AgentRuntime Interface
    ├── ResponsesRuntime
    ├── NativeRuntime
    ├── CodexRuntimeAdapter
    └── FutureRuntimeAdapter
    ↓
MCP Adapter 或内部 Tool Protocol Adapter
    ↓
ShanHaiEdu ToolRouter
    ↓
Internal Tool / Agent Tool / Provider Tool / Package Tool
    ↓
Validation / Critic / QualityDecision / Artifact Promotion
```

### 3.1 ShanHaiEdu 是唯一业务真值源

Codex Thread 不是 ShanHaiEdu Project。

Codex 运行状态不能代替：

- Project；
- Conversation；
- Artifact；
- GenerationJob；
- QualityDecision；
- HumanGate；
- FinalDeliveryGate。

### 3.2 Runtime 必须可替换

上层业务只能依赖统一 `AgentRuntime` 合同，不得将 Codex 专属逻辑扩散到业务层。

候选接口示意：

```ts
interface AgentRuntime {
  start(input: RuntimeStartInput): Promise<RuntimeHandle>;
  resume(input: RuntimeResumeInput): Promise<RuntimeHandle>;
  interrupt(input: RuntimeInterruptInput): Promise<void>;
  streamEvents(handle: RuntimeHandle): AsyncIterable<RuntimeEvent>;
}
```

最终接口必须以后续 V1 真实代码为准，本文不提前冻结类型。

### 3.3 ToolRouter 是唯一执行入口

无论调用方是：

- 当前 Responses Runtime；
- Native Runtime；
- Codex；
- OpenCode；
- 测试夹具；
- 未来其他支持 MCP 的 Agent；

都不能绕过 ToolRouter 直接调用数据库、Provider 或 Artifact Repository。

### 3.4 ToolRegistry 是唯一工具合同来源

禁止长期存在多套独立 Schema：

```text
Responses Tool Schema
Native Tool Schema
MCP Tool Schema
Codex Tool Schema
```

正确方式应是：

```text
ShanHaiEdu ToolDefinition
    ├── 转换为 Responses Tool Schema
    ├── 转换为 MCP Tool Schema
    ├── 转换为测试夹具
    └── 转换为其他 Runtime 工具描述
```

### 3.5 Runtime 不得直接写业务权威状态

Runtime 可以输出：

- Tool Request；
- Agent Decision；
- Observation；
- Execution Event；
- Proposed Plan；
- Finish Request。

Runtime 不得自行写入或宣布：

- teacherApproved；
- humanGateApproval；
- QualityDecision；
- Artifact 正式版本；
- 最终包通过；
- Provider 已成功交付；
- 项目完成。

业务权威状态必须由 ShanHaiEdu 的确定性代码、Repository 和 Gate 更新。

---

## 4. MCP 在候选架构中的定位

### 4.1 MCP 不是新的业务系统

MCP 只应作为协议暴露层：

```text
Codex / 其他 Agent
→ MCP tools/list
→ MCP tools/call
→ ShanHai MCP Adapter
→ ToolRouter
```

现有业务 Tool 不应为 MCP 重写。

### 4.2 预计需要新增的边界

候选目录仅作说明：

```text
src/server/mcp/
├── mcp-server.ts
├── tool-list-adapter.ts
├── tool-call-adapter.ts
├── session-scope.ts
├── policy-guard.ts
└── result-mapper.ts
```

这些文件是否需要、如何命名，必须在 V1 封板后根据真实代码重新设计。

### 4.3 tools/list

将 ShanHaiEdu 的 ToolDefinition 映射为 MCP Tool：

```text
id / name
label / description
inputSchema
sideEffectLevel
HumanGate 元信息
```

MCP 暴露时只允许导出本次会话白名单内的工具。

### 4.4 tools/call

候选调用链：

```text
MCP tools/call
→ 验证 MCP session scope
→ 生成 ToolCallEnvelope
→ ToolRouter
→ PreValidation
→ Tool Executor
→ PostValidation
→ Observation / Result Mapper
→ 返回 Runtime
```

MCP 层不得自行实现业务 Tool，也不得绕过 Guard。

---

## 5. 身份、权限与调用信封

模型不能自由决定业务身份。

不应信任 Runtime 传入的：

- userId；
- projectId；
- conversationId；
- IntentEpoch；
- allowedTools；
- budget；
- HumanGate 证明。

这些字段必须由 ShanHaiEdu 服务端会话注入并签名或绑定。

候选 ToolCallEnvelope：

```text
actor
userId
projectId
conversationId
runtimeId
threadId
intentEpoch
actionDigest
inputHash
allowedTools
budgetScope
humanGateScope
traceId
lease / fencing context
```

正式字段必须以后续 V1 的统一调用信封为准。

---

## 6. Codex SDK 与 Codex App Server 的候选使用顺序

### 6.1 Codex SDK：能力验证入口

V1 完成后的第一阶段，可用 Codex SDK 验证：

- 新建 Thread；
- 恢复 Thread；
- 同一 Thread 继续 Turn；
- 是否能调用非编码教育 Tool；
- 是否能消费结构化 Observation；
- 是否能在验证失败后调整动作；
- 是否能稳定停在 HumanGate；
- 是否比当前 Runtime 减少人工干预。

### 6.2 Codex App Server：正式产品化候选

只有 SDK PoC 证明价值后，才评估 App Server，用于：

- 细粒度 Thread / Turn 管理；
- 实时执行事件；
- 中断与恢复；
- 审批请求；
- 用户中途输入；
- 更完整的 UI 状态映射；
- 更明确的服务端进程控制。

SDK 和 App Server 不应在未验证价值前同时大规模接入。

---

## 7. 服务器与多用户运行模型

候选映射：

```text
一个 ShanHaiEdu Conversation
↔ 一个 Runtime Thread ID
```

不应设计为：

```text
一个用户永久占用一个进程或一台服务器
```

更合理的候选模型是：

```text
Studio API
→ Job Queue
→ Runtime Worker Pool
→ 临时或可回收的 Codex 容器
→ ShanHai MCP / Tool Gateway
```

一个活跃 Turn 临时占用 Worker；空闲会话只保留业务状态和 Runtime Thread 映射。

需要自行补齐：

- 队列；
- 限流；
- 重试；
- 超时；
- Worker 调度；
- 过载保护；
- Thread 状态持久化；
- 用户与项目隔离；
- 成本计量。

---

## 8. 容器隔离候选方案

如果未来在服务器运行 Codex，容器化是硬要求，不是可选优化。

目标边界：

```text
Codex 容器
├── 可以维护 Thread
├── 可以执行受控 Agent Loop
├── 可以调用白名单 MCP Tool
├── 可以读取当前任务允许的临时材料
│
├── 不可访问宿主机
├── 不可访问其他用户目录
├── 不可直接访问业务数据库
├── 不可持有 Provider 长期密钥
├── 不可访问 Docker Socket
├── 不可使用 host network / host PID
└── 不可绕过 Tool Gateway
```

最低容器限制候选：

- 非 root；
- 只读根文件系统；
- 仅指定 workspace 和 tmp 可写；
- drop all Linux capabilities；
- no-new-privileges；
- CPU、内存、进程数和执行时长限制；
- 网络默认拒绝，只允许必要域名或内部 Gateway；
- 短期、会话绑定的 Tool Token；
- 任务结束销毁或回收；
- 不挂载业务代码和宿主机敏感目录。

是否“一 Turn 一容器”或“Worker Pod + App Server Sidecar”必须通过成本和恢复测试决定。

---

## 9. Codex 能力边界与风险

### 9.1 能力不能被预设为优于当前 Runtime

Codex 在代码、文件和命令环境中成熟，不代表其对以下任务天然更优：

- 教材理解；
- 教案设计；
- 小学认知适配；
- PPT 逐页设计；
- 课程锚点判断；
- 视频创意和教学质量返修。

必须通过同任务 A/B 实验验证。

### 9.2 第三方依赖风险

即使 Codex 的部分运行代码或 SDK 可查看、可集成，仍存在：

- API、模型和价格变化；
- 配额与可用性约束；
- SDK / App Server 接口升级；
- 服务端推理不可控；
- 模型行为漂移；
- 供应商锁定；
- 合规、数据和地域限制；
- 多租户成本不确定性。

因此 Native / Responses Runtime 不应在初次 PoC 时删除。

### 9.3 自研 Runtime 的长期价值

自研 Runtime 可作为：

- 业务控制基线；
- 第三方故障回退；
- A/B 对照组；
- 特定低成本任务 Runtime；
- 高确定性流程 Runtime；
- 供应商切换缓冲层。

---

## 10. V1 期间必须守住的可适配性约束

虽然当前不实施 MCP / Codex，但 V1 后续开发不应破坏以下边界：

1. ToolRegistry 是唯一 Tool Schema 来源；
2. ToolRouter 是唯一 Tool 执行入口；
3. Runtime 不直接写业务权威状态；
4. Observation、ValidationReport、CriticReport、QualityDecision 与具体 Runtime 解耦；
5. 用户、项目、IntentEpoch、预算和 HumanGate 由业务层注入；
6. Provider 密钥和数据库凭据对 Runtime 不可见；
7. Responses 专属逻辑不进入业务合同；
8. Runtime 选择通过工厂或 Adapter 管理；
9. V1 测试至少保留 Fake Runtime / Injected Executor 能力；
10. 新 Tool 必须声明副作用、权限、前置条件、输出和失败策略。

本文不要求当前修改代码，只在未来 V1 审计时用这些条目检查是否出现锁死。

---

## 11. V1 完成后的正式审计流程

V1 全部封板后，不应直接按本文实施，而应执行一次独立审计。

### 11.1 重新盘点真实代码

检查：

- AgentRuntime 最终接口；
- ToolRegistry 最终字段；
- ToolRouter 最终调用信封；
- Main Agent 与 Runtime 的真实职责；
- Observation 和 Replan 是否闭环；
- HumanGate 和 Quality Gate 接线；
- Runtime 是否直接写业务状态；
- Provider、Artifact、FinalDeliveryGate 是否可复用；
- 是否已经存在 MCP 或其他协议适配。

### 11.2 重新核对官方能力

必须重新核查届时官方最新资料：

- Codex SDK；
- Codex App Server；
- MCP 支持；
- 认证方式；
- Thread 持久化；
- Sandbox；
- 服务器部署；
- 并发与许可；
- 接口稳定性。

本文中的官方能力判断不得直接沿用。

### 11.3 建立差距矩阵

| 能力 | V1 Native | Codex Candidate | 是否值得迁移 |
|---|---|---|---|
| 多轮 Tool Loop | 待审计 | 待实测 | 待定 |
| Replan | 待审计 | 待实测 | 待定 |
| 中断恢复 | 待审计 | 待实测 | 待定 |
| Thread 持久化 | 待审计 | 待实测 | 待定 |
| 教育任务质量 | 待测 | 待测 | 待定 |
| 成本 | 待测 | 待测 | 待定 |
| 安全隔离 | 待审计 | 需外层实现 | 待定 |
| 可观测性 | 待审计 | 待实测 | 待定 |
| 供应商风险 | 较低 | 较高 | 待定 |

### 11.4 输出新的实施 ADR

只有通过审计和 PoC 后，才新建正式 ADR，明确：

- 是否接入；
- 接入哪个版本；
- SDK 还是 App Server；
- MCP 还是其他 Tool Protocol；
- 是否生产启用；
- 默认 Runtime；
- 回退策略；
- 发布门禁。

---

## 12. PoC 候选范围

PoC 必须小，不接真实付费生产链。

建议首批只使用三类低风险 Tool：

```text
read_course_context
create_ppt_outline
validate_ppt_outline
```

候选任务：

```text
读取课程上下文
→ 生成 PPT 大纲
→ 执行结构与教学约束校验
→ 校验失败后局部重写
→ 再校验
→ 通过后请求 HumanGate 或 finish
```

PoC 禁止：

- 真实图片批量生成；
- 真实视频生成；
- 正式 Artifact 提升；
- 最终包写入；
- 无限重试；
- 直接数据库访问；
- 直接 Provider 调用；
- 默认替换当前 Runtime。

---

## 13. A/B 评价指标

必须使用同一 WorldState、Tool 白名单、输入数据和质量门。

建议记录：

| 指标 | 说明 |
|---|---|
| 任务完成率 | 是否在边界内完成指定任务 |
| 人工干预次数 | 需要教师或开发者继续点击/补充的次数 |
| Tool 误调用率 | 未授权、顺序错误、重复或无意义调用 |
| Replan 有效率 | 失败后是否改变原因相关动作，而非机械重试 |
| 重复调用率 | 同一 inputHash / intentEpoch 下的重复执行 |
| 中断恢复成功率 | 中断、进程重启和 Worker 转移后的恢复 |
| Artifact 合格率 | 通过确定性 Validation 和质量门的比例 |
| 教育质量 | 教案、PPT、视频的独立量表结果 |
| 延迟 | 首次反馈、单 Turn、完整任务耗时 |
| Token / API 成本 | Runtime 与业务 Provider 总成本 |
| 安全违规 | 越权 Tool、越界文件、网络和状态写入 |
| 可归因性 | 失败是否能定位到 Runtime、Tool、Prompt、Gate 或 Provider |

不能仅以“看起来更像 Codex”作为升级依据。

---

## 14. 机械可靠性与语义质量必须分开

可重点追求的机械可靠性：

- 不丢状态；
- 不重复提交 Provider；
- 不重复扣费；
- 服务重启后可恢复；
- 旧任务不能覆盖新意图；
- 文件结构和格式有效；
- 权限和租约失效后停止写入；
- 失败可追踪。

不能直接承诺：

- 任意内容任务 99% 一次完成；
- 任意教材都生成高质量 PPT；
- 换成 Codex 后语义质量自动达到生产要求。

语义质量仍依赖：

```text
模型
+ Prompt / Skill
+ Tool
+ Contract
+ Validator
+ Critic
+ Repair
+ HumanGate
```

---

## 15. 候选实施阶段

以下只是未来审计时的讨论起点。

### Phase 0：V1 后审计

- 锁定 V1 SHA；
- 只读检查最终代码和门禁；
- 重新核对官方能力；
- 输出差距矩阵。

### Phase 1：协议适配 PoC

- 新建独立分支和 worktree；
- 实现最小 MCP Adapter；
- 只暴露低风险假工具或只读工具；
- 建立 session scope 和身份绑定测试。

### Phase 2：Codex SDK PoC

- 新增 CodexRuntimeAdapter；
- Thread 创建、继续和恢复；
- 三 Tool 闭环；
- 中断、超时和错误注入；
- 与 V1 Runtime A/B。

### Phase 3：容器与多租户验证

- 非 root 容器；
- Workspace 隔离；
- 网络白名单；
- 短期 Tool Token；
- Worker Pool；
- 多用户并发和越权测试。

### Phase 4：App Server 深度集成评估

仅在 SDK PoC 证明价值后进入：

- 事件流；
- UI 映射；
- 审批；
- 中断恢复；
- Thread 生命周期；
- 生产可观测性。

### Phase 5：小流量可选 Runtime

- 默认仍保留原 Runtime；
- 配置或项目级选择；
- 明确回退；
- 监控成本和错误；
- 不直接全量切换。

---

## 16. 否决条件

出现以下任一情况，应停止或延后接入：

- 官方接口不适合稳定服务端多租户；
- 无法可靠进行项目和用户隔离；
- Runtime 必须直接获得数据库或 Provider 长期密钥；
- MCP 无法保持 ToolRouter 为唯一执行入口；
- Codex 无法遵守 Tool 白名单和 HumanGate；
- 非编码教育任务质量不优于当前 Runtime；
- 成本显著增加且人工干预未下降；
- Thread 状态无法满足容器回收和灾难恢复；
- SDK / App Server 许可或部署边界不适合商业产品；
- 接入需要重写 V1 业务合同或破坏现有质量门；
- 故障无法归因或无法快速回退。

---

## 17. 本文的审计结论

当前结论不是“V1 后必须使用 Codex”，而是：

> V1 完成后，ShanHaiEdu 应把 Codex SDK / App Server 视为可选的通用 Agent Runtime 候选，通过 MCP 或等价受控协议复用现有 ToolRouter、业务合同、质量和安全体系。

当前最重要的不是提前接入，而是保证 V1 不把自身锁死在单一 Runtime：

```text
业务内核自主可控
+ Runtime 接口可替换
+ Tool 合同统一
+ ToolRouter 唯一执行
+ 权威状态由 Studio 控制
+ 外部 Runtime 只负责受控执行
```

最终是否升级、升级到什么程度，必须由 V1 封板后的新鲜审计、PoC 和 A/B 数据决定。

---

## 18. 后续复审入口

V1 完成后，新的审计任务至少应回答：

1. 本文哪些假设仍然成立？
2. V1 最终 Runtime 是否已经解决了本文担心的通用执行问题？
3. MCP 适配是否仍然是薄层？
4. ToolRegistry 和 ToolRouter 是否仍是单一真值源？
5. Codex 官方能力、价格、部署和许可是否变化？
6. Codex 对真实小学教育任务是否显著优于现有 Runtime？
7. 是否有必要接 App Server，还是 SDK 已足够？
8. 容器、多租户、Thread 持久化和成本是否可接受？
9. 是否应保留双 Runtime，还是只作为专家 Agent 使用？
10. 是否达到进入正式 ADR 和实现阶段的证据门槛？

只有完成上述复审，本文才可被新 ADR 替代或废止。

---

## 19. 外部参考入口

以下仅作为本次讨论时的参考入口，未来实施前必须重新核验：

- Codex SDK：`https://developers.openai.com/codex/sdk/`
- Codex App Server：`https://developers.openai.com/codex/app-server/`
- Codex MCP：`https://developers.openai.com/codex/mcp/`
- Codex 开源仓库：`https://github.com/openai/codex`
