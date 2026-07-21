# FrameFlow 风格整图 PPT Tool 阶段计划

## 目标

保留现有 Coze PPT 与分层资产 PPT 工作流，新增一条独立可选路径：逐页生成 16:9 完整视觉图，将每张图片铺满一页 PPT，再叠加来自 `PptPageSpec` 的可编辑文字和数学层，经过结构审查与打磨后形成真实 PPTX。

## FrameFlow 借鉴边界

- 借鉴任务化生图、真实产物校验、失败可重试和产物血缘。
- 不引入 FrameFlow 的 Provider 配置；生产调用继续只走 `MODEL_GATEWAY_IMAGE_MODEL`。
- 不复制 FrameFlow 的前端、数据库或第二编排器。

## 实现范围

1. 注册 `generate_ppt_page_images` Provider Tool，每个 `PptPageSpec` 对应一次完整页图片请求。
2. 注册 `assemble_ppt_image_slides` Package Tool，将已验证图片逐页铺满并叠加可编辑文字/数学对象。
3. 组装阶段审查 PPTX ZIP、页数、每页图片关系、可编辑文字对象和图片哈希绑定；不通过则不晋升产物。
4. Main Agent 自主选择新旧路径；旧 Tool ID、合同和行为不变。

## 排除项

- 不替换或删除既有 PPT Tool。
- 不恢复 API 台账或旧 Provider 凭据入口。
- 不在本阶段执行教师签收、发布或最终课程包验收。

## 回退

删除本阶段新增 Tool 与模块即可；现有 PPT 工作流不受影响。
