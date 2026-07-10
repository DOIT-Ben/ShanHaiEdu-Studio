# M54-A 前端聊天式工作台持续升级路线

日期：2026-07-08

状态：正式阶段路线 / 部分落地 / 第一档继续收口。

深度开发规格：

- `docs/ui/frontend-workbench/local-real-mvp-m54a-frontend-workbench-deep-spec.md`
- `docs/ui/frontend-workbench/local-real-mvp-m54a-open-items.md`
- `docs/product/frontend-workbench-priority-requirements.md`

## 1. 终极目标

把 ShanHaiEdu 前端从“能展示对话和产物的工作台”升级为“教师愿意真实使用的聊天式备课工作台”。

终局体验：

```text
进入网站
-> 看见清晰品牌和推荐任务
-> 像和模型聊天一样输入或选择
-> 拖入教材、截图或文档
-> 系统流式反馈正在理解
-> 通过快捷选项补齐需求
-> 在对话中展开产物
-> 右侧糖葫芦追踪完整交付链
-> 每步可复制、可反馈、可修改、可确认
```

前端不只是变好看，而是降低教师操作成本，减少“让用户一直打字”的负担，并把后端智能体的结构化判断自然呈现出来。

## 2. 现有能力

已有：

- 三栏工作台：左侧项目，中间对话，右侧产物轨。
- `ProjectSidebar`：项目列表、创建、搜索、折叠。
- `ConversationWorkbench`：对话区、顶部状态、输入框。
- `ChatTranscript`：用户/assistant 消息、内嵌成果卡、快捷回复基础。
- `PromptComposer`：基础多行输入、Enter 发送、文本文件引用。
- `ArtifactRail` / `ArtifactSidePanel` / `ArtifactDetailSheet`：右侧糖葫芦、预览、详情。
- Radix UI primitives：`Popover`、`Dialog`、`Tooltip`、`Select`、`ScrollArea`。
- `lucide-react` 图标和 Tailwind 样式体系。

主要短板：

- 输入框不像成熟聊天产品：附件、拖拽、粘贴截图、模型菜单、自适应高度不足。
- 消息体验偏静态：生成态、hover 操作、反馈入口、快捷下一步还不完整。
- 侧栏功能价值不清晰：部分按钮像占位，搜索与项目管理体验弱。
- 首页缺少首次进入的任务引导和品牌识别。
- 对话内产物卡和右侧产物轨的关系还需更顺滑。
- UI 组件边界还不够细，继续堆在少数文件中会变复杂。

## 3. 设计原则

- 对话是主视觉，产物导航压缩，详情在侧栏或抽屉中打开。
- 低频操作默认隐藏，hover/focus 时出现，保证键盘可达。
- 不做营销页，不做大渐变，不做卡片套卡片。
- 教师界面不出现工程词，如 schema、provider、API、node_id、debug、storage。
- quick replies 只填入输入框或更新草稿，不自动发送。
- 附件如果未完成真实后端解析，必须显示准确状态，不伪装成已理解。
- 右侧糖葫芦不能下架；窄屏时转成小组件或抽屉。

## 4. 组件化路线

### 4.1 布局层

保留并逐步整理：

- `src/components/layout/MediaWorkbench.tsx`
- `src/components/layout/ProjectSidebar.tsx`
- `src/components/conversation/ConversationWorkbench.tsx`

新增或拆分：

- `src/components/layout/WorkbenchShell.tsx`
  - 负责桌面三栏、窄屏抽屉、右侧产物区域压缩策略。
- `src/components/layout/ProfileMenu.tsx`
  - 左下角头像菜单：账号、设置、反馈、退出。
- `src/components/conversation/WelcomeEmptyState.tsx`
  - 首次进入样子：logo、欢迎语、高频任务入口、最近活动。

### 4.2 输入框层

保留 `PromptComposer` 作为容器，拆出：

- `src/components/conversation/composer/ComposerToolbar.tsx`
  - 加号、模型选择、上传材料、Web Search、清空等入口。
- `src/components/conversation/composer/ComposerAttachmentMenu.tsx`
  - md、txt、pdf、docx、图片、截图入口。
- `src/components/conversation/composer/ComposerModelMenu.tsx`
  - 本地模式、真实模型、演示模式等显示和切换。
