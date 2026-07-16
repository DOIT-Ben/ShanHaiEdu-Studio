# V1 Stage 2：可执行合同、质量决策与受控 ReAct 测试计划

更新时间：2026-07-12
状态：accepted before implementation

## 1. Stage 2A 合同与验证

| ID | 场景 | 预期 |
|---|---|---|
| 2A-01 | 已注册 Tool | 每个可执行 Tool 都能生成 runtime contract，不要求固定 next node |
| 2A-02 | 缺少已批准必需输入 | PreValidator failed，Tool executor 调用次数 0，locator 指向缺失 kind |
| 2A-03 | 只有 should 规则不满足 | 不硬阻断；报告记录 warning/repair hint |
| 2A-04 | output kind/node 与 ToolDefinition 不一致 | PostValidator failed，Artifact 不提升 |
| 2A-05 | Provider 缺真实文件证明或质量硬门 | Validation failed/inconclusive，staging 保留，Artifact=0 |
| 2A-06 | 相同语义载荷 | canonical report digest 稳定；createdAt/ID 不影响语义 digest |
| 2A-07 | 报告与 generation inputHash/intentEpoch 错配 | 原子提升拒绝并 quarantine |
| 2A-08 | 内部 Tool 成功 | Artifact、Node、ValidationReport 一致提交，不出现报告丢失的成功产物 |

## 2. Stage 2B Critic 与决策

| ID | 场景 | 预期 |
|---|---|---|
| 2B-01 | Validation failed，但 Critic recommendation=pass | QualityDecision 必须 block |
| 2B-02 | Critic 缺必需证据或维度 not_scorable | block + regenerate_evidence |
| 2B-03 | blocker=0、major=0、分数过线 | 按目标 policy pass |
| 2B-04 | major>0 或返修阈值 | repair，并返回最小 locator/负责阶段 |
| 2B-05 | blocker>0 或阻断阈值 | block，不能被教师普通确认或模型推荐覆盖 |
| 2B-06 | 相同报告顺序变化 | canonicalized decision 相同；规则顺序固定 block > repair > pass |
| 2B-07 | Critic 尝试写 validator-only 字段 | schema/解析拒绝 |
| 2B-08 | target artifact version/digest 变化 | 旧 CriticReport、QualityDecision 自动失效 |

## 3. Stage 2C Observation 与 Replan

| ID | 场景 | 预期 |
|---|---|---|
| 2C-01 | Tool 非致命失败 | Observation 回到 Agent，Agent 可选不同 Tool/修上游/追问，不直接结束 Run |
| 2C-02 | 同 action/inputHash/reason 连续两次 | 第三次原样重试被阻止，nextAction=ask_teacher 或 pause |
| 2C-03 | quality repair 仅定位 page/shot | Replan 只返修目标 unit，不默认整套重做 |
| 2C-04 | 教师自然语言修改大纲 | Working Plan 可回退；旧 report/decision 失效；Main Agent 可重新规划 |
| 2C-05 | 达到 tool/cost/time budget | 持久化 checkpoint 并暂停，不标记完成 |
| 2C-06 | finish 无完整证据引用 | Guard 拒绝完成 |
| 2C-07 | simple chat/single tool | 允许没有 Working Plan，不强迫走 DAG |

## 4. 集中验证

```powershell
npx vitest run tests/contract-validation.test.ts tests/quality-decision-engine.test.ts tests/react-observation-replan.test.ts --maxWorkers=1
npm test
npm run build
git diff --check
```

Stage 2A 或 2B 单独通过只能声明子阶段完成；只有 2A/2B/2C 全部通过并完成 closeout，才能把 RQ-023 标记 done。
