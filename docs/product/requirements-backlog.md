# ShanHaiEdu 需求总账

更新时间：2026-07-10

> 本文件记录未完成需求、新增需求、延期需求和优先级。当前产品质量门禁仍以 `docs\product\current-requirements-baseline.md` 为最高产品口径；本文件负责把“还没做完、刚发现、需要拆分”的需求集中管理。

## 1. 状态定义

| 状态 | 含义 |
|---|---|
| `accepted` | 已接受，进入后续阶段规划 |
| `split` | 已接受但必须拆成多个阶段 |
| `deferred` | 暂缓，等待前置条件 |
| `blocked` | 被技术、资源或产品边界阻塞 |
| `done` | 已完成并有 closeout / 验收证据 |

优先级分档：

```text
上线门槛：邀请内测用户前必须完成
第一档：内测阶段优先收口
第二档：完成一轮内测后再评估，现阶段不实现
```

## 2. 上线门槛

### RQ-008 内测反馈中心

- 状态：`accepted`
- 来源：2026-07-10 上线前新增需求。
- 问题：当前点赞/点踩只显示“反馈入口暂未开放”，没有真实保存；用户也不能直接粘贴截图。
- 目标：上线内测前提供引导式反馈中心，支持分类、预制提示、文字描述、图片选择和剪贴板图片粘贴，并保存到服务端持久化位置。
- 必须分类：页面/视觉、功能异常、内容结果、操作不清楚、功能建议、性能问题、其他。
- 验收：
  - 任意主要工作台页面都能打开反馈入口。
  - 支持 `Ctrl+V` / `Cmd+V` 直接粘贴截图，并显示预览、删除和错误提示。
  - 反馈元数据保存到数据库，图片保存到配置化持久化存储；刷新后仍存在。
  - 提交成功返回反馈编号；失败保留描述和图片，可重试。
  - 公网内测使用密码认证和邀请制账号；普通教师不能读取他人反馈，管理员可受控查看和导出。
- 需求文档：`docs\product\beta-feedback-requirements.md`。
- 阶段与测试：`docs\stages\local-real-mvp-beta-feedback-center-plan.md`、`docs\stages\local-real-mvp-beta-feedback-center-test-plan.md`。
- 建议阶段：下一开发阶段，先于邀请内测用户。

## 3. 第一档需求

### RQ-009 M54-A 前端聊天式工作台未完成项

- 状态：`split`
- 来源：用户页面参考图及 M54-A 正式规格、路线和测试计划。
- 已有基础：自动滚动、输入框自适应、生成提示、快捷回复、消息操作、Logo、糖葫芦交付链、Markdown 阅读。
- 未完成重点：首次欢迎态、头像菜单、完整附件拖放与截图粘贴、PDF/DOCX/图片真实状态、模型/工具菜单、真实反馈弹窗、真实流式回复、响应式收口。
- 当前决策：作为第一档规划；反馈中心先做，其他项按切片逐步收口。
- 需求文档：`docs\product\frontend-workbench-priority-requirements.md`。
- UI 状态：`docs\ui\frontend-workbench\local-real-mvp-m54a-open-items.md`。

## 4. 核心产品与交互需求

### RQ-001 自然语言确认与改道执行

- 状态：`accepted`
- 来源：2026-07-10 截图反馈；用户输入“直接开始做视频”但系统回复“没有有效确认”。
- 问题：当前系统只承认按钮传入的 `confirmedActionId`，不承认教师自然语言确认或改道。
- 目标：用户不点推荐按钮，也能通过自然语言确认当前计划、切换任务或请求继续执行。
- 验收：
  - 用户输入“直接开始做视频”时，不再回复“我还没有拿到这一步的有效确认”。
  - 如果视频前置材料不足，系统明确说明缺哪些材料，并给出下一步建议。
  - 如果请求涉及真实 provider 或高风险动作，仍需 HumanGate。
- 建议阶段：反馈中心后优先实施。

### RQ-002 视频结构化前置链路补齐

