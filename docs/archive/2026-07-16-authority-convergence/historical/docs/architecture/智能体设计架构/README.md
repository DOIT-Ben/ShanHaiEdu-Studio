# 通用 Agent 工作台参考架构：5 平面与 12 系统

日期：2026-07-09

状态：通用参考架构草案；不绑定任何单一业务、代码仓库或教育场景。适用于把自然语言、多步骤工作流、工具调用、文件产物、长期记忆和质量门禁组合成可交付工作台的产品。

## 1. 一句话定义

通用 Agent 工作台不是普通聊天机器人，也不是单次生成工具，而是：

```text
一个以业务项目为中心，以 Agent 为调度者，以契约为规则，以工具/Provider 为执行器，以 Artifact 为事实，以 Memory 为个性化，以 Evidence 为可信度，以 Quality Gate 为交付保障的生产型智能工作台。
```

该定义可以适配不同业务：教育备课、投研报告、法务审阅、营销内容生产、科研写作、运维排障、企业知识处理、设计交付、项目管理等。

## 2. 为什么需要 5 平面 + 12 系统

多数失败的 Agent 产品会把以下职责混在一起：

```text
聊天 UI
模型 prompt
工具调用
文件生成
用户历史
长期记忆
质量判断
权限控制
交付状态
```

混在一起后会出现典型问题：

- 模型自称完成，但真实文件不存在。
- 长对话后上下文丢失，用户回来继续时断裂。
- prompt 规则散落在代码里，无法被业务人员调整。
- 工具调用绕过确认，出现高风险外部写入。
- 记忆、项目事实、节点规则互相污染。
- 失败无法局部重试，只能整条链路重跑。

5 平面用于回答“最高层职责如何分区”；12 系统用于回答“每个能力边界如何落地”。

## 3. 5 平面总览

| 平面 | 核心问题 | 负责什么 | 不负责什么 | 详文 |
|---|---|---|---|---|
| Experience Plane 体验平面 | 用户如何看见、操作、确认、下载？ | UI、项目入口、对话、进度、产物阅读、确认动作 | 直接执行模型、伪造状态、暴露工程细节 | `planes/01-experience-plane.md` |
| Agent Control Plane 智能体控制平面 | 下一步该做什么？ | 意图理解、计划、契约加载、上下文编排、门禁前置 | 真实文件生成、长期存储、最终质量裁决 | `planes/02-agent-control-plane.md` |
| Runtime Plane 执行运行平面 | 谁真正做事？ | 模型运行时、工具调用、Provider Adapter、文件落地 | 决定业务流程、伪造成功、直接写 UI 状态 | `planes/03-runtime-plane.md` |
| Data & Memory Plane 数据与记忆平面 | 什么必须被保存和恢复？ | 项目、消息、产物、证据、记忆、上下文快照 | 替代质量门禁、替代契约、静默写敏感记忆 | `planes/04-data-memory-plane.md` |
| Quality & Governance Plane 质量治理平面 | 能不能继续、下载、交付、记忆？ | 合同校验、真实文件校验、权限、隐私、安全、审计 | 直接生产内容、替代用户确认、替代业务判断 | `planes/05-quality-governance-plane.md` |

## 4. 12 系统总览

| 序号 | 系统 | 所属主平面 | 核心职责 | 详文 |
|---:|---|---|---|---|
| 1 | Workbench UX System 工作台体验系统 | Experience | 项目、对话、节点、产物、下载、确认 | `systems/01-workbench-ux-system.md` |
| 2 | Project & Actor System 项目与身份系统 | Data & Memory | 项目中心、用户/组织/角色、权限和审计主体 | `systems/02-project-actor-system.md` |
| 3 | Main Conversation Agent System 主对话智能体系统 | Agent Control | 意图理解、计划生成、打断处理、上下文读取 | `systems/03-main-conversation-agent-system.md` |
| 4 | Node Contract Control Plane 节点契约控制系统 | Agent Control | 节点规则、输入输出、禁止项、质量标准、版本发布 | `systems/04-node-contract-control-plane.md` |
| 5 | Capability Registry System 能力注册系统 | Agent Control | 系统能力目录、能力描述、输入要求、可用性 | `systems/05-capability-registry-system.md` |
| 6 | Workflow Orchestration System 工作流编排系统 | Agent Control | 多节点流程、状态机、断点恢复、重试和回退 | `systems/06-workflow-orchestration-system.md` |
| 7 | Agent Runtime System 模型运行时系统 | Runtime | 模型调用、结构化输出、fallback、token/成本观测 | `systems/07-agent-runtime-system.md` |
| 8 | Provider Adapter System 外部 Provider 适配系统 | Runtime | 第三方服务封装、下载、校验、错误分型 | `systems/08-provider-adapter-system.md` |
| 9 | Artifact & Asset System 产物与资产系统 | Data & Runtime | 真实产物、版本、文件、metadata、下载 | `systems/09-artifact-asset-system.md` |
| 10 | Memory System 记忆系统 | Data & Memory | 用户偏好、项目记忆、会话摘要、写入审批 | `systems/10-memory-system.md` |
| 11 | Knowledge & Evidence System 知识与证据系统 | Data & Memory | 来源、引用、证据链、置信度、RAG/检索 | `systems/11-knowledge-evidence-system.md` |
| 12 | Quality / Guard / Governance System 质量门禁与治理系统 | Quality & Governance | 合同校验、权限、安全、隐私、审计、交付门禁 | `systems/12-quality-guard-governance-system.md` |

