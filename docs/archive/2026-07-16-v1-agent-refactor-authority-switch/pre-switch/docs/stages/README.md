# 当前阶段入口

更新时间：2026-07-16

`docs\stages\`当前唯一活动阶段：Main Agent 流式响应、Prompt Cache 与 assistant-ui 步骤投影。

## 活动文件

- `main-agent-streaming-assistant-ui-plan.md`
- `main-agent-streaming-assistant-ui-test-plan.md`

当前门状态：**IMPLEMENTED IN REPOSITORY / DESKTOP ACCEPTANCE NOT VERIFIED**。既有 V1-9 仓内 GO 证据保留，但当前不创建新run、不调用真实 Provider、不运行真实交付物链路。

## 固定边界

- R5不重跑。
- V1发布前不新增390px真实黑盒。
- fixture只证明仓内合同，不证明模型编排或产品E2E。
- 真实V1-9只允许由用户在确认最新已验收基线后执行一次。
- V1-9通过前不进入教师签收、部署、生产写入或V1-10。
- 仓内GO只证明contract与executor资格，不证明model orchestration、product E2E或release。

未来阶段统一从 `..\roadmap\README.md` 进入；历史阶段统一从 `..\archive\README.md` 追溯。两者都不能覆盖当前plan和test-plan。
