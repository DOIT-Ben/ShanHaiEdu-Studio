# 对话导航与产物侧栏交互重构规划 v0.3.4

## 1. 第一性原理：当前阶段核心需求

当前工作台已经接近 Codex 式纯白对话，但缺少三个关键工作台能力：
- 教师需要快速回到某条对话或某次生成结果，而不是只靠滚动。
- 右侧产物节点需要可预览、可复制、可作为输入，悬浮卡不能因为鼠标离开节点就立刻消失。
- 教案、提示词、PPT 脚本等产物需要像文件一样在右侧阅读，并支持调整与主对话区的宽度比例。

本轮成功标准：
- 中央对话左侧有细对话导航条，hover 显示预览，click 平滑跳转到对应消息位置。
- 右侧糖葫芦节点 hover 预览有离开延迟，鼠标移入预览卡后不消失。
- 点击右侧节点不再只打开全局详情，而是丝滑打开产物侧边预览栏；侧边栏位于糖葫芦节点左侧。
- 产物侧边栏可拖动竖向分隔线调整宽度，并能渲染 Markdown 风格内容。
- 输入框默认 Enter 发送，Shift+Enter 换行。
- 视觉仍保持纯白、低噪声、灰阶统一，避免彩色装饰和花哨节点。

## 2. 行业验证和可复用模式

可复用成熟模式：
- Codex/ChatGPT：对话左侧细导航，hover 预览，点击跳转上下文。
- IDE/文档工具：右侧文件预览栏，使用 resizable splitter 调整阅读宽度。
- Radix Popover：用于 hover preview，但需要受控 open 状态和关闭延迟，避免操作按钮点不到。
- CSS transition：用 width/opacity/transform 做轻量面板动效，不引入动画库。

本项目继续复用 shadcn/Radix、lucide、ScrollArea、Button，不新增依赖。

## 3. 复用、适配和必要自研组合

复用：
- `ScrollArea`：主对话滚动、侧栏阅读滚动。
- `Popover`：节点 hover 预览。
- `Button` / `Textarea`：命令和输入。

适配：
- `ConversationWorkbench` 接入消息引用 refs，把 scroll container、消息位置和左侧导航连接起来。
- `ArtifactRail` 只负责线性节点串，具体侧栏预览由新的 `ArtifactSidePanel` 承担。
- `ArtifactNodeCard` 改为更轻的节点视觉和稳定 hover lifecycle。

必要自研：
- `ConversationNavigator`：细导航条、hover 预览、click scroll。
- `ArtifactSidePanel`：右侧文件式产物阅读面板。
- `ResizableHandle`：拖动调整侧栏宽度。
- 简单 `MarkdownPreview`：渲染演示态 Markdown，不展示工程字段。

## 4. 开发方案、风险和验证标准

开发方案：
1. 扩展 `ChatTranscript` 支持 message refs 和 message id 锚点。
2. 新增 `ConversationNavigator`，用 mock messages 生成细导航项，hover 显示预览，click 调用 `scrollIntoView`。
3. 扩展 controller，增加 `sidePanelItem`、`sidePanelOpen`、`sidePanelWidth` 状态。
4. 新增 `ArtifactSidePanel` 和 `MarkdownPreview`，在 `MediaWorkbench` 中插入到主对话和糖葫芦 rail 之间。
5. 改造 `ArtifactNodeCard` 的 hover 关闭逻辑，增加延迟和预览卡区域停留。
6. 改造 `PromptComposer`，Enter 发送，Shift+Enter 换行。

风险：
- 右侧侧栏和糖葫芦节点同时存在可能挤压主对话；通过默认宽度 360px、最小 300px、最大 520px 和可关闭控制解决。
- 对话导航增加后可能变成视觉噪点；默认只显示细线和短刻度，hover 才显示预览。
- Markdown 渲染如果过度复杂会变成新技术债；本轮只支持标题、段落、列表和轻量字段。

验证标准：
- `npm run build` 通过。
- 1374x1004：左侧细对话导航可见，右侧节点可见，打开侧栏后主对话不横向溢出。
- hover 对话导航出现预览，点击后页面滚动到对应消息。
- hover 右侧节点后可以移动到预览卡并点击复制。
- 点击节点打开侧边预览栏，拖动分隔线能改变宽度。
- 输入框 Enter 触发发送提示，Shift+Enter 保留换行。
- 390px：保持项目/产物抽屉入口，不出现桌面侧栏挤压。
