# v0.3.9 前端打磨方案

## 1. 第一性原理

当前原型已经建立了正确的信息架构：左侧项目、中间对话、右侧线性产物。继续打磨的核心不是增加功能，而是降低视觉噪声，让教师把注意力稳定放在中间对话和当前产物判断上。

成功标准：

- 桌面端默认态更轻，不增加新颜色。
- 产物面板像阅读侧栏，不像后台表单。
- 窄屏阶段条不截断关键步骤。
- 输入框保持主视觉，但减少厚重边框和阴影。
- 已有交互不回退：发送、Enter、hover 复制、节点 hover、面板切换仍可用。

## 2. 可复用方法

采用本地 `conversational-workbench-frontend` skill 的三层规则：对话为主视觉，产物导航压缩，详情面板独立打开。采用 `ui-review-polish` 的证据优先流程：先看浏览器截图，再做最小有效修复，最后复验桌面、面板和窄屏。

## 3. 复用与适配

继续复用现有 Next.js、Tailwind、Radix、lucide 和项目组件，不引入新依赖，不重做 UI kit。只在以下组件内做局部打磨：

- `StageProgress`：改善窄屏横向滚动与线条节奏。
- `PromptComposer`：减轻输入框阴影、稳定底部动作区。
- `ArtifactSidePanel` / `MarkdownPreview`：优化阅读侧栏密度和字段呈现。
- `ProjectSidebar` / `Button`：统一 selected 与 hover 的灰阶状态。

## 4. 落地与验证

开发动作：

1. 调整全局 token 的边框、muted、按钮状态，使灰阶更统一。
2. 优化阶段条在小屏下的横向滚动与留白。
3. 优化 prompt composer 的阴影、边框、按钮尺寸和 near-field notice。
4. 优化 artifact side panel 的标题、字段组、底部动作。

风险：

- 过度变轻可能导致控件边界不清。
- 阶段条横滚如果处理不好会造成移动端溢出。
- 面板字段变轻后可能降低可扫描性。

验证：

- `npm run build`
- Playwright 检查发送、Enter、Shift+Enter、hover 复制、节点 hover、面板打开后 hover 不出预览。
- 生成 1440 桌面、面板打开、390 窄屏截图。
