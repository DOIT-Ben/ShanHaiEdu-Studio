# ShanHaiEdu PPT / 视频交付效果工作流优化包

日期：2026-07-11
工作边界：只读研究现有项目；本目录独立于项目代码；不包含任何密钥。

## 一句话结论

ShanHaiEdu 现有 ToolRouter、Artifact Truth、HumanGate 和上下文底座方向正确，但主 Agent 目前仍是“一轮一个计划、一次工具执行”的单步桥。下一阶段应先补成受控 ReAct 循环，再把叙事、视觉、教学、连续性、可读性和可交付性变成可执行质量门与组件级返工闭环。

## 建议阅读顺序

1. `01-现有底层设计抽象与工具地图.md`
2. `02-交付效果问题诊断.md`
3. `03-A+-总体工作流设计.md`
4. `09-权威Agent设计与ShanHaiEdu-ReAct适配分析.md`
5. `04-PPT工作流优化.md`
6. `05-视频工作流优化.md`
7. `06-质量评估与自动返工机制.md`
8. `07-落地优先级与产品路线.md`
9. `08-验证与交付边界.md`

## 可直接复用的业务逻辑资产

- `contracts/node-contracts-v2.json`：建议新增或升级的节点契约。
- `contracts/*.schema.json` 与 `contracts/examples/`：可离线验证的内容节点、Agent 决策投影、Tool Observation、PPT/视频数据结构和有效示例。
- `contracts/README.md`：Contract、Tool、Working Plan、Workflow Capsule 与 WorkflowNode 的分层边界。
- `contracts/validate-contracts.ps1`：Schema、节点 ID 和跳转引用完整性验证。
- `prompts/`：总控、PPT、视频和交付审查提示词。
- `experiments/`：真实 API A/B 实验、输入、输出和评分结果。
- `review/`：独立智能体审查和修订记录。
- `sources/official-research.md`：外部一手来源及其设计影响。

## 核心重构方向

```text
ContextPackage / AgentWorldState
  -> Main Agent: Observe / Decide / optional Plan
  -> Guard / Interrupt
  -> ToolRouter
     -> PPT / Video specialists as tools
     -> Provider tools
     -> deterministic Workflow Capsules
  -> Artifact + Observation + Event commit
  -> Reflect / Replan / Ask / Finish
```

模型负责理解、规划、选择工具、并行和重规划；契约负责可信输入、最小输出与硬门；ToolRouter 负责真实执行；确定性检查负责验真；多模态审查负责评价效果；返工路由只重做失败页或失败镜头。Contract 不是 Tool，WorkflowNode 也不是 Agent 的固定执行图。

## 实验结论边界

- LLM 文本设计稿实验是单课题、单次同模型盲评，A+ 为 95/100、基线为 87.5/100；它不等于真实 PPTX 或跨课题效果已被证明。
- 图片实验支持“主视觉、景深、视线轨迹和本地叠加职责”比五列卡片墙更适合作为情境构图，但精确数学内容仍须本地确定性层。
- 视频只生成了 A+ 单样本，不是严格 A/B。完整解码通过，但实际 752×416、含额外 MJPEG 流、出现模糊展签，且音频为 -32.3 LUFS，因此不能作为最终交付样本通过。

## 明确不做

- 不修改 `ShanHaiEdu-Studio\main` 的任何代码、配置或数据库。
- 不把本优化包写成新一套 Provider 强耦合实现。
- 不用模型自评替代文件校验、教材证据、教师确认或最终验收。
- 不要求 PPT 与导入视频共享同一视觉脚本；二者只共享课程锚点、教材边界和必要品牌约束。
