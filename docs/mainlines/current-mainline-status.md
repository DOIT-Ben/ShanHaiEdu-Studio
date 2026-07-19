# ShanHaiEdu 当前主线状态

更新时间：2026-07-19

## 当前结论

- 分支基线：`main@95b9b29d22553474ffe0c937d035bbe55924b157`，开始重构时与`origin/main`一致且工作区干净。
- 唯一活动阶段：`product-first-deep-refactor`。
- 当前口径：**CONTRACT PARTIAL / EXECUTOR PARTIAL / MODEL ORCHESTRATION PARTIAL / PRODUCT E2E PARTIAL / RELEASE NOT STARTED**。
- 本轮目标是删除竞争控制面并偿还已登记债务，不调用真实Provider，不创建V1-9 runId，不生成图片、视频、PPTX或ZIP。

## 已实现

- assistant-ui是生产对话入口；项目MessagePart和AgentEventEnvelope是持久化与API合同。
- Main Agent native function-call循环已经能够形成TaskBrief并调用原子Tool。
- TaskBrief、IntentGrant、IntentEpoch、ExecutionEnvelope、ToolInvocation、ValidationReport、Observation、Artifact和事件已有持久化基础。
- 局部真实桌面证据曾证明：模糊讨论不调用Tool；“只做需求规格”只调用`create_requirement_spec`并产生一个真实文本Artifact。
- Provider调用事实、验证manifest、release receipt和SQLite readiness已有失败关闭基础。
- ESLint已收紧为`0 error / 0 warning`硬门，生产构建动态追踪warning已从13条清零。
- Next standalone与桌面包现在拒绝环境文件、SQLite/WAL/SHM、测试资料和Provider私有台账；生产instrumentation不再加载V1-9文件型恢复控制面。

## 当前问题

- 旧`WorkflowNode`、`toolPlan`、`deliveryPlan`和生产deterministic路径仍在源码，尚未物理删除。
- Observation、Event、Invocation和authority audit终态缺少唯一一致性矩阵；authority summary没有完整重算这些关系。
- succeeded被错误推断为必须带Artifact，Observation-only成功可能被误判。
- 项目写入口与机器门仍需证明最外层统一wrapper、完整route扩展覆盖和无提前返回旁路。
- 31个复杂度债务文件和22个源码字符串合同债务文件尚未清零；Lint与构建动态追踪warning已清零。
- `conversation-turn-service.ts`为3476行，`main-agent-tool-loop-config.ts`为2336行；workbench repository等模块也混合多个职责。
- 当前Provider连续性receipt不存在；一次历史Main Agent续轮502仍使连续多轮稳定性保持未关闭。

## 尚未实现

- 真实Provider连续3组、唯一V1-9真实全链路、教师签收、部署与release。
- SQLite横向扩容；当前只适合本地或单实例。
- 完整且自洽的“五以内数的认识”交付样本；缺失文件不能补写成已完成事实。

## 已废弃

- 固定宏阶段推进、外层计划执行下一Tool、生产deterministic draft/fallback。
- 用复杂度baseline、warning预算或源码字符串baseline长期容纳历史债务。
- 用CI、Gate、manifest或文档齐全替代教师可用性和真实产品链路。

## 当前验收边界

| 层级 | 状态 | 本轮允许证明 | 本轮不能证明 |
|---|---|---|---|
| contract | partial | 重构后的行为合同与数据一致性 | 真实Provider稳定 |
| executor | partial | 原子提交、权限和恢复边界 | 真实媒体与整包执行 |
| model orchestration | partial | 既有局部文本链路 | 连续多轮和任意任务稳定 |
| product E2E | partial | 最终HEAD的桌面离线核心流程 | V1-9与教师签收 |
| release | not started | 无 | 部署或发布完成 |

## 唯一下一动作

按`..\stages\product-first-deep-refactor-plan.md`依次完成：合同正确性、旧控制面删除、两个核心模块拆分、31项复杂度与22项源码字符串合同债务清零和最终HEAD验证。Provider连续性在本阶段结束后从`..\roadmap\release\provider-continuity-readiness-spec.md`重新规划。
