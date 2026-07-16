# 外部编排成功不能作为产品Main Agent能力证据

## 结论

外部Codex完成高质量PPT、真实媒体调用、返修和成包，只能证明方法、专业工艺与底层Tool/Provider可行；只要选案、批准、下一动作、审查或返修范围由产品外部决定，就不能据此宣称产品Main Agent具备自主端到端交付能力。

## 触发与影响

- 触发条件：既有真实验收包主要由外部Codex进行编排、审查和返修，容易把“交付包已经做出来”与“产品智能体已经会做”混为一谈。
- 产品影响：外部人工补链会掩盖Main Agent在上下文、Tool选择、Observation/Replan、HumanGate、Quality Gate、持久化恢复或停止条件上的真实缺口。
- 验收影响：继续由外部Codex频繁重跑真实PPT、图片和视频，只会重复证明Provider链路，不能提高产品智能体能力证据，且会增加费用和错误归因。

## 事实与证据

### 已验证事实

- 既有真实PPT证明“大纲、逐页四层设计、样张、全量生图、可编辑组装、渲染审查、页级返修”的交付工艺可行。
- 既有图片、视频、TTS、字幕、拼接和最终包证明底层Tool与Provider技术链可用。
- 低年级验收包中的视频虽然技术链通过，但独立创意和课程锚点失败，说明“文件生成成功”不能替代内容质量门禁。
- V1-1编排归因审计确认，当前主链是模型首步选择加固定DeliveryPlan续步，不是Main Agent同轮多Tool Observe/Replan。
- 产品基线已经规定：课程锚点Provider前审查和成片后复核由产品内独立Critic执行；外部Codex只在V1-9成包后做黑盒审核。

### 当前未验证项

- 生产Main Agent能否在同一轮自主选择Agent Tool、消费Observation并改变下一动作。
- 生产Critic Executor、CriticReport持久化和课程锚点前置/成片后审查是否真实接入。
- 教师自然语言打断、改道、局部返修、双用户隔离和失败恢复是否能在同一真实任务中成立。
- 产品Main Agent能否在运行中外部业务决策为0的条件下独立生成最终交付包。

## 根因

测试前没有严格拆分“交付工艺验证、Agent Tool合同、生产Executor、Main Agent自主编排、最终黑盒E2E”五个证据层级，导致外部Codex完成的业务决策接近地被表述成产品智能体能力。

因果链：

```text
外部Codex掌握完整上下文和工具
-> 外部完成选案、批准、审查与返修
-> 真实交付包被成功生成
-> 方法与Provider成功被误当成产品Agent成功
-> 产品内编排缺口被人工补链掩盖
```

## 禁忌与替代动作

### 不要

- 不要在产品运行中由外部Codex选择视频方向、批准课程锚点或样张、决定返修范围。
- 不要把固定DeliveryPlan、规则Resolver、注入Executor或离线脚本完成的续步写成Main Agent自主ReAct。
- 不要用频繁真实Provider整包测试替代Agent编排、状态、失败注入和恢复验证。
- 不要把外部修好的交付包回写成产品内Plan、HumanGate、CriticReport、QualityDecision或Replan证据。

### 必须

1. 产品运行中的业务决策由Main Agent、专业Agent Tool、独立Critic和真实HumanGate完成，外部业务决策次数为0。
2. Main Agent协调失败时，先按WorldState、上下文、Tool可发现性与合同、Observation、Prompt/Rubric、预算与停止条件、持久化恢复逐层归因。
3. 每层能力只用本层证据声明：合同绿不等于Executor可用，Executor可用不等于Main Agent会编排，局部编排绿不等于真实整包E2E通过。
4. V1-1至V1-8使用夹具、失败注入、Provider adapter测试和持久化证据；只有前置门全部通过后，V1-9才执行一次产品内真实整包。
5. V1-9成包后，外部Codex按固定Rubric做黑盒审核，只输出只读`ExternalAcceptanceReport`，把问题归因到Agent、Tool、Prompt、Rubric、Gate或Provider责任层。
6. 归因后只做必要的定点修复与定点复验；没有新的责任假设时，不重复烧整包。

## 五层证据边界

| 证据层 | 能证明什么 | 不能证明什么 |
|---|---|---|
| 交付工艺与Provider | PPT/视频方法和真实媒体链可行 | 产品Main Agent会自主协调 |
| Agent Tool合同 | Registry、Schema、权限和结果语义成立 | 生产Executor已经可用 |
| 生产Executor | 专业Agent能真实运行并返回可信报告 | Main Agent会选择、消费并Replan |
| 产品内编排 | Main Agent能受控Observe/Plan/Act/Replan并恢复 | 最终真实交付效果一定合格 |
| V1-9黑盒E2E | 产品内独立成包后的真实用户效果与链路质量 | 外部验收者参与了产品运行时决策 |

## 落地与验证

| 预防动作 | 责任载体 | 验收条件 | 状态 |
|---|---|---|---|
| 编排能力归因 | V1-1审计、主线状态、阶段closeout | 固定计划、外部脚本和人工决策不计入Main Agent能力 | 已落实 |
| Agent Tool合同封板 | V1-2 Router/Registry/Schema与专项测试 | 合同全绿且三个Agent Tool仍明确`executorReady=false`、`mainAgentExecutable=false` | 已落实 |
| Main Agent同轮ReAct | V1-3运行时与持久化证据 | 同一轮消费Observation后自主改变下一动作，固定DeliveryPlan仅作显式降级 | 待实现 |
| 课程锚点产品内审查 | V1-7前置与成片后Critic | 外部干预为0；失败时Main Agent按finding定点Replan | 待实现 |
| 最终真实黑盒验收 | V1-9 E2E与`ExternalAcceptanceReport` | 产品智能体先独立成包，外部只读审核并完成责任归因 | 待实现 |

- 当前恢复点：V1-2已经封板；下一阶段先规划V1-3 Main Agent同轮受控ReAct，不调用真实媒体Provider。
- 残余风险：产品Main Agent自主编排、生产课程锚点Critic和V1-9真实整包均未形成运行时证据，不能提前宣称V1已具备端到端智能体交付能力。
- 关联案例：[《1～5的认识》验收包：PPT成功但视频创意锚点失败](2026-07-12-grade1-package-video-anchor-failure.md)。
