# MVP 并行主线总览

日期：2026-07-07

## 1. 总目标

最快拿到一个本地真实可用的 ShanHaiEdu Media Workbench MVP。

MVP 不是 mock 原型，必须至少做到：

- 可以新建项目。
- 可以真实保存对话、节点、产物和确认状态。
- 可以真实生成文本类产物。
- 刷新后状态不丢。
- 1-2 人可同时本地试用，架构预留 5 人试运行。
- 未接入的 PPTX、图片、视频文件能力明确标记，不伪装完成。

## 2. 并行主线

| 主线 | 目标 | 先交付什么 |
| --- | --- | --- |
| Backend Workflow Lite | 建立真实状态真源和 API 合同 | 项目、消息、节点、产物保存与读取 |
| Frontend API-backed Workbench | 让现有前端从 mock 改为真实数据源 | 新建项目、发送消息、显示真实节点 |
| Agent Runtime Adapter | 接入可替换的生成运行时 | DeterministicRuntime 跑通，再接 OpenAI |
| E2E Verification | 证明本地 MVP 真的能用 | 端到端、刷新恢复、双项目隔离验收 |

## 3. 并行原则

- `main` 是干净主线，只接收通过阶段验收的变更。
- 每条主线在独立 worktree 或独立目录开发，不直接污染主目录。
- 每条主线先写阶段规划文档，再写测试文档或测试用例，再开发。
- 阶段内可以小步验证，阶段结束必须集中验收。
- 四条主线通过共享 API 合同和数据模型对齐，不靠口头约定。
- 分发给新对话的 hand off 必须使用 `docs\handoffs\TARGET_MODE_HANDOFF_TEMPLATE.md`：短指令、目标模式、分阶段推进，不能只让对方读文档或写计划后停下。

## 4. 当前工作树

```powershell
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\backend-workflow-lite
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\frontend-api-backed-workbench
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\agent-runtime-adapter
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\e2e-verification
```

`main` 只做集成和稳定态；四条功能主线均在各自 worktree 中开发。

## 5. 集成顺序

第一轮集成顺序：

```text
Backend contract skeleton
-> Deterministic runtime vertical slice
-> Frontend API-backed shell
-> E2E verification
-> OpenAI runtime
```

原因：

- 先定状态真源，避免前端和 runtime 各写各的。
- 先用 deterministic runtime，保证链路稳定可测。
- 真实 OpenAI 接入后置，避免模型波动阻塞基础闭环。

## 6. 共享验收口径

四条主线最终必须共同证明：

```text
新建项目
-> 输入一句话需求
-> 系统保存消息
-> Runtime 生成需求澄清
-> 生成需求规格 artifact
-> 前端显示节点
-> 用户确认
-> 刷新恢复
-> 两个项目互不串
```

## 7. 关联文档

- `REQUIREMENTS_DECISION_V1.md`
- `原始需求记录_V1.md`
- `docs\mvp-to-production-agent-architecture.md`
- `docs\mainlines\backend-workflow-lite.md`
- `docs\mainlines\frontend-api-backed-workbench.md`
- `docs\mainlines\agent-runtime-adapter.md`
- `docs\mainlines\e2e-verification.md`
- `docs\mainlines\agent-workflow-runtime-promptpack-governance.md`
- `docs\handoffs\parallel-mainlines\`
- `SHANHAIEDU_LEGACY_RETROSPECTIVE.md`：初代 ShanHaiEdu 资产吸收、缺陷避坑、新增主线建议；四条 MVP 主线 Stage 1 收尾和集成审查时必须读取。