- `src/components/conversation/composer/ComposerFileDropzone.tsx`
  - 拖拽文件进入输入框时的覆盖态。
- `src/components/conversation/composer/ComposerAttachmentPreview.tsx`
  - 文件卡、类型、大小、解析状态、删除。
- `src/components/conversation/composer/useAutoResizeTextarea.ts`
  - 输入框随内容增长，高度到阈值后内部滚动。
- `src/components/conversation/composer/useComposerAttachments.ts`
  - 统一处理拖拽、粘贴、文件选择和附件状态。

### 4.3 消息层

拆出：

- `src/components/conversation/messages/MessageActions.tsx`
  - 复制、反馈、展开、重新生成等 hover/focus 操作。
- `src/components/conversation/messages/FeedbackDialog.tsx`
  - 点赞/点踩后收集原因。
- `src/components/conversation/messages/GeneratingIndicator.tsx`
  - 正在理解、正在生成、正在整理材料等状态。
- `src/components/conversation/messages/QuickReplySuggestions.tsx`
  - 每条 assistant 回复下 2-3 个下一步建议。
- `src/components/conversation/messages/InlineArtifactCard.tsx`
  - 对话内可展开成果卡，只呈现教师可理解内容。

### 4.4 产物层

保留：

- `ArtifactRail`
- `ArtifactPreviewCard`
- `ArtifactSidePanel`
- `ArtifactDetailSheet`

调整重点：

- 右侧节点默认紧凑，点击打开详情。
- 有详情面板时不再显示 hover preview，避免遮挡。
- 产物节点必须支持复制、作为输入、确认、重做。
- 窄屏下产物轨转成底部入口或抽屉，不能消失。

## 5. 复用与不造轮子

继续复用：

- Radix `Popover`：加号菜单、模型菜单。
- Radix `Dialog` / 当前 `Sheet`：反馈弹窗、移动端抽屉。
- Radix `Tooltip`：复制、上传、模型等 icon tooltip。
- Radix `Select`：模型选择。
- Radix `ScrollArea`：侧栏与对话滚动。
- `lucide-react`：所有工具按钮图标。
- 原生 Drag and Drop API：拖拽附件。
- Clipboard API：粘贴截图。
- Playwright：浏览器交互验收。

暂不引入：

- 新 UI 框架。
- 大型聊天 SDK。
- 复杂动画库。
- 纯装饰图片堆砌。

后续可评估：

- `react-markdown` 或成熟 Markdown renderer，如果现有 `MarkdownPreview` 支撑不了复杂列表和表格。
- 文件图标或轻量 mime 判断库，但优先用浏览器原生 `File.type` 与扩展名。

## 6. 多阶段拆分

### M54-A1 输入框与发送基础

目标：让发送行为可靠，输入体验接近成熟聊天产品。

范围：

- Enter 发送，Shift+Enter 换行。
- 发送后立即清空或显示 near-field 状态。
- 回复后自动滚动到底部。
- 输入框自适应高度。
- 发送中禁用重复提交。

验收：

- 浏览器实测 Enter、Shift+Enter、连续发送、滚动到底。
- 单元测试覆盖 textarea 自适应 hook。

### M54-A2 Composer 工具栏与附件前端

目标：让上传入口、模型入口、拖拽和粘贴截图可见可用。

范围：

- `ComposerToolbar`
- `ComposerAttachmentMenu`
- `ComposerFileDropzone`
- `ComposerAttachmentPreview`
- `useComposerAttachments`

验收：

- 拖入文件时显示覆盖态。
- 松手后出现附件卡。
- 粘贴截图后出现图片附件卡。
- md、txt、pdf、docx、图片入口文案准确。
- 未后端解析时显示“待解析”或“上传后解析”，不说已理解。

### M54-A3 消息操作与生成态

目标：让对话回复像真实 AI 产品，有反馈、有复制、有漂亮等待态。

范围：

- `GeneratingIndicator`
- `MessageActions`
- `FeedbackDialog`
- copy tooltip 和 toast / near-field notice。

验收：

- assistant 回复生成中有稳定动效。
- hover assistant 回复显示复制、反馈。
- 复制成功有反馈。
- 点赞/点踩弹出反馈框。

