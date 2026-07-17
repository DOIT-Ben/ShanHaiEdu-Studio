# ShanHaiEdu 当前主线状态

更新时间：2026-07-17

## 1. 当前结论

- 唯一任务主线：V1.0 Main Agent唯一编排与原子Tool控制面整改。
- 当前状态：**REMEDIATION IN PROGRESS / CONTRACT RED / PRODUCT E2E PARTIAL / RELEASE NOT STARTED**。
- 阶段A（RMD-P1-01、P1-02、P1-06、P2-05）、阶段B（RMD-P1-03、P1-04、P1-05）、阶段C（RMD-P1-07、P1-08、P2-01至P2-04）和阶段D（RMD-P2-06、P2-07）已达到本地局部Go；A/B/C已形成独立本地提交，D正在形成当前独立提交；阶段E未完成，总整改仍为Red。
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

## 3. 当前未完成门

8项P1和7项P2均已取得阶段级局部Go；当前没有新增竞争问题清单。尚未完成的是阶段E全量回归、生产构建、当前HEAD启动与桌面核心流程，因此不得把局部Go上推为总整改、R5、产品E2E或release关闭。

## 4. 五层状态

| 证据层 | 当前状态 | 当前可声称 | 当前不可声称 |
|---|---|---|---|
| `contract` | partial | 阶段A至D的15项问题合同均取得本地局部Go | 总Go/No-Go通过 |
| `executor` | partial | HumanGate、抢先控制、持久授权、逐Provider submission、Observation/失败报告原子提交、Provider安全失败和schema readiness已通过定向测试 | 全量回归与真实桌面执行通过 |
| `model orchestration` | partial | 同task HumanGate checkpoint授权重绑定通过合同测试；单Tool真实桌面成功 | 连续多轮稳定、任意局部任务不扩张 |
| `product E2E` | partial | 桌面文本、范围、Tool、Observation和Artifact局部链路可见 | 双Tool及以上稳定、V1-9通过 |
| `release` | not started | 无 | 教师签收、部署或发布完成 |

## 5. 当前验证事实

- 整改前最近一次`npm test`：Node `383/384`，失败1项，Vitest未进入。
- 独立SQLite Vitest：`1509/1511`，195个测试文件，失败2项，分别暴露无pending改道和旧quick reply action问题。
- TypeScript在整改前审查时通过。
- 整改前`/api/health`虽返回200但只检查少量表，不能证明新增列和控制面表兼容；阶段D已修复，最终启动门仍待阶段E从当前HEAD复验。
- 曾有一次未显式隔离的Vitest可能写入默认SQLite；未查询、未清理。`.tmp`测试库均不纳入Git。

以上数字只记录整改起点，不是当前通过证明；完成后以本轮实际命令结果替换。

阶段A新鲜证据：隔离SQLite单worker Vitest `167/167`，assistant-ui/composer Node合同`11/11`，TypeScript和`git diff --check`通过。该证据只证明阶段A contract/executor局部关闭，不上推为产品E2E、R5或release完成。

阶段B新鲜证据：隔离SQLite单worker合并Vitest `284/284`，补充TaskBrief/范围/conversation回归`107/107`和`99/99`，TypeScript与`git diff --check`通过。该证据只证明阶段B contract/executor局部关闭；未调用真实媒体Provider，不上推为连续多轮model orchestration、产品E2E、R5或release完成。

阶段C新鲜证据：隔离SQLite单worker合并Vitest `141/141`，assistant-ui event route与M58 Node合同`5/5`，TypeScript与`git diff --check`通过。该证据只证明Observation/ValidationReport身份、消息sequence、等待态和失败去重的contract/executor局部关闭，不上推为产品E2E、R5或release完成。

阶段D新鲜证据：隔离SQLite单worker合并Vitest `110/110`，production preflight Node合同`13/13`，TypeScript与`git diff --check`通过。该证据只证明Provider未配置安全失败与SQLite schema readiness的contract/executor局部关闭；未调用真实Provider，不上推为连续多轮model orchestration、产品E2E、R5或release完成。

## 6. 唯一下一动作

严格按活动plan执行：

1. 完成阶段E全量回归、生产构建和当前HEAD启动。
2. 验证桌面核心流程并完成活动文档、代码和测试的最终同口径检查。

每阶段必须同步代码、测试和文档，真实验证后独立提交。任一Go门缺失都保持No-Go，不恢复旧控制路径，不进入V1-9。

## 7. 恢复入口

- 需求基线：`..\product\current-requirements-baseline.md`
- 设计基线：`..\architecture\V1.0 重构设计.md`
- 活动计划：`..\stages\v1-agent-atomic-tool-refactor-plan.md`
- 测试门：`..\stages\v1-agent-atomic-tool-refactor-test-plan.md`
- 过期closeout：`..\archive\2026-07-17-remediation-baseline\v1-agent-atomic-tool-refactor-closeout.md`
