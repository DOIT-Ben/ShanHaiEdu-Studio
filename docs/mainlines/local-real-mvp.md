# Local Real MVP 主线规划

日期：2026-07-07

## 1. 主线目标

让 ShanHaiEdu Studio 在本机成为真实可用的公开课材料生产 MVP。

教师应能完成：

```text
新建项目
-> 对话输入一句话需求
-> 系统澄清并生成需求规格
-> 生成教材证据或教材说明
-> 生成教案
-> 生成 PPT 大纲与逐页脚本
-> 生成导入视频方案
-> 确认、重做、查看、复制和复用节点产物
-> 汇总最终交付包
```

MVP 可以先使用确定性运行时和文本产物，但不得把未接入的真实 PPTX、图片、视频能力伪装为已完成。

## 2. 当前基线

已经进入 `main` 的能力：

- Next.js 工作台前端。
- 项目、消息、节点、产物、确认、重做、AgentRun 的后端持久化骨架。
- API-backed 前端数据源。
- `DeterministicRuntime`。
- 服务端 `OpenAIRuntime` 边界。
- Stage 2 E2E preflight。
- 总测试入口 `npm test`。

## 3. 第一性原理判断

本阶段不是继续扩写架构，而是证明教师能用它连续生产一节课的材料。

最小成功标准：

- 教师不需要知道工程词。
- 刷新后项目状态不丢。
- 每个节点产物都能查看、复制、复用、确认或重做。
- 上游变更后下游状态可解释。
- deterministic 模式和真实模型模式边界清晰。
- 未接入真实 provider 的节点明确显示为开发态或待接入。

## 4. 可复用资产

优先复用：

- `src\server\workbench\service.ts`
- `src\server\workbench\repository.ts`
- `src\server\agent-runtime\`
- `src\lib\workbench-api.ts`
- `src\lib\workbench-mappers.ts`
- `src\hooks\useWorkbenchController.ts`
- `tests\workbench-api.test.mjs`
- `src\server\workbench\__tests__\`
- `tests\e2e\`
- 私有 API 台账压缩包仅作为能力目录，不在代码、文档和日志中泄露密钥。

不优先自研：

- 不重写 UI kit。
- 不绕过后端直接在 React 里调模型 SDK。
- 不在前端硬编码工作流状态真源。
- 不引入复杂队列，除非真实长任务已成为阶段阻塞。

## 5. 阶段拆分

### 当前主线治理状态

2026-07-08 已重新核对本地与远程分支：

- 当前唯一开发分支：`mainline/local-real-mvp`。
- 当前唯一开发工作区：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\local-real-mvp-mainline`。
- `main`、`integration/unified-mainline` 和 4 条 `feature/mvp-*` 历史支线均已成为 `mainline/local-real-mvp` 的祖先。
- 旧支线 worktree 和远程分支保留为追溯来源，不再作为开发入口。
- 本地 `mainline/local-real-mvp` 当前领先远程 `origin/mainline/local-real-mvp`，提交前后必须重新核对 `git status --short --branch`。

从 M54 起，长期能力建设分为两条并行子主线，但都归属于同一 Git 主线：

| 子主线 | 路线文档 | 目标 |
| --- | --- | --- |
| 前端聊天式工作台 | `docs\stages\local-real-mvp-m54a-frontend-workbench-roadmap.md` | 输入、消息、附件、反馈、侧栏、产物轨体验升级 |
| 后端对话智能体 | `docs\stages\local-real-mvp-m54b-agentic-conversation-roadmap.md` | 意图识别、需求槽位、quick replies、PromptPack、评测与 checkpoint |

并行开发规则：

- 两条子主线可以拆任务并行，但共享 `ConversationDecisionV2` 合同。
- 所有代码、文档、测试最终都提交回 `mainline/local-real-mvp`。
- 不再从旧 feature 分支继续追加新功能。
- 如需临时分支，只能从 `mainline/local-real-mvp` 当前 HEAD 创建，完成后合回本主线。

### M0：主线基线确认

目标：

- 确认 `mainline/local-real-mvp` 从最新 `main` 开出。
- 确认旧并行支线已进入历史状态。
- 确认本主线文档和 README 是后续唯一入口。

验收：

- `git status --short --branch`
- `npm test`
- `npm run build`
- `npm run test:e2e:stage2:preflight`

### M1：浏览器真实 MVP 闭环

目标：

- 本地浏览器打开工作台。
- 新建项目。
- 输入一句话需求。
- 生成需求规格 artifact。
- 右侧节点显示真实产物。
- 确认产物。
- 刷新后状态恢复。

验收：

- Playwright 或浏览器实测记录。
- 普通教师界面无工程词。
- 失败恢复文案可理解。

### M2：需求规格到教案文本闭环

目标：

- 使用已确认需求规格作为输入。
- 生成教材说明或教材证据占位说明。
- 生成教案 Markdown。
- 支持确认、重做和复制。

验收：

- 后端保存节点版本。
- 前端可查看完整 Markdown。
- 上游重做后下游标记需重审。

### M3：PPT 大纲与逐页脚本

目标：

- 根据教案生成 PPT 大纲。
- 输出页数、页面类型、逐页脚本、主视觉需求。
- 前端可预览、复制、确认。

验收：

- 不生成假 PPTX。
- 明确区分“PPT 大纲”和“PPTX 文件”。

### M4：导入视频方案文本闭环

目标：

- 生成独立导入视频策划卡。
- 视频只通过课程锚点回接本课，不提前讲知识点。
- 支持多候选方案和确认。

验收：

- 输出包含独立主题、开场钩子、吸睛点、课程锚点、课堂落点问题。
- 产物可作为后续视频分镜输入。

### M5：最终交付包 Markdown

目标：

- 汇总已确认需求、教案、PPT 大纲、导入视频方案。
- 输出最终交付清单和过程摘要。
- 支持下载或复制 Markdown。

验收：

- 缺失节点明确提示。
- 不把未完成产物包装为完成。

### M6：真实 OpenAI smoke

目标：

- 在服务端 Runtime Adapter 层接入真实 OpenAI smoke。
- 不让 SDK 进入 React。
- 保留 deterministic fallback。

验收：

- 有环境变量缺失时的可理解错误。
- 有真实请求成功证据时再标记真实模型可用。
- 不打印密钥。

### M7：1-2 人本地并发验证

目标：

- 验证两个项目隔离。
- 验证两个本地用户或浏览器上下文不会串数据。

验收：

- 项目、消息、产物、节点状态隔离。
- SQLite 能支撑 MVP 试用；若成为瓶颈，记录迁移 PostgreSQL 条件。

## 6. 非目标

- 本主线第一阶段不做生产部署。
- 不做完整账号系统。
- 不做真实 PPTX、图片、视频全量生产，除非文本闭环已稳定。
- 不做复杂多智能体并行调度。
- 不删除旧 worktree 或远端分支，除非用户单独确认。

## 7. 推荐第一阶段任务

从 M0 开始：

1. 读本文件、`AGENTS.md`、`docs\stages\unified-mainline-integration-report.md`。
2. 跑 `npm test`、`npm run build`、`npm run test:e2e:stage2:preflight`。
3. 写 `docs\stages\local-real-mvp-m0-baseline-report.md`。
4. 若通过，提交 M0 基线报告。
5. 再进入 M1 浏览器真实闭环。
