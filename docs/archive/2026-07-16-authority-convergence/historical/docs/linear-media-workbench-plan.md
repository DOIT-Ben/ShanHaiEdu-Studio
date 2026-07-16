# ShanHaiEdu 线性媒体工作台规划

## 1. 第一性原理

当前阶段的核心需求不是展示技术能力，而是让小学数学公开课教师按线性链路拿到可交付作品。教师需要持续知道三件事：现在做到哪一步、上一步确认了什么、下一步会使用什么输入。

因此界面必须围绕“线性确认”和“上游产物复用”组织，而不是围绕日志、配置或技术状态组织。主工作区承载对话式任务推进；右侧栏承载可回看、可复制、可插入的节点产物；左侧栏只负责项目切换。

## 2. 可复用方案调研

- Next.js App Router：适合独立 React 工作台、组件化页面和后续迁移到正式产品。官方文档：https://nextjs.org/docs
- Tailwind CSS：适合在设计 token 约束下快速实现密集 To B 布局。官方文档：https://tailwindcss.com/docs
- shadcn/ui 思路：本地拥有组件源码、基于 Radix primitives，不绑定黑盒 UI kit。官方文档：https://ui.shadcn.com/docs
- Radix UI：Popover、Dialog、Select、Tooltip、ScrollArea 等基础交互具备可访问性基础。官方文档：https://www.radix-ui.com/primitives/docs/overview/introduction
- lucide-react：轻量图标库，适合按钮和状态提示。官方文档：https://lucide.dev/guide/packages/lucide-react

结论：采用 Next.js + Tailwind + Radix primitives + lucide-react。组件风格参考 shadcn，但本项目只实现当前工作台需要的最小组件集合。

## 3. 复用、适配与自研组合

- 复用：Radix 的 Popover、Dialog、Select、Tooltip、ScrollArea；lucide 图标；Next App Router。
- 适配：按 ShanHaiEdu 的暖纸白、深青灰、古铜金和低饱和状态色定义本地 token。
- 自研：ProjectSidebar、ConversationWorkbench、ArtifactRail、ArtifactNodeCard、ArtifactPreviewPopover、ArtifactDetailSheet、PromptComposer，以及节点 mock 数据结构。

## 4. 落地方案、风险与验证

### 落地方案

1. 创建独立项目目录和项目规则。
2. 搭建 Next/Tailwind/Radix 工程。
3. 定义节点数据结构与演示数据。
4. 实现三栏工作台。
5. 实现悬浮预览、复制、作为输入、详情、确认、重做、失败恢复。
6. 做构建验证和浏览器截图检查。

### 风险

- 演示数据容易被误认为真实生成结果：界面顶部和详情层必须标注“演示数据”。
- 工作台容易变成工程后台：用户可见文案只使用教师能理解的表达。
- 右侧节点多时可能拥挤：右栏使用固定宽度和稳定滚动，卡片内容保持两行摘要。

### 验证标准

- `npm run build` 通过。
- 1440px 桌面端显示三栏布局。
- 窄屏下左侧折叠，右侧产物栏可通过抽屉查看。
- 复制关键内容、作为下一步输入、查看详情、确认、重做、失败恢复均有可见状态。
- 用户可见界面不出现工程调试词。

