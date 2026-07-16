# Agent Runtime Stage 3 Plan

日期：2026-07-07

## 1. 第一性原理：本阶段核心需求

Stage 1 和 Stage 2 已证明 runtime 合同可替换、deterministic 可跑、OpenAI 服务端边界可测。Stage 3 要补齐“教师可审结构”：每个文本节点不能只是一段 Markdown，而要包含该节点应有的核心教学字段和轻量自检清单，便于后端保存后让前端展示、复制、确认和重做。

成功标准：

- deterministic 输出的每个 MVP 文本节点都有 `## 自检清单`。
- 每类节点包含自己的关键字段，不用一个通用模板糊过去。
- OpenAI request 中带任务级写作要求和自检要求。
- 输出继续保持 Markdown-first，不生成 PPTX、图片文件或视频成片，不伪装高成本文件完成。

## 2. 可复用方案调研

项目需求基线 `REQUIREMENTS_DECISION_V1.md` 已定义各节点必备内容：

- 需求规格：项目概述、用户目标、教材信息、交付范围、质量约束、后续节点输入说明。
- 教材证据：教材版本、页码或页段、知识点、关键例题或情境、依据摘要、与教学目标关系。
- 教案：教材依据、教学目标、教学重点、教学难点、教学流程、导入设计、学生活动、板书设计、课堂总结、教师讲稿要点。
- PPT 规划：建议页数、页面类型配比、逐页脚本、每页教学目标、学生活动、主视觉需求。
- 导入视频：独立主题、开场钩子、课程锚点、课堂落点问题、脚本、分镜摘要、图片提示词、旁白建议。
- 最终交付：汇总所有已完成产物，并明确未真实生成的文件能力。

复用方式：

- 继续复用 Stage 1 的 deterministic templates。
- 将节点质量要求抽成 `task-guidance.ts`，同时给 deterministic 和 OpenAI request builder 使用。

## 3. 复用、适配与必要自研

复用：

- 复用已有 runtime 合同和测试框架。
- 复用需求基线里的节点字段。

适配：

- deterministic runtime 在每个节点追加任务级自检清单。
- OpenAI request 增加 task guidance，约束真实模型输出结构。

必要自研：

- `task-guidance.ts`：集中维护任务标签、必备字段和自检项。

## 4. 验证标准

- `tests\agent-runtime\runtime-quality.test.ts` 新增失败优先测试。
- 全量 runtime tests 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
