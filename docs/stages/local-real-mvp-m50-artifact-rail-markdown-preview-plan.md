# M50 产物链与 Markdown 对话预览阶段规划

日期：2026-07-08

## 目标

修复 M49 后的对话工作台体验回归，让本地真实 MVP 重新具备“对话为主、右侧线性产物链为辅助、详情可读可复用”的工作台结构。

本阶段收口四件事：

1. 恢复桌面端右侧常驻线性产物 rail，即用户反馈的“糖葫芦串”。
2. 在 AI 回复中展示产物生成后的轻量预览，让生成结果不只藏在右侧侧栏。
3. 让产物详情中的 Markdown 正常渲染标题、列表和段落，不再把 `##`、`-` 当普通文本堆在一起。
4. 统一产物 rail、侧栏和详情 sheet 的视觉语气，使它们跟当前 ShanHaiEdu AI 对话气泡一致。

## 范围

涉及文件预计为：

- `src/components/layout/MediaWorkbench.tsx`
- `src/components/conversation/ConversationWorkbench.tsx`
- `src/components/conversation/ChatTranscript.tsx`
- `src/components/artifacts/ArtifactRail.tsx`
- `src/components/artifacts/ArtifactSidePanel.tsx`
- `src/components/artifacts/ArtifactDetailSheet.tsx`
- `src/components/artifacts/MarkdownPreview.tsx`
- `src/lib/types.ts`
- `tests/m48-chat-first-ui.test.mjs`
- `tests/m50-artifact-rail-markdown-preview.test.mjs`

## 设计

桌面布局恢复三层结构：左侧项目，中间对话，右侧压缩产物 rail。右 rail 只作为线性导航和 hover 预览入口；点击节点打开侧栏，侧栏打开时禁用 hover 预览，避免遮挡。

窄屏保留现有“产物”按钮和抽屉，不把 rail 常驻到移动端。

对话内产物预览不替代右 rail。它只在 assistant 消息旁展示一个小型产物卡，说明“已生成可检查的产物”，展示标题、摘要和关键字段，帮助用户在对话中看见生成过程。

Markdown 渲染采用本地轻量解析，不引入新依赖，不执行 HTML。支持：

- `#`、`##`、`###` 标题
- `- ` 列表
- 空行分段
- 普通段落

## 成功标准

- 桌面端恢复常驻右 rail，且不会挤压对话到不可读。
- 移动端仍使用产物抽屉。
- 详情 sheet 和侧栏里 Markdown 可读，标题、列表、段落分明。
- 最新 AI 产物回复下能看到对话内产物预览。
- 侧栏视觉与 AI 气泡的青绿色边线、浅背景和低噪声按钮保持一致。
- 专项测试、全量测试、构建和浏览器桌面/移动检查通过。

## 风险与回退

- 如果对话内预览绑定产物过深，可能引入状态耦合。本阶段采用只读展示，由上层传入当前产物列表，不改变后端合同。
- 如果 Markdown 解析过度复杂，可能出现不安全或不可控渲染。本阶段只做文本级轻量解析，不支持 HTML。
- 若桌面 rail 占宽影响小屏笔记本，保留 `lg` 以上显示并维持窄宽度；窄屏继续抽屉。

