# M70 前端工作台功能收口阶段计划

日期：2026-07-11

状态：done

## 1. 目标

收口 M54-A 前端聊天式工作台第一档未完成项，让教师首次进入、附加材料、查看工具能力和窄屏使用时都能获得真实、清晰、可验证的体验。M70 不重做 UI，不引入营销页，不伪装未接通能力。

## 2. 范围

本阶段纳入：

- 首次欢迎态：无消息时展示 ShanHaiEdu 标识、自然欢迎语和 2-4 个高频备课任务，点击后填入输入框等待教师发送。
- 附件拖放：工作台输入区支持拖入文件，显示覆盖态和真实附件状态。
- 截图粘贴：支持剪贴板图片粘贴，显示图片附件卡和补充提示；当前不把图片二进制发送给模型，不伪装 OCR、图片解析或多模态理解。
- 文件状态：继续支持小型 `.txt` / `.md` / `.csv` / `.json` 文本读取；PDF/DOCX/图片展示待处理/暂不能解析的真实状态和下一步建议。
- 模型/工具菜单：输入框提供模式/工具入口，已接通能力可用，未接通能力 disabled 或隐藏，不能出现假按钮。
- 假入口清理：清理“更多操作暂未开放”等可点击假入口；保留有明确说明的 disabled 控件。
- 响应式：桌面和 390px 窄屏下欢迎态、附件状态、菜单和输入区不遮挡最新消息。

## 3. 不纳入

- 不实现真实 PDF/DOCX 解析、OCR、图片转文本或多附件上传到服务端。
- 不实现真实 token streaming；只保留准确的生成/保存/排队状态文案。
- 不重做三栏架构、交付链、Artifact 详情、反馈中心或多用户管理。
- 不改变 HumanGate、PlanGuard、Artifact Truth Gate 或 provider 质量门禁。

## 4. 现有复用

- 复用 `ConversationWorkbench` 的空消息区域和 `PromptComposer` 的输入区。
- 复用 `AttachmentStatusCard`、`composer-contracts` 和 `useWorkbenchController.attachComposerFile`。
- 复用现有 `Button`、`Textarea`、Radix 弹层/菜单风格和 lucide 图标。
- 复用 `QuickReplySuggestions` 的“填入输入框但不自动发送”交互原则。

## 5. 实现设计

### 5.1 欢迎态

- 新增轻量 `WelcomeEmptyState` 组件，放在无消息且非 loading/error 时展示。
- 文案聚焦真实备课：公开课目标、教案+PPT、导入视频、检查优化。
- 点击建议只调用 `onInputChange` 填入输入框，不自动发送，不携带 hidden actionId。

### 5.2 附件与粘贴

- `PromptComposer` 接管 `onDragEnter/onDragOver/onDrop/onPaste`。
- 文本文件按现有本地读取路径进入 reference。
- 图片粘贴/拖入只创建 `image_reference` 附件卡，并提示教师在输入框补充可见文字或画面要点；当前不进入模型引用。
- PDF/DOCX 创建 `needs_manual_summary` 或 `unsupported` 状态，提示教师摘取关键内容；不标记为已解析。

### 5.3 模型/工具菜单

- 在输入框工具栏增加一个低噪声工具菜单按钮。
- 菜单展示当前模式：备课助手、添加资料、截图参考；未接通的 PDF/DOCX 自动解析和真实流式输出 disabled。
- 可见文案不出现 schema、provider、API、node_id、debug 等工程词。

### 5.4 假入口清理

- 移除或禁用无真实动作的“更多操作”入口；保留产物抽屉、反馈、协作等真实入口。
- 重新生成继续保持 disabled，并提示到产物详情中操作。

## 6. 风险与约束

- 附件功能容易被误解为服务端上传或 OCR，本阶段必须用清晰状态避免过度承诺。
- 前端拖放和粘贴需要浏览器实测，单元测试不能替代真实页面检查。
- 欢迎态不能压过输入框或交付链，移动端必须优先保证输入可用。

## 7. 验收标准

- 无项目消息时展示欢迎态和 2-4 个高频任务；点击后只填入输入框，不自动发送。
- 拖入 `.txt` / `.md` 能读取并作为本轮资料引用；拖入/粘贴图片显示视觉参考状态；PDF/DOCX 不伪装已解析。
- 工具菜单中未接能力不可点击或明确 disabled，无假入口和工程词。
- 桌面和 390px 窄屏浏览器检查通过，无明显重叠、遮挡或文本溢出。
- `npm test`、`npm run build`、`git diff --check`、`graphify update .` 通过。
