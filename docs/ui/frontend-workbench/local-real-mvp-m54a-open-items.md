# M54-A 前端聊天式工作台当前完成度与开放项

更新时间：2026-07-10

状态：第一档 UI 开放项；以当前代码和浏览器验收为准。

## 1. 已有基础

- 三栏工作台、项目区、主对话和右侧糖葫芦交付链已有基础。
- `PromptComposer` 已支持 Enter 发送、Shift+Enter 换行和输入框自适应。
- 已有自动滚动、生成状态、快捷回复、消息 hover 操作、Logo 和 Markdown 阅读基础。
- `MessageActions` 已显示复制、点赞、点踩、更多按钮。

## 2. 已查证未完成

### 2.1 反馈

`MessageActions` 的点赞/点踩当前只显示：

```text
已在本页记下，反馈入口暂未开放。
```

没有 `FeedbackDialog`、保存接口、数据库记录或附件存储。必须先按 `docs\product\beta-feedback-requirements.md` 完成内测反馈中心。

`MessageActions` 的“更多”也是当前可点击假入口，只显示“更多操作暂未开放”。完成反馈阶段时应隐藏该入口，或只保留已经接通的真实操作。

### 2.2 附件与图片

当前 `PromptComposer` 通过文件选择读取小型文本内容，尚未完成：

- 文件拖入覆盖态。
- 剪贴板图片粘贴。
- 图片预览与上传。
- PDF / DOCX 的真实解析状态。
- 多附件管理。

### 2.3 首次欢迎态与头像菜单

当前代码未找到独立 `WelcomeEmptyState` 和 `ProfileMenu` 完整实现；欢迎入口、账号/设置/反馈/退出菜单仍需收口。

### 2.4 模型与工具菜单

当前没有完整 `ComposerModelMenu`、`ComposerAttachmentMenu` 和 `ComposerFileDropzone`；未接能力必须隐藏或 disabled。

### 2.5 真实流式回复

当前有 `streaming` 状态文案合同，但没有足够证据证明 Responses 流式输出已经贯穿接口、状态和 UI；完成前不得宣称真实 streaming。

### 2.6 参考图证据

M54-A 深度规格中 R00-R13 的原始图片路径来自临时剪贴板目录，当前不可作为长期可复核资产。后续 UI 重构前应把仍有价值的参考图复制到项目受控证据目录并脱敏，或用浏览器重新生成可复核截图；在此之前，以文字需求和当前浏览器证据为准。

## 3. 第一档实施顺序

1. 内测反馈中心。
2. 首次欢迎态、头像菜单和全局反馈入口。
3. 拖放、截图粘贴、图片/PDF/DOCX 上传解析状态。
4. 模型/工具菜单与假入口清理。
5. 普通聊天/业务任务分流和自然语言确认改道。
6. 真实流式回复、响应式与桌面/窄屏浏览器验收。

## 4. 关联文档

- `docs\product\frontend-workbench-priority-requirements.md`
- `docs\ui\frontend-workbench\local-real-mvp-m54a-frontend-workbench-deep-spec.md`
- `docs\ui\frontend-workbench\local-real-mvp-m54a-frontend-workbench-roadmap.md`
- `docs\ui\frontend-workbench\local-real-mvp-m54a-frontend-workbench-test-plan.md`
