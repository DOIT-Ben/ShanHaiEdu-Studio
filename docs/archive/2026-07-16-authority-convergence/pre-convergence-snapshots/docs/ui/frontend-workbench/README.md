# 前端 UI 工作台主线文档索引

日期：2026-07-08

用途：沉淀 ShanHaiEdu 前端聊天式工作台、UI 设计、交互美化、组件拆分、踩坑记录和验收标准。后续凡是工作台 UI 优化、设计复用、体验问题复盘，都优先从本目录查。

## 当前正式文档

| 文档 | 用途 |
| --- | --- |
| `local-real-mvp-m54a-frontend-workbench-roadmap.md` | M54-A 前端聊天式工作台持续升级路线，定义阶段方向和组件化路线。 |
| `local-real-mvp-m54a-frontend-workbench-deep-spec.md` | 图像参考驱动的深度开发规格，沉淀参考图、交互状态、组件边界和验收矩阵。 |
| `local-real-mvp-m54a-frontend-workbench-test-plan.md` | M54-A0 测试定义，把参考图和工作台体验要求转成合同测试与浏览器验收。 |
| `local-real-mvp-m54a-open-items.md` | 当前代码已落地能力和第一档待完成项，以实际代码证据校准 M54-A。 |
| `2026-07-15-frontend-demo-design-absorption.md` | 新 Demo 优秀布局、反馈、模式切换、动效和成果工作区的正式吸收规范，同时列明不得进入主线的硬伤。 |

产品需求入口：

- `docs\product\beta-feedback-requirements.md`
- `docs\product\frontend-workbench-priority-requirements.md`

## 历史 UI 阶段沉淀

历史 UI/体验阶段文档统一放在 `stage-history/`，用于回看已经踩过的坑、阶段验收证据和可复用设计判断。

| 范围 | 文档 |
| --- | --- |
| 早期前端打磨 | `stage-history/frontend-polish-v0.3.9.md` |
| M44 API 默认运行态 UI | `stage-history/local-real-mvp-m44-api-default-runtime-ui-*.md` |
| M45 聊天意图与顶栏 | `stage-history/local-real-mvp-m45-chat-intent-and-topbar-*.md` |
| M47 Composer API 接线 | `stage-history/local-real-mvp-m47-composer-api-wiring-*.md` |
| M48 Chat-first 对话 UI | `stage-history/local-real-mvp-m48-chat-first-conversation-ui-*.md` |
| M49 滚动与体验细节 | `stage-history/local-real-mvp-m49-chat-scroll-and-delight-*.md` |
| M50 产物轨与 Markdown 预览 | `stage-history/local-real-mvp-m50-artifact-rail-markdown-preview-*.md` |
| M51 交互打磨与按钮审计 | `stage-history/local-real-mvp-m51-interaction-polish-and-button-audit-*.md` |
| M52 半自动对话门与选项 | `stage-history/local-real-mvp-m52-semi-auto-conversation-gate-*.md` |
| M53 教师视角确认与成果阅读 | `stage-history/local-real-mvp-m53-teacher-facing-confirmation-and-reading-*.md` |

## 后续应放入本目录的文档

- M54-A 前端测试定义。
- M54-A 开发收口报告。
- 工作台视觉规范。
- Logo 与品牌资产规范。
- 聊天消息、输入区、附件、糖葫芦和侧栏组件规范。
- UI 走查报告、浏览器截图验收记录、避坑复盘。

## 归档策略

- 本目录保存 UI 主线仍有复用价值的规划、规格、测试和复盘。
- `docs/stages` 只保留跨主线阶段报告或非 UI 专项阶段材料。
- 新 UI 文档默认进入本目录；只有跨主线总报告继续放 `docs/stages`。
