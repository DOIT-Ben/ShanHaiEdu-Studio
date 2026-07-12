# ShanHaiEdu V1 上线前主线微调与接管计划

更新时间：2026-07-13

状态：`Accepted / implementation pending`

## 1. 目标

在保留现有执行安全、合同、质量、PPT、视频和最终包实现的基础上，把V1最后阶段从“由外部Codex继续制作更多验收包”调整为“证明产品内部Main Agent能够自主编排，并支持两名受邀教师同时使用”。

V1上线目标：两名教师可以同时登录、操作不同项目并提交完整备课任务；项目、对话、强度、任务和产物严格隔离；Main Agent能够执行有界`Observe -> Plan -> Guard -> Act -> Observe -> Replan`，通过注册工具、HumanGate和Quality Gate完成真实交付。

## 2. 当前基线

- 执行身份、项目租约、fencing、IntentEpoch、幂等、Provider任务恢复和原子提升已实现并有自动化证据。
- Node Contract、ValidationReport、CriticReport、QualityDecision、Observation/Replan和finish证据门已实现。
- PPT生产方法和真实12页可编辑PPTX已形成有效金样。
- 低年级视频技术链路通过，但独立创意与课程锚点失败，只能作为负例和Provider证据。
- 此前真实交付主要由产品外部Codex编排，不能证明产品Main Agent已经具备同等规划与返修能力。
- 当前Main Agent运行配置为`gpt-5.6-terra + high`；RQ-027目标态为四档生成强度，默认标准档映射Terra Medium。

## 3. 职责边界

| 能力 | 产品Main Agent/系统 | 外部Codex |
|---|---|---|
| 理解意图、选择下一能力、形成与修订计划 | 必须负责 | 不得在验收中代做 |
| 读取Observation并决定Replan/返修范围 | Main Agent与专业Agent Tool | 只实现合同和接线 |
| HumanGate批准 | 真实教师 | 不得模拟成真实签收 |
| 文件、页数、hash、ffprobe、版本与血缘 | 确定性Validator/Guard | 实现和验证 |
| PPT/视频语义与效果审查 | 专业Critic Agent Tool | 实现Rubric与接线 |
| Provider调用与持久化 | 注册Tool、Adapter、Job和Repository | 实现基础设施 |
| 发布结论 | Release Gate与真实用户证据 | 汇总证据，不越权批准 |

产品内编排验收期间，禁止用外部脚本手工选择节点、批准样张、决定返修页/镜头或生成完整包后宣称Main Agent已完成。

## 4. Tool注册边界

Main Agent只接触业务语义稳定、输入输出可审计的高层能力：

- `ppt_director.plan_or_repair`
- `video_director.plan_or_repair`
- `delivery_critic.review`
- `generate_ppt_sample_assets`
- `assemble_ppt_key_samples`
- `generate_ppt_full_assets`
- `assemble_ppt_full_deck`
- `repair_ppt_full_deck_pages`
- `generate_video_assets`
- `generate_video_shot`
- `assemble_video`
- `create_final_package`

Main Agent不得直接接触密钥、Provider URL、数据库写入、Artifact状态提升、`final_eligible`设置或绕过Validator的能力。Validator、PlanGuard、HumanGate、DataRightsGuard和FinalDeliveryGate由系统强制执行，不作为模型可自由选择的工具。

## 5. 分阶段实施

| 阶段 | 目标 | 核心动作 | 退出证据 |
|---|---|---|---|
| V1-0 | 主线微调封板 | 冻结两用户、产品内编排、四档强度与非目标；提交并打接管标签 | 权威计划、测试计划、backlog和主线状态一致 |
| V1-1 | 编排归因审计 | 逐节点标记Main Agent、固定代码、Tool、外部Codex和人工决策归属 | 已实现/外部代做/缺失/重复职责矩阵 |
| V1-2 | Tool与Agent Tool注册 | 冻结可见工具、schema、前置、Observation、副作用和权限 | 注册一致性、真实路由、未知/越权工具稳定拒绝 |
| V1-3 | Main Agent受控ReAct | 串联Plan、Guard、Act、Observation、Replan、预算与停止条件 | Main Agent依据真实Observation改变下一步，不靠固定链冒充 |
| V1-4 | HumanGate与自然语言打断 | 确认、拒绝、暂停、取消、改道、改大纲和局部返修 | actionId、IntentEpoch、影响分析和历史版本正确 |
| V1-5 | 生成强度 | 实施RQ-027四档滑杆、默认标准、升级建议、积分趋势和确认 | 不暴露模型、不静默升级、Sol需要二次确认 |
| V1-6 | PPT内部编排闭环 | 复用现有金样输入，验证大纲、PageSpec、样张、全量、审查和页级返修 | 决策全部来自产品Agent/Tool；Codex不代做 |
| V1-7 | 视频内部编排闭环 | 接入Concept Selection、独立短片三问、课程锚点和Video Critic | 创意失败在昂贵Provider调用前阻断 |
| V1-8 | 两用户并发 | 两账号、两项目、双Agent任务、强度隔离、排队和恢复 | 不串数据、不重复付费、不使用全局串行锁 |
| V1-9 | 产品内真实E2E | 仅在V1-1至V1-8通过后，从产品界面启动一次真实任务 | 产品Main Agent自主产出真实PPTX、MP4和最终包 |
| V1-10 | 发布收口 | 服务器共享卷、重启、回滚、备份恢复、注册关闭、监控和教师签收 | P0=0；两名邀请用户可用；创建新发布标识 |

## 6. 顺序与并行边界

```text
V1-0 -> V1-1 -> V1-2 -> V1-3 -> V1-4 -> V1-5
                                      -> V1-6 -> V1-7 -> V1-8 -> V1-9 -> V1-10
```

V1-6与V1-7只有在共享Tool合同、Observation、HumanGate和版本状态冻结后才能分工推进。热点文件、数据库schema和核心ToolRegistry保持单一集成人。

## 7. 当前不做

- 不继续由外部Codex制作第三套完整验收包。
- 不在产品内编排成立前重复调用真实图片或视频Provider做效果展示。
- 不迁移LangGraph、Vercel AI SDK或其他通用Agent框架作为V1前置。
- 不把模型选择权直接交给模型文本，也不向教师暴露底层模型名。
- 不把两用户目标扩成十用户容量或复杂多租户系统。

## 8. 回退与发布标识

保留现有annotated tag `v1`不动。当前接管提交创建新的annotated tag，表达“V1执行安全和交付质量基线已形成，产品内编排与两用户上线阶段待实施”。后续每阶段通过独立closeout推进，不移动历史标签。
