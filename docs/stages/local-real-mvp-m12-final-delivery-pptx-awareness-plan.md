# Local Real MVP M12 最终交付清单识别 PPTX 下载能力规划

日期：2026-07-07

## 1. 第一性原理判断

M11 已经证明“PPT 大纲与逐页脚本”可以从当前 artifact 生成真实 `.pptx` 最小文件并通过浏览器下载。继续沿用 M5 的最终交付清单旧文案，会让教师看到两个互相割裂的事实：

```text
PPT 大纲详情可以下载 PPTX
最终交付清单仍笼统提示 PPTX 待生成
```

M12 的核心需求是统一产品口径：

- 最终交付清单应列出“PPT 大纲可下载最小 PPTX 文件”。
- 图片文件、视频成片、动画和视觉精修仍必须标记为待生成或待完善。
- 不得把 M11 的最小 PPTX 下载扩大描述为完整课件制作完成。

成功标准：

- 后端 deterministic final delivery 内容出现 PPTX 最小下载能力提示。
- Markdown 下载内容同步包含该提示。
- 浏览器最终交付详情页可见该提示。
- 页面和下载内容仍不出现“PPTX 文件已生成”“图片文件已生成”“视频成片已生成”。

## 2. 可复用方案调研

项目内已有可复用资产：

- `src\server\agent-runtime\deterministic-runtime.ts` 已集中生成最终交付清单正文。
- `src\server\agent-runtime\task-guidance.ts` 已维护最终交付清单自检项。
- `src\server\workbench\__tests__\stage11-m5-final-delivery.test.ts` 已覆盖最终交付 artifact 内容。
- `tests\artifact-markdown-download.test.mjs` 已覆盖最终交付 Markdown 下载内容。
- `tests\e2e\stage2-deterministic.spec.ts` 已覆盖最终交付详情页和 Markdown 下载。

本阶段不需要新增外部库，也不需要新增数据库字段。M11 已把 PPTX 下载能力挂在 PPT 大纲 artifact 详情页，M12 只调整最终交付清单的教师可见事实描述和测试。

## 3. 复用、适配与必要自研

复用：

- 复用现有 final delivery workflow，不新增节点。
- 复用现有 artifact markdown download builder，不改变下载格式。
- 复用 Stage 2 E2E 主链路验证最终交付详情和下载内容。

适配：

- 调整 deterministic final delivery 的“已形成材料”和“待确认事项”。
- 调整 task guidance，要求区分“最小 PPTX 可下载”和“图片/视频/精修未完成”。
- 调整 M5/M9/M11 相关测试断言，使其验证新的准确口径。

必要自研：

- 仅需新增阶段文档和小范围测试/文案改动；不新增通用抽象。

## 4. 开发方案、风险与验证标准

开发方案：

1. 写 M12 测试红灯：
   - final delivery 后端测试要求包含“PPT 大纲可下载最小 PPTX 文件”。
   - Markdown 下载测试要求包含同一能力提示。
   - Stage 2 E2E 要求最终交付详情和下载内容可见该提示。
2. 运行目标测试确认红灯。
3. 更新 `deterministic-runtime.ts` 和 `task-guidance.ts`。
4. 运行专项与集中验收。
5. 写 M12 报告并更新当前状态审计。

风险：

- 如果文案写成“PPTX 文件已生成”，会违反 M11 的边界，因为当前只是按需从 PPT 大纲生成最小文件。
- 如果只改后端不改 Markdown 下载测试，最终交付导出可能继续旧口径。
- 如果扩大到材料包 ZIP，会超出本阶段范围。

验证标准：

- 红灯：更新测试后，旧 runtime 文案无法通过。
- 绿灯：
  - `npx vitest run src/server/workbench/__tests__/stage11-m5-final-delivery.test.ts --maxWorkers=1`
  - `node --test tests/artifact-markdown-download.test.mjs`
  - `npm run test:e2e:stage2`
- 集中验收：
  - `npm test`
  - `npm run build`
  - `npm run test:e2e:stage8`
  - `npm run test:e2e:stage7`
  - `git diff --check`