- 状态：`split`
- 来源：`current-requirements-baseline.md` 视频交付门禁。
- 问题：视频生成前必须有主题、脚本、资产图、分镜提示词、镜头时长、画面动作、旁白或字幕、课堂边界约束；当前链路仍未完全可真实执行。
- 目标：形成可被真实视频 provider 使用的结构化前置产物。
- 验收：
  - 能按顺序生成并确认知识锚点、创意主题、视频脚本、分镜、资产 brief、资产图、片段计划。
  - 缺前置材料时不调用真实视频 provider。
- 建议阶段：`M67-M69`。

### RQ-003 PPTX 真实交付与 slideCount 门禁持续验收

- 状态：`accepted`
- 来源：`current-requirements-baseline.md` PPTX 真实交付门禁。
- 问题：PPTX 不能用文本 fallback、目标页数或文件名冒充真实交付。
- 目标：PPTX 必须是真实 zip、包含 `ppt/presentation.xml`，且真实 slideCount 等于目标页数。
- 验收：
  - 不合格 PPTX 不保存为真实完成态。
  - 下载按钮和状态来自真实校验结果。
- 建议阶段：作为每次 provider / final package 阶段的回归门禁。

### RQ-004 断点续跑与单项目生成锁

- 状态：`accepted`
- 来源：`current-requirements-baseline.md` 断点续跑与并发门禁。
- 问题：失败节点不能卡死整个项目；同一项目不能并发多个生成任务。
- 目标：失败保留可重试状态；队列和锁由后端控制，前端禁用只做体验优化。
- 验收：
  - 失败节点能继续、重试或改道。
  - 快速重复点击、跨标签页、多项目并发不会写乱状态。

## 5. 架构后续需求

### RQ-005 OpenAIRuntime native tool loop 主线接入

- 状态：`deferred`
- 来源：M65/M66 runtime tool loop 规划。
- 问题：M65 已完成协议层和 `OpenAIRuntime` 可选接线，但尚未进入主链路。
- 目标：通过显式环境开关、单工具 allowlist、server-authoritative mapper 和无递归 `toolExecutionRuntime` 安全接入。
- 当前决策：先处理 RQ-001 的自然语言确认与改道，再继续主线接入。
- 关联文档：`docs\stages\local-real-mvp-m66-runtime-tool-loop-mainline-plan.md`。

### RQ-006 文档结构治理

- 状态：`accepted`
- 来源：2026-07-10 用户要求“需求、架构、主线、阶段开发分开”。
- 问题：历史阶段文档数量多，需求、架构、主线和阶段验收口径混杂。
- 目标：建立文档入口、需求总账、交互需求、架构 README、主线状态，不急于批量移动旧文件。
- 验收：
  - `docs\README.md` 清楚说明目录职责和权威级别。
  - `AGENTS.md` 写明项目文档结构规则。
  - 新增需求先进入需求总账，再进入阶段计划。
- 完成条件：补齐 `docs\stages\local-real-mvp-m66-doc-governance-and-interaction-closeout.md` 并完成文档一致性复审后再改为 `done`。

## 6. 第二档需求

### RQ-010 竞品研究衍生能力

- 状态：`deferred`
- 来源：MagicSchool 与 Canva for Education 深度分析及横向汇总。
- 候选方向：Studio 式产物编辑、资源库、PPT/视频共享资产池、模板与教育素材、教师审核与版本、课堂分享和 LMS 集成。
- 当前决策：放入第二档，现阶段不实现；完成反馈中心、第一档 UI 收口和一轮真实内测后再按反馈决定取舍。
- 需求文档：`docs\product\competitor-derived-second-tier-requirements.md`。

## 7. 文档与历史治理需求

### RQ-007 旧阶段文档归档

- 状态：`deferred`
- 问题：`docs\stages\` 历史文件很多，但仍有审计和追溯价值。
- 决策：暂不移动、不删除；后续单独做归档计划，先查引用和历史作用。