## 5. 系统之间的主链路

```text
Workbench UX
  -> Main Conversation Agent
  -> Context Builder / Capability Registry
  -> Node Contract Control Plane
  -> Workflow Orchestration
  -> Agent Runtime / Provider Adapter
  -> Artifact & Asset System
  -> Quality / Guard / Governance
  -> Memory / Evidence / Project State
  -> Workbench UX
```

主链路的核心不变量：

```text
用户看到的是业务项目和产物；
Agent 看到的是经过编排的 ContextPackage；
工具看到的是被授权的结构化任务；
质量门禁看到的是可验证事实；
数据库保存的是可恢复、可审计、可回滚的状态。
```

## 6. 不同业务如何适配

| 业务场景 | Project 是什么 | Artifact 是什么 | Evidence 是什么 | Quality Gate 是什么 |
|---|---|---|---|---|
| 教育备课 | 一节课/一个单元 | 教案、PPT、视频、素材包 | 教材、课标、页码、课堂反馈 | 页数、引用、真实文件、课堂适用性 |
| 投研报告 | 一家公司/主题研究 | 报告、图表、数据表、简报 | 财报、公告、新闻、数据库 | 数据来源、假设、合规声明、图表可复验 |
| 法务审阅 | 一个合同/案件 | 审阅意见、风险清单、修订稿 | 合同条款、法律条文、案例 | 引用准确性、风险等级、人工确认 |
| 营销内容 | 一个 campaign | 文案、海报、脚本、素材包 | 品牌手册、产品信息、用户画像 | 品牌一致性、违规词、安全审核 |
| 运维排障 | 一个 incident | 诊断报告、修复计划、变更单 | 日志、监控、配置、变更记录 | 权限、回滚、影响面、生产确认 |

## 7. 推荐阅读顺序

1. 先读本文件，建立 5 平面和 12 系统全景。
2. 再读 `patterns/01-conversation-context-compaction.md`，理解长对话、恢复和无感压缩。
3. 再读 `patterns/02-node-contract-control.md`，理解如何把 prompt 变成可治理契约。
4. 再读 `patterns/03-memory-boundaries.md`，理解记忆、事实、规则如何隔离。
5. 最后按业务重点阅读 5 个平面和 12 个系统详文。

## 7.1 落地到山海智教的入口

如果当前目标是建设山海智教智能体，请从以下串联文档进入，而不是直接从某个系统文件开工：

```text
docs\architecture\2026-07-09-山海智教智能体-核心设计串联.md
```

该文档负责把本通用架构、山海智教五平面、山海智教十二系统、上下文压缩、节点契约和记忆边界串成一条落地主线。

## 8. 推荐参考来源

本参考架构复用的是机制，不绑定具体产品：

- OpenCode：agents、commands、skills、tools、server control plane、compaction、permissions。
- Hermes：USER/MEMORY、写入审批、session summary、skills as procedural memory。
- Mem0：user/session/org memory、metadata filtering、混合检索。
- Letta：memory blocks、archival memory、background reflection。
- LangGraph：state、node、edge、checkpoint、short-term/long-term memory 分离。
- 成熟工作流系统：状态机、任务队列、幂等重试、审计日志、权限门禁。

## 9. 架构不变量

1. 业务项目是中心，不是消息流。
2. Agent 是调度者，不是事实源。
3. Contract 是规则源，不是普通 prompt。
4. Tool / Provider 是执行器，必须可替换、可校验。
5. Artifact 是交付事实，必须可追溯、可下载、可验证。
6. Memory 是个性化和连续性，不能污染项目事实和系统规则。
7. Evidence 是可信度，不能让模型空口变成依据。
8. Quality Gate 是交付保障，模型自称完成不等于完成。
9. Conversation Log 必须完整保存；压缩只替代模型输入旧历史，不删除用户历史。
10. ContextPackage 是模型输入边界，不能让模型直接吞完整长会话。
11. 高风险工具执行必须经过 PlanGuard / HumanGate。
12. 用户界面呈现业务语言，不暴露工程词、密钥、本地路径和内部 schema。
