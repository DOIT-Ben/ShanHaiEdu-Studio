# FrameFlow 风格整图 PPT Tool 测试计划

## 合同测试

- 新旧 PPT Tool 同时注册并对 Main Agent 可见。
- 新 Provider Tool 只接受 `ppt_design_draft`，产出 `ppt_page_images`。
- 新 Package Tool 只接受 `ppt_design_draft + ppt_page_images`，产出 `pptx_artifact`。

## 图片批次测试

- 每页恰好形成一个 16:9 整图请求。
- 结果绑定 pageId、请求摘要、真实文件路径、字节数、尺寸与 SHA-256。
- 任一页缺失、重复、不可解码或哈希不符时失败关闭。

## PPTX 测试

- PPTX 是有效 ZIP，存在 `ppt/presentation.xml`。
- slideCount 与设计页数一致，每页恰好绑定一张整页图片。
- `editableText` 和 `editableMath` 作为独立 PPTX 文本对象存在，不烘焙进图片证明可编辑。
- 生成审查报告，确认图片绑定、文字层、页数和结构全部通过。

## 回归与门禁

- 定向 Vitest。
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run gate:development`
