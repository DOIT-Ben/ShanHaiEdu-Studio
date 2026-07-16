# ShanHaiEdu 当前主线状态

更新时间：2026-07-17

## 1. 当前结论

- 唯一任务主线：V1.0 Main Agent唯一编排与原子Tool控制面整改。
- 当前状态：**REMEDIATION IN PROGRESS / CONTRACT RED / PRODUCT E2E PARTIAL / RELEASE NOT STARTED**。
- 整改前基线：`b4ad3849f6ae0953f3dfe856ce000e0def292023`，分支`main`；只本地提交，未push。
- 目标架构仍是`..\architecture\V1.0 重构设计.md`，但当前代码尚未完全符合该设计，不能再使用“implementation verified”或阶段closeout口径。
- R5整体尚未关闭。既有桌面单Tool成功和双Tool部分成功只证明局部产品链路；一次Main Agent续轮`502`仍是连续多轮稳定性缺口。
- V1-9、教师签收和发布均未开始；未调用本轮范围外的图片、视频、PPTX、ZIP或整包Provider，未运行390px真实黑盒。

## 2. 已实现事实

- assistant-ui已经接入项目MessagePart和AgentEventEnvelope，固定五阶段rail与legacy会话切换已退出生产入口。
- 生产消息路由使用native function-call控制面；外层`toolPlan`/`deliveryPlan`不在native turn执行下一Tool。
- TaskBrief、IntentEpoch、ExecutionEnvelope、ToolInvocation、ValidationReport、Observation、Artifact和事件已有持久化与测试基础。
- 明确“只做需求规格”的真实桌面回合只调用`create_requirement_spec`并产生真实文本Artifact；模糊“是否改视频”对话没有调用业务Tool或提升IntentEpoch。
- 最终包下载存在正式package asset反向绑定边界，没有发现已确认的现场拼包路径。

## 3. 当前已确认问题

当前问题以`..\stages\v1-agent-atomic-tool-refactor-plan.md`的问题矩阵为唯一清单，共8项P1和7项P2。根因集中在：

1. HumanGate、控制抢先提交、旧action和持久授权复核不完整。
2. Tool Registry仍含固定DAG，TaskBrief局部输出粒度不足，批量Provider调用预算失真。
3. Observation、ValidationReport、消息顺序、失败去重和等待态投影不一致。
4. Provider未配置时缺少教师安全失败，health不能证明当前schema readiness。

## 4. 五层状态

| 证据层 | 当前状态 | 当前可声称 | 当前不可声称 |
|---|---|---|---|
| `contract` | red | 既有合同与测试基础存在 | 当前Go/No-Go通过 |
| `executor` | partial | 部分原子提交、隔离和恢复测试已有证据 | HumanGate、抢先控制、逐Provider调用和持久授权完整 |
| `model orchestration` | partial | 单Tool真实桌面成功；模糊讨论未误触Tool | 连续多轮稳定、任意局部任务不扩张 |
| `product E2E` | partial | 桌面文本、范围、Tool、Observation和Artifact局部链路可见 | 双Tool及以上稳定、V1-9通过 |
| `release` | not started | 无 | 教师签收、部署或发布完成 |

## 5. 当前验证事实

- 整改前最近一次`npm test`：Node `383/384`，失败1项，Vitest未进入。
- 独立SQLite Vitest：`1509/1511`，195个测试文件，失败2项，分别暴露无pending改道和旧quick reply action问题。
- TypeScript在整改前审查时通过。
- `/api/health`曾返回200，但现实现只检查少量表，不能证明新增列和控制面表兼容。
- 曾有一次未显式隔离的Vitest可能写入默认SQLite；未查询、未清理。`.tmp`测试库均不纳入Git。

以上数字只记录整改起点，不是当前通过证明；完成后以本轮实际命令结果替换。

## 6. 唯一下一动作

严格按活动plan执行：

1. 控制与授权。
2. 任务语义与Tool边界。
3. Observation与消息投影。
4. 健康与恢复。
5. 全量回归与真实桌面核心流程。

每阶段必须同步代码、测试和文档，真实验证后独立提交。任一Go门缺失都保持No-Go，不恢复旧控制路径，不进入V1-9。

## 7. 恢复入口

- 需求基线：`..\product\current-requirements-baseline.md`
- 设计基线：`..\architecture\V1.0 重构设计.md`
- 活动计划：`..\stages\v1-agent-atomic-tool-refactor-plan.md`
- 测试门：`..\stages\v1-agent-atomic-tool-refactor-test-plan.md`
- 过期closeout：`..\archive\2026-07-17-remediation-baseline\v1-agent-atomic-tool-refactor-closeout.md`
