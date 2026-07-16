# V1.0智能体重构权威切换快照

日期：2026-07-16
状态：historical evidence only

## 目的

本目录保存V1.0 Main Agent唯一编排与工作流原子Tool化成为活动主线之前的权威文件原文。

这些文件用于证明切换前状态、审计字节一致性和必要时人工比较，不得作为活动需求、架构、阶段或执行入口。

## 归档范围

- 切换前项目`AGENTS.md`；
- 文档总入口、需求基线、backlog和主线状态；
- 架构与ADR索引；
- 阶段索引；
- Main Agent Streaming + Prompt Cache + assistant-ui旧阶段plan/test-plan；
- 重构前V1-9真实全链路plan/test-plan。

原文位于`pre-switch\`并保留原相对路径。逐文件字节数与SHA-256见`archive-manifest.json`。

## AGENTS双备份

- 项目内：`AGENTS_20260716-150330.bak`
- 全局规则备份目录：`AGENTS_20260716-150330.bak`

两份备份与`pre-switch\AGENTS.md`的SHA-256均为：

```text
0969a28763396a36b91203a4563b30110729d3818b7ba80e41c6488dc7c590fe
```

## 活动替代入口

- `..\..\architecture\V1.0 重构设计.md`
- `..\..\architecture\decisions\2026-07-16-adr-main-agent唯一编排与工作流原子Tool化.md`
- `..\..\stages\v1-agent-atomic-tool-refactor-plan.md`
- `..\..\stages\v1-agent-atomic-tool-refactor-test-plan.md`

旧Streaming能力的实现证据可以作为前置能力引用，但旧阶段不得恢复。旧V1-9计划冻结在重构前合同上；V1.0关闭后必须重新制定，不得复制回活动目录。
