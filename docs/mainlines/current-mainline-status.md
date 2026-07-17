# ShanHaiEdu 当前主线状态

更新时间：2026-07-17

## 1. 当前结论

- 最近完成主线：V1.0 Main Agent唯一编排与原子Tool控制面整改。
- 当前状态：**REMEDIATION VERIFIED / CONTRACT GO / PRODUCT E2E PARTIAL / RELEASE NOT STARTED**。
- 阶段A至E和8项P1、7项P2均通过本地整改门；完成计划已归档，当前无活动阶段。
- 整改前基线：`b4ad3849f6ae0953f3dfe856ce000e0def292023`，分支`main`；只本地提交，未push。
- 目标架构仍是`..\architecture\V1.0 重构设计.md`；当前代码已通过本轮审查问题对应的本地合同与执行验证，但不能据此宣称完整产品E2E或release完成。
- R5整体尚未关闭。既有桌面单Tool成功和双Tool部分成功只证明局部产品链路；一次Main Agent续轮`502`仍是连续多轮稳定性缺口。
- V1-9、教师签收和发布均未开始；未调用本轮范围外的图片、视频、PPTX、ZIP或整包Provider，未运行390px真实黑盒。

## 2. 已实现事实

- assistant-ui已经接入项目MessagePart和AgentEventEnvelope，固定五阶段rail与legacy会话切换已退出生产入口。
- 生产消息路由使用native function-call控制面；外层`toolPlan`/`deliveryPlan`不在native turn执行下一Tool。
- TaskBrief、IntentEpoch、ExecutionEnvelope、ToolInvocation、ValidationReport、Observation、Artifact和事件已有持久化与测试基础。
- 明确“只做需求规格”的真实桌面回合只调用`create_requirement_spec`并产生真实文本Artifact；模糊“是否改视频”对话没有调用业务Tool或提升IntentEpoch。
- 最终包下载存在正式package asset反向绑定边界，没有发现已确认的现场拼包路径。

## 3. 当前未完成门

本轮审查确认的15项整改问题已关闭。当前未完成项只有整改范围外的真实产品门：连续多轮Provider稳定性、唯一V1-9真实全链路、教师签收与release；不得把本地整改Go上推为这些事项完成。

## 4. 五层状态

| 证据层 | 当前状态 | 当前可声称 | 当前不可声称 |
|---|---|---|---|
| `contract` | go | 15项整改合同与全量回归通过 | V1-9和release合同通过 |
| `executor` | go | HumanGate、抢先控制、持久授权、逐Provider submission、原子事实、Artifact route TaskBrief、Provider安全失败和schema readiness通过 | 真实媒体与整包执行通过 |
| `model orchestration` | partial | 同task HumanGate checkpoint授权重绑定通过合同测试；单Tool真实桌面成功 | 连续多轮稳定、任意局部任务不扩张 |
| `product E2E` | partial | 桌面文本、范围、Tool、Observation和Artifact局部链路可见 | 双Tool及以上稳定、V1-9通过 |
| `release` | not started | 无 | 教师签收、部署或发布完成 |

## 5. 当前验证事实

- 整改前最近一次`npm test`：Node `383/384`，失败1项，Vitest未进入。
- 独立SQLite Vitest：`1509/1511`，195个测试文件，失败2项，分别暴露无pending改道和旧quick reply action问题。
- TypeScript在整改前审查时通过。
- 整改前`/api/health`虽返回200但只检查少量表；阶段D已修复，阶段E从最终工作树启动后返回200并证明关键schema与Artifact storage ready。
- 曾有一次未显式隔离的Vitest可能写入默认SQLite；未查询、未清理。`.tmp`测试库均不纳入Git。

以上数字只记录整改起点，不是当前通过证明；完成后以本轮实际命令结果替换。

阶段A新鲜证据：隔离SQLite单worker Vitest `167/167`，assistant-ui/composer Node合同`11/11`，TypeScript和`git diff --check`通过。该证据只证明阶段A contract/executor局部关闭，不上推为产品E2E、R5或release完成。

阶段B新鲜证据：隔离SQLite单worker合并Vitest `284/284`，补充TaskBrief/范围/conversation回归`107/107`和`99/99`，TypeScript与`git diff --check`通过。该证据只证明阶段B contract/executor局部关闭；未调用真实媒体Provider，不上推为连续多轮model orchestration、产品E2E、R5或release完成。

阶段C新鲜证据：隔离SQLite单worker合并Vitest `141/141`，assistant-ui event route与M58 Node合同`5/5`，TypeScript与`git diff --check`通过。该证据只证明Observation/ValidationReport身份、消息sequence、等待态和失败去重的contract/executor局部关闭，不上推为产品E2E、R5或release完成。

阶段D新鲜证据：隔离SQLite单worker合并Vitest `110/110`，production preflight Node合同`13/13`，TypeScript与`git diff --check`通过。该证据只证明Provider未配置安全失败与SQLite schema readiness的contract/executor局部关闭；未调用真实Provider，不上推为连续多轮model orchestration、产品E2E、R5或release完成。

阶段E最终证据：`npm test`中Node `387/387`、隔离SQLite单worker Vitest `1558/1558`；TypeScript通过；ESLint 0 error、150 warning；生产构建通过并保留13条动态文件追踪warning；desktop smoke通过；隔离实例health 200；1440x900真实浏览器完成登录、新建项目、普通讨论、局部需求规格和刷新终态，控制台0 error/0 warning。模糊讨论没有Tool/Artifact/IntentEpoch提升；局部回合仅1次`create_requirement_spec`和1个`requirement_spec` Artifact。未运行390px，未调用图片、视频、PPTX、ZIP或整包Provider。

工程残余：依赖安装审计报告6个moderate项；Lint 150条warning；Turbopack 13条动态文件追踪warning；首次子智能体隔离命令错误曾初始化默认`dev.db`，此后未读取或清理。以上不阻塞本地整改合同Go，但在release门必须重新评估。

## 6. 唯一下一动作

当前没有自动启动的下一阶段。若用户决定继续，唯一候选是backlog `P0-05`：按当前已验证合同重新规划V1-9、生成新manifest/runId并取得连续多轮Provider与真实产物证据；不得恢复旧V1-9材料。

## 7. 恢复入口

- 需求基线：`..\product\current-requirements-baseline.md`
- 设计基线：`..\architecture\V1.0 重构设计.md`
- 完成计划与测试证据：`..\archive\2026-07-17-agent-atomic-tool-remediation\README.md`
- 过期closeout：`..\archive\2026-07-17-remediation-baseline\v1-agent-atomic-tool-refactor-closeout.md`
