# V1 Agent 与交付质量专题资料入口

迁入日期：2026-07-12；当前执行口径更新：2026-07-13

## 1. 定位

本目录汇总 ShanHaiEdu V1 的 Agent 架构审计、PPT/视频交付工艺设计、节点合同、提示词、官方来源和真实 API 实验依据。资料最初在桌面三个独立目录中形成，现已纳入项目文档体系，供后续 V1 规划、实施和验收直接读取。

本专题不是新的产品需求最高口径。发生冲突时仍按以下顺序执行：

```text
AGENTS.md
  > docs\product\current-requirements-baseline.md
  > docs\product\requirements-backlog.md
  > docs\architecture\README.md 与已接受 ADR
  > 本专题中的候选设计、审计和实验资料
```

三个子目录保留原始目录名和内容结构，因此原包之间的相对链接仍可使用。原文中“位于桌面”“独立于项目”等描述属于迁入前审计快照，不代表当前存放位置。

## 2. 目录

| 目录 | 作用 | 推荐入口 |
|---|---|---|
| [ShanHaiEdu-Agent架构审计资料库-20260711](./ShanHaiEdu-Agent架构审计资料库-20260711/README.md) | 当前 Runtime、框架适配、第一性原理缺口、V1 计划和交接审计 | `07-快速上线V1实施计划与职责分工.md` |
| [ShanHaiEdu-智能体与交付工艺架构设计-20260711](./ShanHaiEdu-智能体与交付工艺架构设计-20260711/README.md) | 三层架构、受控 ReAct、PPT/视频工艺、职责边界和代码接入映射 | `06-现有架构接入映射与实施顺序.md` |
| [ShanHaiEdu-交付效果工作流优化-2026-07-11](./ShanHaiEdu-交付效果工作流优化-2026-07-11/README.md) | Contracts、Prompts、实验、独立审查和官方研究来源 | `03-A+-总体工作流设计.md` |

## 3. 建议阅读顺序

1. 当前唯一续接入口：`docs\handoffs\2026-07-13-v1-main-agent-mainline-handoff.md`。
2. 当前正式执行计划：`docs\stages\local-real-v1-mainline-adjustment-plan.md`与对应test-plan。
3. 项目当前事实：`docs\mainlines\current-mainline-status.md`。
4. [快速上线 V1 历史设计来源](./ShanHaiEdu-Agent架构审计资料库-20260711/07-快速上线V1实施计划与职责分工.md)。
5. [现有架构接入映射与实施顺序](./ShanHaiEdu-智能体与交付工艺架构设计-20260711/06-现有架构接入映射与实施顺序.md)。
6. [PPT 生产工艺](./ShanHaiEdu-智能体与交付工艺架构设计-20260711/03-PPT生产工艺与质量架构.md)。
7. [视频生产工艺](./ShanHaiEdu-智能体与交付工艺架构设计-20260711/04-视频生产工艺与质量架构.md)。
8. [节点合同、量表和提示词草案](./ShanHaiEdu-智能体与交付工艺架构设计-20260711/08-节点合同-质量量表-提示词草案.md)。
9. [真实 API 实验与官方来源](./ShanHaiEdu-交付效果工作流优化-2026-07-11/README.md)。

旧资料中若出现“课程锚点先于独立创意”“小学课堂角色是默认故事世界”“继续完成三套真实任务”等口径，均已被2026-07-13产品基线与V1主线替代，只能作为历史设计证据。

## 4. 实施边界

- Main Agent 负责理解教师、规划、调用工具和 Replan，不把所有节点固定成单向流水线。
- Skill 保存方法论，Contract/Rubric 保存硬约束，Tool 保存可执行能力，Artifact/Job/Report 保存业务事实。
- V1 优先闭环执行安全、PPT Quality、视频 Full Intro 和最终交付，不以框架迁移作为质量前置。
- `ConversationControlResolver` 只处理确认、取消、修改和改道控制语义，不扩张成第二个 Planner。
- Fast/Short 产物只能是 preview；真实最终包必须经过 Artifact Truth、QualityDecision 和 FinalDeliveryGate。
- 真实媒体调用前，课程锚点必须由产品内独立`delivery_critic.review`审查；Critic通过只是后续Guard的必要语义前置，不独立授权Provider调用。
- 真实MP4组装后必须再由产品内独立`delivery_critic.review(domain="video", stage="video_final_review")`读取成片、字幕/转写、采样帧、音轨和时间线证据，防止独立创意与最小课程锚点在生成中漂移；返修定位到shot或时间范围。
- V1-1至V1-8优先使用夹具、失败注入和持久化状态验证产品内编排，不反复生成真实媒体整包；V1-9才从产品界面执行一次产品内真实E2E。
- V1-9运行中外部Codex只观察，不选案、不批准锚点或样张、不决定返修；产品Main Agent独立成包后，外部验收者再做PPT、视频、课程锚点和版本一致性的黑盒审核。
- 外部黑盒审核只生成只读`ExternalAcceptanceReport`，用于定位Agent、Tool、Prompt、Rubric或Gate责任层；不得把外部判断回写成产品Main Agent能力证据。
- “面向小学生”只约束可理解性、安全性和节奏。儿童、教师或教室可以服务独立叙事，但不得由受众身份强制推出；必须阻塞的是教材/PPT复刻、依赖课堂教学任务才能成立的活动脚本和答案泄露。

## 5. 实验与安全

- `experiments\` 包含约 11MB 的图片、视频、原始输出和脱敏响应，用于支撑质量结论，不是产品运行资产。
- 迁入前已对 JSON 进行结构化敏感字段扫描；未发现 API key、访问令牌、密码或 Authorization 值。
- 原始 Provider 响应、图片和视频不得被产品代码直接读取或作为默认 fixture。
- `delivery-manifest.json` 是原独立包生成时的历史清单；项目迁入完整性以本目录的 `migration-manifest.json` 为准。

## 6. 来源保留与回退

桌面三个原始目录当前仍保留，作为迁移回退副本。本轮没有删除来源；确认项目内版本稳定后，如需删除桌面副本，必须另行授权。