### M54-A4 Quick replies 与槽位卡前端

目标：把后端智能体的结构化推荐选项展示为低噪声 chips。

范围：

- `QuickReplySuggestions`
- 槽位确认卡 UI。
- 点击选项填入输入框或更新草稿。

验收：

- 普通聊天也可给轻量建议，但不出现产物链。
- 模糊备课需求出现槽位 chips。
- 明确需求出现确认卡。
- 点击 chips 不自动发送。

### M54-A5 左侧栏、首页与头像菜单

目标：让第一次进入和日常项目管理有明确价值。

范围：

- `WelcomeEmptyState`
- `ProfileMenu`
- 项目搜索聚焦。
- 项目归档、删除、置顶等功能未接入时隐藏或降级。
- 左侧展开/收起 polish。

验收：

- 首屏不是空白，也不是营销页。
- 头像点击有菜单。
- 搜索框可输入。
- 无价值按钮不占主要视觉。

### M54-A6 右侧产物轨与响应式

目标：右侧糖葫芦稳定存在，宽屏展开，窄屏压缩。

范围：

- 右侧宽度策略。
- 面板 resize 性能。
- 窄屏抽屉或底部小组件。

验收：

- 桌面三栏可见。
- 窄屏产物入口仍可访问。
- 拖动右侧边栏无明显卡顿。
- 详情打开时 hover preview 不遮挡。

## 7. 与后端主线的接口

前端依赖后端输出 `ConversationDecisionV2`：

```ts
type ConversationDecisionV2 = {
  intent: string;
  assistantMessage: {
    title?: string;
    body: string;
  };
  slots: RequirementSlots;
  missingSlots: string[];
  recommendedOptions: RecommendedOption[];
  quickReplies: QuickReply[];
  nextAction: string;
  shouldGenerateArtifact: boolean;
};
```

前端不自己判断复杂业务意图，只负责：

- 渲染后端给出的消息。
- 渲染推荐 chips。
- 提交用户选择。
- 展示附件解析状态。
- 展示产物和工作流状态。

## 8. 测试与验收矩阵

基础命令：

```text
npm test
npm run build
git diff --check
```

浏览器验收：

- 桌面 1440px。
- 窄屏移动宽度。
- 左侧展开/收起。
- 右侧产物轨展开/收起。
- 输入框 Enter/Shift+Enter。
- 拖拽文件。
- 粘贴截图。
- 发送后滚到底部。
- hover message actions。
- feedback dialog。
- quick reply 填入输入框。

红线扫描：

- 普通教师界面不得出现工程词。
- 未接真实上传解析时不得暗示已解析。
- 未生成真实产物时不得出现“已完成交付”。

## 9. 并行协作方式

前端主线可以和后端主线并行，但必须先共享 `ConversationDecisionV2` 合同。

推荐并行：

- 前端先用 fixture/mock `ConversationDecisionV2` 开发 UI。
- 后端实现真实 `ConversationDecisionV2`。
- 集成阶段替换数据源，不重写 UI。

## 10. 风险与回退

- 风险：UI 做得太花，违背教师工作台低噪声原则。
  - 回退：保留白底、细边框、少色彩、低频按钮 hover 出现。
- 风险：组件拆太细但没有清晰合同。
  - 回退：只拆输入框、消息、附件、侧栏四个稳定边界。
- 风险：附件前端先行让用户误解为已解析。
  - 回退：所有附件卡必须显示解析状态。
- 风险：quick replies 过度主动。
  - 回退：所有 chips 只填输入框，不自动发送。

## 11. 最近下一步

先完成上线门槛反馈中心，再继续 M54-A 第一档收口：

1. 完成 `docs\stages\local-real-mvp-beta-feedback-center-plan.md`：真实保存、分类提示、截图粘贴和受控查看。
2. 收口首次欢迎态、头像菜单和全局反馈入口。
3. 完成附件拖入、图片粘贴、PDF/DOCX/图片真实状态。
4. 完成模型/工具菜单并清理未接假入口。
5. 修普通聊天/业务任务分流和自然语言确认改道。
6. 完成真实流式回复、响应式和最终浏览器验收。
