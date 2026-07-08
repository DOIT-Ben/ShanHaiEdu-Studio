# M51 对话产物展开与前端交互审计阶段规划

日期：2026-07-08

## 目标

在 M50 恢复产物链后，继续修复用户截图指出的前端交互问题，让本地 MVP 的对话工作台更像真实可用产品，而不是静态原型。

本阶段聚焦：

1. 对话里的产物预览卡可展开/收起，在不打开右侧详情时也能查看更多内容。
2. 使用生成的 ShanHaiEdu AI logo 资产替换纯线条占位头像，提高识别度。
3. 右侧产物侧栏拖拽变轻，避免拖动时宽度动画带来的延迟感。
4. 左侧“搜索课题”改成真实输入框，可聚焦、可输入、可筛项目。
5. 侧栏打开后，中间顶部栏和阶段条进入压缩模式，避免被硬挤压或遮挡。
6. 做一轮关键前端按钮可用性审计：能做的必须可点击，未接能力的不能伪装成已完成。

## 范围

预计涉及：

- `src/components/layout/ProjectSidebar.tsx`
- `src/components/layout/MediaWorkbench.tsx`
- `src/components/conversation/ConversationWorkbench.tsx`
- `src/components/conversation/WorkbenchTopbar.tsx`
- `src/components/conversation/StageProgress.tsx`
- `src/components/conversation/ChatTranscript.tsx`
- `src/components/artifacts/ArtifactSidePanel.tsx`
- `src/components/artifacts/ResizableHandle.tsx`
- `public/brand/shanhai-ai-logo.png`
- `public/brand/shanhai-ai-logo-256.png`
- `tests/m51-interaction-polish-and-button-audit.test.mjs`

## 设计

对话内产物卡保留小组件默认态：标题、摘要和最多两个关键字段。点击“展开查看”后，在同一条回复下展开更多字段、正文摘要和上游来源；点击“收起”恢复紧凑态。这个展开只影响对话内查看，不替代右侧产物 rail 和详情侧栏。

logo 资产通过 `imagegen-free` 生成，放入 `public/brand/`。前端使用 256px 压缩版本，避免把大图直接加载到 32px 头像。

侧栏拖拽延迟主要来自 width transition 与拖动中的连续重排。本阶段在拖拽期间禁用宽度动画，只保留打开/关闭时的过渡，同时适当降低默认宽度，让中间区域保留更多空间。

搜索课题使用真实 `<input>`，筛选项目标题、当前步骤和项目 meta。没有结果时显示低噪声空态。

侧栏打开时向中间工作区传入 `compact` 状态。顶部栏隐藏部分面包屑和按钮文字，阶段条只保留活跃步骤文字，其余节点收缩为编号，保证空间不足时优先保留对话。

## 成功标准

- 搜索课题可以点击聚焦、输入文字并筛选项目。
- 对话内产物卡有展开/收起按钮，展开后能查看更多内容。
- ShanHaiEdu AI 头像使用生成资产，而不是纯文字或纯线条图。
- 拖拽侧栏宽度时不再带 300ms width 动画。
- 侧栏打开后顶部栏和阶段条不会挤出容器。
- 关键按钮通过浏览器可用性检查：新建、搜索输入、发送、产物、rail 节点、复制/作为输入；未接能力明确禁用。
- 测试、构建和桌面/窄屏浏览器检查通过。

## 风险与回退

- 生成 logo 可能不完全符合品牌，若后续有正式品牌规范，可替换 `public/brand/shanhai-ai-logo-256.png`，无需改组件合同。
- 搜索只做前端本地筛选，不新增后端搜索 API。
- 侧栏压缩是布局优化，不改变产物数据和后端合同。

