# Local Real MVP M15 PPT Sample And Coze Readiness Report

日期：2026-07-07

## 1. 阶段目标

M15 目标是把用户指定的 PPT 提示词和教材 PDF 纳入项目可复用 fixture，并确认 Coze PPT API 所需本地环境变量已可由私有台账安装到本项目。

本阶段不宣称 Coze PPT 已生成真实课件；真实 API 调用与下载校验将作为后续阶段继续推进。

## 2. 样本资产

已复制而非移动原始文件：

| fixture | 目标路径 | 大小 | 用途 |
| --- | --- | ---: | --- |
| PPT 提示词 | `fixtures\ppt\template-a1-original-visual-strategy.md` | 3322 bytes | 后续 Coze PPT prompt 输入 |
| 教材 PDF | `fixtures\textbooks\sujiao-grade6-percentage.pdf` | 5112009 bytes | 后续百分数教材样本 |

新增 `fixtures\ppt-sample-manifest.json`：

- 记录 fixture id、类型、项目内路径、原始来源路径、size、sha256、复制日期、用途和敏感性判断。
- 不包含 token、key、secret、私有 env 值或账号。

## 3. Coze readiness

已参考私有 API 台账，但未摘录、提交或打印真实 token、账号、私有端点或 `.env` 内容。

项目根 `.env` 已安装以下 Coze 变量，且 `.env` 被 `.gitignore` 忽略：

- `COZE_API_BASE`：present
- `COZE_API_TOKEN`：present
- `COZE_PPT_BOT_ID`：present
- `COZE_PPT_RUN_URL`：present

台账中的轮询参数当前未提供，本阶段不把它们作为 blocker；后续 adapter 可以设置保守默认值。

## 4. 验收记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `node --test tests\fixture-assets.test.mjs` | 红灯后绿灯 | 缺 manifest 时失败；复制 fixture 并写 manifest 后 1 test passed |
| Coze env present/missing 检查 | 通过 | 四个 Coze 关键变量 project present 均为 True；未打印值 |
| `npm test` | 通过 | Node 18 tests passed；Vitest 16 files / 69 tests passed |

## 5. 风险与边界

- 教材 PDF 已作为本地项目 fixture 纳入仓库候选变更，后续不要外发或公开部署该样本，除非用户单独确认版权和发布边界。
- M15 只证明样本和 Coze env readiness；还没有完成 Coze API adapter、真实 PPT 生成、下载、zip 头校验、页数校验或工作流节点接入。
- Coze 官方 OpenAPI 和 `/run` 通道边界不同；后续必须选定一条产品主链路，不能把外部压测通道冒充为后端主实现。

## 6. 审查结论

M15 readiness 通过：指定 PPT 提示词与教材 PDF 已进入项目 fixture，manifest 完整性测试通过，Coze PPT 关键本地 env 已 present。下一步应进入真实 Coze PPT smoke/adapter 阶段，验证真实 `.pptx` 下载与 PPTX 文件合法性。
