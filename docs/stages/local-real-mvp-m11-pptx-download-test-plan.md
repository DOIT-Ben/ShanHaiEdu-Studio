# Local Real MVP M11 PPTX 最小下载闭环测试定义

日期：2026-07-07

## 1. 测试目标

M11 测试必须证明系统能从当前 `ppt_draft` artifact 生成真实 `.pptx` 文件，并通过浏览器下载。测试不能只验证按钮存在，也不能把文本改后缀当成 PPTX。

## 2. T1：PPTX 生成物结构

输入：

- 一个 `ppt_draft` artifact，标题为“PPT 大纲与逐页脚本”。
- content 中包含“页面结构”“逐页脚本原则”“主视觉需求”。

步骤：

1. 调用 `buildArtifactPptxDownload()`。
2. 检查 filename 是安全 `.pptx` 文件名。
3. 检查 buffer 是二进制数据并以 ZIP 文件头 `PK` 开始。
4. 使用 ZIP 读取器解压。
5. 检查 `[Content_Types].xml`、`ppt/presentation.xml`、`ppt/slides/slide1.xml` 存在。
6. 检查 slides XML 中包含“PPT 大纲与逐页脚本”“页面结构”等关键词。

通过标准：

- 输出为真实 PPTX/OOXML 包。
- 内容来自 artifact。

## 3. T2：后端路由只允许 PPT 大纲 artifact

步骤：

1. 创建项目并生成 PPT 大纲。
2. 对 `ppt_draft` artifact 请求 `/pptx` 路由。
3. 检查状态为 200。
4. 检查 `content-type` 是 PPTX 类型。
5. 检查 `content-disposition` 文件名以 `.pptx` 结尾。
6. 对非 `ppt_draft` artifact 请求同一路由。
7. 检查返回 400 或 404，且不返回 PPTX 文件。

通过标准：

- 只有 PPT 大纲 artifact 能下载 PPTX。
- 非 PPT 节点不会出现误导性文件下载。

## 4. T3：浏览器真实下载

前置：

- Stage 2 主链路已推进到“PPT 大纲与逐页脚本，待确认”。

步骤：

1. 打开 PPT 大纲详情。
2. 点击“下载 PPTX”。
3. 捕获 Playwright download 事件。
4. 检查 suggested filename 以 `.pptx` 结尾。
5. 读取下载文件前两个字节，检查为 `PK`。
6. 检查页面仍不显示“PPTX 文件已生成”这类虚假完成文案。

通过标准：

- 浏览器触发真实文件下载。
- 文件是 PPTX ZIP 包。
- UI 不扩大能力边界。

## 5. 回归范围

集中验收必须覆盖：

- PPTX 专项 Node 测试。
- Markdown 下载专项 Node 测试。
- 总测试 `npm test`。
- 生产构建。
- Stage 2 Chromium desktop。
- Stage 8 Chromium narrow 与 Firefox desktop。
- Stage 7 双 browser context 隔离。

## 6. 不测范围

- 不测试真实图片生成。
- 不测试视频生成或合成。
- 不测试 PowerPoint/WPS 人工打开效果；本阶段用 OOXML 结构作为机器验收。
- 不测试真实 OpenAI live smoke，除非本机已配置真实凭据。
