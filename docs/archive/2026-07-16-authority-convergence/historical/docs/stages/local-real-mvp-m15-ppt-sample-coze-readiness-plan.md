# Local Real MVP M15 PPT Sample And Coze Readiness Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M15 的核心需求是让后续真实 Coze PPT 生成有稳定、可复用、可测试的输入样本，而不是继续用临时口头路径或一次性本机文件。

本阶段必须满足：

- 指定 PPT 提示词和教材 PDF 进入项目 fixture，供后续自动测试与 Coze PPT smoke 复用。
- 保留原始来源、文件大小、sha256 和用途说明，避免样本漂移。
- 复制而不是移动原文件，避免破坏用户原始资料库。
- Coze PPT 台账只记录变量名与调用边界，不泄露 token、账号或私有端点。
- 本阶段只做样本 intake 与 readiness，不把最小 PPTX 下载能力伪装成真实 Coze PPT 已生成。

## 2. 可复用方案调研

已参考项目内资料：

- `docs\mainlines\local-real-mvp.md`
- `docs\private-api-ledger.md`
- `docs\stages\local-real-mvp-m11-pptx-download-report.md`
- `docs\stages\local-real-mvp-m13-final-material-package-report.md`
- `docs\stages\local-real-mvp-m14-ledger-openai-smoke-report.md`

已参考私有 API 台账：

- `providers\coze-ppt.md`
- `docs\coze-ppt-api.md`
- `capabilities\ppt-generation.md`
- `policies\secrets-and-env.md`

成熟做法判断：

- 固定 fixture + manifest 是教育内容生成链路的基础门禁；后续每次 provider、prompt 或 PPTX 生成变化都能复用同一输入。
- Coze PPT 真实生成应在服务端 adapter 或脚本中完成，前端只接收本系统内部 artifact/download URL。
- PPTX 验收不能只看 HTTP 200，至少需要 zip 头、文件大小和可打开性；正式阶段再加入页数和关键页检查。

## 3. 复用、适配和必要自研

复用：

- 复用 `pptxgenjs` 最小 PPTX 验收经验，但不把它作为 Coze PPT 成功证据。
- 复用私有台账中的 Coze OpenAPI 和 `/run` 通道说明。
- 复用 `.gitignore` 对 `.env` 的保护。

适配：

- 新增 `fixtures\ppt\template-a1-original-visual-strategy.md`。
- 新增 `fixtures\textbooks\sujiao-grade6-percentage.pdf`。
- 新增 `fixtures\ppt-sample-manifest.json`，记录来源路径、目标路径、大小、sha256、用途和敏感性判断。
- 新增资产测试，校验 fixture 文件存在、PDF 头合法、manifest 与文件一致。
- 从私有台账只检查 Coze 变量 present/missing，不输出真实值。

必要自研：

- 增加本项目 fixture manifest 的最小结构。
- 增加 Node 资产校验测试，避免后续 agent 误删、换样本或提交空文件。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M15 阶段规划和测试定义。
2. 写红灯测试：fixture 和 manifest 尚不存在时测试失败。
3. 复制提示词与教材 PDF 到 `fixtures\`。
4. 计算 sha256 并写 `fixtures\ppt-sample-manifest.json`。
5. 只读检查 Coze PPT 必需环境变量是否 present。
6. 运行 M15 集中验收。
7. 更新 M15 报告和当前状态审计。
8. 提交 M15，不 push。

主要风险：

- 教材 PDF 是真实教材样本，提交前必须确认文件体量可接受且不包含密钥或个人隐私。
- 提示词和教材可能受版权或内部资料管理约束；本阶段仅作为本地项目测试样本，不外发、不部署。
- Coze `/run` 与后端 OpenAPI 主链路不同，不能混淆为同一验收。
- 如果 Coze token 缺失，只能记录 readiness blocker，不能伪造 PPT 生成。

验证标准：

- `node --test tests\fixture-assets.test.mjs` 通过。
- fixture manifest 的 size 和 sha256 与实际文件一致。
- PDF 文件头为 `%PDF`。
- Coze env present/missing 检查不打印真实 token。
- `npm test` 通过。
- `git diff --check` 通过。
- 敏感信息扫描未命中真实 key、token、私钥或 `.env` 内容。
