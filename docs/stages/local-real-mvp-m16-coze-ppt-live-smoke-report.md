# Local Real MVP M16 Coze PPT Live Smoke Report

日期：2026-07-07

## 1. 阶段目标

M16 目标是使用 M15 的固定 PPT 提示词和百分数教材样本，调用真实 Coze PPT `/run` 通道，下载 `.pptx` 到本地 `.tmp`，并完成最小文件合法性校验。

本阶段是 provider smoke，不等于后端 OpenAPI 主链路或教师工作流节点已完成。

## 2. 本轮实现

新增 `scripts\coze-ppt-smoke.mjs`：

- 读取本地 `.env` 中的 `COZE_PPT_RUN_URL` 和 `COZE_API_TOKEN`。
- 缺少必要 env 时输出 `missing_COZE_PPT_RUN_ENV` 并非 0 退出。
- 从 `fixtures\ppt\template-a1-original-visual-strategy.md` 和 `fixtures\ppt-sample-manifest.json` 组装 1 页百分数导入课 PPT 请求。
- 调用真实 Coze PPT `/run` 通道。
- 支持解析纯 JSON 和 Markdown fenced JSON。
- 下载远程 PPTX 到 `.tmp\coze-ppt-smoke\`。
- 使用 zip 头和 `ppt\presentation.xml` 校验 PPTX。
- 输出脱敏 JSON，不打印 token、远程 PPTX URL、账号、私有端点或完整响应体。

新增 `tests\coze-ppt-smoke-script.test.mjs`：

- 覆盖 Coze 返回解析。
- 覆盖 PPTX zip 结构校验。
- 覆盖缺 env 门禁和脱敏输出。

## 3. Live Smoke 结果

真实 Coze PPT smoke 已通过：

```text
ok=true
provider=coze_ppt
channel=run
fileName=grade6_percentage_intro.pptx
bytes=29462
sha256=393318e525cfd8a45c3ab1bccb33d6d4370590fcf46809805be4aa546e9bf1f9
pptxValid=true
hasPresentationXml=true
```

生成文件只保留在本地 `.tmp\coze-ppt-smoke\`，不纳入提交。

## 4. 验收记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `node --test tests\coze-ppt-smoke-script.test.mjs` | 红灯后绿灯 | 缺脚本时失败；实现后 3 tests passed |
| `node scripts\coze-ppt-smoke.mjs` | 通过 | 真实 Coze `/run` 返回并下载 PPTX，`pptxValid=true` |
| `npm test` | 通过 | Node 21 tests passed；Vitest 16 files / 69 tests passed |
| `npm run build` | 通过 | Prisma Client 生成成功；Next.js 编译、TypeScript、静态页面生成均通过 |

## 5. 风险与边界

- `/run` 是已发布外部通道和压测证据，不等于最终后端 OpenAPI 主链路。
- 本阶段没有把真实 Coze PPT 接入工作流节点、最终材料包或教师 UI。
- 当前 smoke 只生成 1 页最小 PPTX，不证明完整课堂 PPT 的视觉质量、页数稳定性或内容契约完全达标。
- 远程 PPTX URL 可能是签名 URL，严禁写入文档、日志、前端或提交。

## 6. 审查结论

M16 通过：ShanHaiEdu 本地项目已能调用真实 Coze PPT `/run` 通道，下载并校验真实 `.pptx` 文件。下一步应进入后端 Coze PPT adapter 和工作流节点接入，把 smoke 能力转为项目 artifact 能力。
