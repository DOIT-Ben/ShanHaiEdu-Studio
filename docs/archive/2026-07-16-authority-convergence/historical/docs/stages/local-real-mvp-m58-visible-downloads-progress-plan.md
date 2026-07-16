# M58 教师可见下载与进度反馈计划

## 1. 核心需求

当前工作台已经能生成和保存教案、PPTX、图片、视频、最终材料包等产物，但教师在主对话、右侧阅读面板和预览卡片中仍不容易直接下载材料；顶部 1-5 阶段进度主要依赖项目快照中的 `currentStep`，在一次长任务执行期间缺少可见推进；发送后只有静态等待提示，教师无法判断系统正在做哪一步。

M58 的核心需求是把真实产物下载入口、长任务执行中反馈和顶部阶段进度做成教师可见、低噪声、可验证的交互。成功标准：教师无需打开工程调试信息，也能在教案、PPT、图片、视频、最终包相关卡片处看到下载入口；发送任务期间能看到当前阶段提示；顶部 1-5 进度在客户端执行阶段和快照产物状态变化时都会推进。

## 2. 可复用方案调研

本项目已有可复用实现：

- `useArtifactMarkdownDownload` 已能把任意 `ArtifactItem` 导出为 Markdown。
- `useArtifactPptxDownload` 已能从真实 PPTX 下载接口下载课件。
- `useArtifactRealAssetDownload` 已能下载真实图片和视频文件。
- `useFinalPackageDownload` 已能下载最终 ZIP 材料包。
- `ArtifactDetailSheet` 已经集成上述下载 hooks，是 M58 的主要复用来源。
- `GeneratingIndicator` 已有低噪声等待气泡，可以扩展为阶段化文案而不改整体视觉语言。

UI/UX 复用原则：沿用现有 Codex 风格工作台、白底低噪声、小按钮和教师可读文案；不引入新组件库、不做大视觉改版、不显示 `provider`、`storage`、`API`、`debug` 等工程词。

## 3. 复用、适配与必要自研

复用：保留现有下载 hooks 和下载接口，不重写真实文件下载链路。

适配：新增一个共享的 `ArtifactDownloadActions` 客户端组件，把详情页已有下载按钮复用到聊天内联产物卡、右侧阅读面板、悬浮预览卡和抽屉/轨道预览。组件只根据 `ArtifactItem`、`projectId` 和已有下载能力渲染教师可见按钮。

必要自研：新增轻量进度推导函数，从项目 `currentStep`、产物状态和客户端执行阶段合成顶部 1-5 active index。客户端执行阶段只描述本地可证明状态，例如“正在理解要求”“正在组织材料”“正在保存成果”，不伪装远端 provider 的百分比进度。

## 4. 落地方案、风险与验证

落地方案：

- 新增 `tests/m58-visible-downloads-progress.test.mjs`，先覆盖下载入口、阶段反馈和进度推导。
- 新增 `src/components/artifacts/ArtifactDownloadActions.tsx`，统一渲染 Markdown、PPTX、图片、视频、材料包下载按钮。
- 修改 `MediaWorkbench`、`ConversationWorkbench`、`ChatTranscript`、`ArtifactSidePanel`、`ArtifactPreviewCard`、`ArtifactRail`，向需要下载的 UI 位置传递 `projectId` 并渲染共享下载按钮。
- 新增或调整 `src/lib/workbench-progress.ts`，让顶部进度由项目文案、产物状态和执行反馈共同推导。
- 扩展 `GeneratingIndicator` 支持教师可读阶段文案。

风险：

- 如果在过多位置显示下载按钮，界面可能变吵；本阶段用小尺寸 secondary 按钮并保留主视觉简洁。
- 执行阶段反馈不是远端流式进度，不能表达真实百分比；文案必须保持“正在处理/保存”级别，不写确定完成结果。
- 真实下载仍依赖已有后端接口和 artifact storage，若 provider 未生成真实文件，按钮应只显示已有能力对应入口。

验证标准：

- `node --test "tests/m58-visible-downloads-progress.test.mjs"` 通过。
- `npm test` 通过。
- `npm run build` exit 0。
- `git diff --check` 无空白错误。
- 浏览器打开 `http://127.0.0.1:3132`，桌面和窄屏关键页面可用，主对话和阅读面板能看到下载入口，发送期间显示阶段反馈。
