# Local Real MVP M13 最终材料包 ZIP 下载测试定义

日期：2026-07-07

## 1. 测试目标

M13 测试必须证明最终交付清单可以下载真实 `.zip` 材料包，且材料包内包含最终交付 Markdown 和最小 PPTX 文件。测试不能只验证按钮存在，也不能把文本改后缀当成 ZIP。

## 2. T1：ZIP 生成物结构

输入：

- 一个 `final_delivery` artifact。
- 一个来自 PPT 大纲的 PPTX 下载对象。

步骤：

1. 调用 `buildFinalMaterialPackageDownload()`。
2. 检查 filename 是安全 `.zip` 文件名。
3. 检查 buffer 是二进制数据并以 ZIP 文件头 `PK` 开始。
4. 解压 ZIP。
5. 检查包含：
   - `README.md`
   - `final-delivery.md`
   - `ppt-outline.pptx`
6. 检查 `README.md` 包含材料包范围说明。
7. 检查 `final-delivery.md` 包含“最终交付清单”和“PPT 大纲可下载最小 PPTX 文件”。
8. 检查所有文本文件不包含：
   - “PPTX 文件已生成”
   - “图片文件已生成”
   - “视频成片已生成”

通过标准：

- 输出为真实 ZIP 包。
- ZIP 内文件来自真实 artifact 与 PPTX 构建结果。
- 边界说明准确。

## 3. T2：后端路由只允许最终交付 artifact

步骤：

1. 创建项目并生成完整主链路。
2. 对 `final_delivery` artifact 请求 `/package` 路由。
3. 检查状态为 200。
4. 检查 `content-type` 是 ZIP 类型。
5. 检查 `content-disposition` 文件名以 `.zip` 结尾。
6. 对非 `final_delivery` artifact 请求同一路由。
7. 检查返回 400 或 404，且不返回 ZIP 文件。

通过标准：

- 只有最终交付清单能下载材料包。
- 非最终交付节点不会出现误导性包下载。

## 4. T3：浏览器真实下载

前置：

- Stage 2 主链路已推进到最终交付清单详情。

步骤：

1. 打开最终交付清单详情。
2. 点击“下载材料包”。
3. 捕获 Playwright download 事件。
4. 检查 suggested filename 以 `.zip` 结尾。
5. 读取下载文件前两个字节，检查为 `PK`。
6. 解压检查包含 `README.md`、`final-delivery.md`、`ppt-outline.pptx`。
7. 检查页面仍不显示虚假完成表述。

通过标准：

- 浏览器触发真实 ZIP 文件下载。
- ZIP 内包含 Markdown 和 PPTX。
- UI 不扩大能力边界。

## 5. 回归范围

集中验收必须覆盖：

- 材料包专项 Node 测试。
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
- 不测试 ZIP 内视频大文件或流式打包。
- 不测试 PowerPoint/WPS 人工打开效果；本阶段用 ZIP 与 OOXML 结构作为机器验收。
