# ShanHaiEdu V1 Stage 2C Observation、Replan 与完成门禁收尾

日期：2026-07-12

状态：完成

关联需求：`RQ-023`；Stage 2A/2B/2C 集中验收通过后，`RQ-023` 关闭

## 1. 阶段结论

Stage 2C 已把 Stage 2A 的确定性 ValidationReport 和 Stage 2B 的 QualityDecision 接回 Main Agent 的受控 ReAct 主链：

- Tool 成功、失败、合同校验、证据不足、预算暂停和教师改道统一形成 `AgentObservation`。
- Observation 保存 actionKey、inputHash、reasonCodes、reportRefs、targetLocators、responsibleStage 和 minimalNextAction，并通过消息 metadata 持久化。
- `AgentWorldState` 每轮从持久化消息恢复可信 Observation 和最新 `RunCheckpoint`，重启后仍可继续判断。
- 同 actionKey、inputHash、失败原因连续两次时，第三次原样工具调用在执行前被阻止，转为 `ask_teacher` 并保存 paused checkpoint。
- tool/context/consecutive-failure 预算耗尽时保存 checkpoint，不把运行标成成功；成功或教师改道后写 checkpoint tombstone，避免恢复旧暂停态。
- 教师修改或取消活动计划时，旧 pending action 变为 superseded，同时推进项目 `intentEpoch`，旧确认无法授权新意图。
- page/asset/shot/track/timeline/frame_range locator 可驱动 `repair_unit`，无局部定位时才回退 `repair_upstream`。
- 普通聊天和单个边界清晰的工具调用不要求 Working Plan；多步骤任务才使用可修改的计划，不形成强制全局 DAG。
- 真实 `finishAgentRun` 成功入口不再接受裸 `status=succeeded`；必须绑定当前 Artifact、passing ValidationReport 和 passing QualityDecision，且三者 digest、版本、目标和验证关系一致。

## 2. 主要实现

| 区域 | 实现 |
|---|---|
| ReAct 协议 | `AgentObservation`、`RunCheckpoint`、`WorkingPlan`、显式 transition decision、finish guard |
| 持久化恢复 | Observation/checkpoint 写入消息 metadata；可信解析、最新 checkpoint 恢复和 tombstone 清除 |
| 世界状态 | Main Agent 每轮获得最近 Observation、局部返修定位和当前暂停信息 |
| 重复失败 | actionKey + inputHash + reason 的连续签名门禁，第三次调用前阻止 |
| 教师改道 | revision/cancel 优先于旧确认；旧 action superseded；`intentEpoch` 单调推进 |
| 完成门禁 | finish 路由、service、repository 在同一事务内复核当前 Artifact 和两类报告 payload/digest |
| 非 DAG 边界 | chat/single tool 不强制计划；Observation 允许 continue、局部返修、上游返修、追问、暂停或完成 |

## 3. Stage 2C 验收矩阵

| ID | 结果 | 证据 |
|---|---|---|
| 2C-01 | 通过 | 非致命 Tool/Validation 失败写 Observation，下一轮进入 AgentWorldState，可选择不同动作 |
| 2C-02 | 通过 | 两次相同 action/input/reason 后第三次工具调用为 0，持久化 repeated_failure checkpoint |
| 2C-03 | 通过 | page locator 返回 `repair_unit` 和精确 repairTargets，不默认整套重做 |
| 2C-04 | 通过 | 自然语言修改旧计划后 action superseded、intentEpoch +1、旧 actionId 拒绝 |
| 2C-05 | 通过 | 预算耗尽保存 paused checkpoint；成功或改道清除历史暂停态 |
| 2C-06 | 通过 | 纯 guard 与真实 finish 路由均拒绝缺失、错目标、错 digest 或未绑定的证据 |
| 2C-07 | 通过 | chat/single tool 无 Working Plan 仍可工作，multi-step 才要求计划 |

## 4. 新鲜验证

```text
Stage 2 联合专项
npx vitest run tests/contract-validation.test.ts tests/quality-decision-engine.test.ts tests/react-observation-replan.test.ts --maxWorkers=1
3 files / 26 tests passed

Stage 2C 主链专项
tests/react-observation-replan.test.ts
tests/conversation-control-resolver.test.ts
tests/agent-world-state.test.ts
tests/conversation-turn-service.test.ts
4 files / 58 tests passed

finish 真实入口专项
src/server/workbench/__tests__/stage5-agent-run-recovery.test.ts
tests/react-observation-replan.test.ts
2 files / 17 tests passed

npm test
Node 259/259 passed
Vitest 552/552 passed

npm run build
Next.js production build exit 0；TypeScript 通过；13 个静态页面生成完成

独立 .tmp SQLite 连续初始化
2/2 exit 0

git diff --check
exit 0
```

## 5. 未关闭边界

- 真实 Delivery Critic 模型尚未消费 PPT render 或视频 frame/audio 证据；当前完成的是严格 Schema、Rubric、Decision、持久化和回流边界。
- 本阶段没有调用付费 PPTX、图片或视频 Provider，也没有宣称现有 PPT/视频达到公开课交付质量。
- 消息 metadata 是本阶段 Observation/checkpoint 的权威持久化载体；若未来单项目历史增长影响查询，再按真实性能证据迁移独立表，不提前复制状态源。
- `finishAgentRun` 的三证据 pass 仍不等于教师批准；教师签收和 `final_eligible` 属于 RQ-024/RQ-025/RQ-026。
- V1 整体仍未完成，真实 Provider、PPT、视频、最终包、服务器恢复和教师签收门继续保持未关闭。
- 未提交、未 push、未部署，既有 `v1` 标签未移动。

## 6. 下一阶段

```text
RQ-024：PPT Quality 纵向闭环
```

从教材证据、叙事大纲、视觉系统、逐页 PageSpec 和关键样张开始，接入真实资产、render evidence、Delivery Critic、页级返修与真实可编辑 PPTX；至少完成一套 12 页试点，但不得用文本 fallback、目标页数或文件名冒充真实 PPTX。
