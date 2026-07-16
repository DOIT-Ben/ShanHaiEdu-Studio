# Local Real MVP M10 产物复用输入闭环报告

日期：2026-07-07

## 1. 阶段目标

M10 目标是把“节点产物可复用”从按钮级入口补成真实浏览器闭环：

```text
产物详情
-> 作为输入
-> composer 带引用和可编辑内容
-> 发送下一轮教师消息
-> 后端保存 artifactRefs
-> 前端回显引用
-> 可移除引用且不丢输入正文
```

本阶段不接入真实 OpenAI，不生成 PPTX、图片或视频文件，不改变 workflow node 合同。

## 2. 红灯记录

新增 `tests\e2e\stage2-deterministic.spec.ts` 用例后，第一次运行 `npm run test:e2e:stage2` 失败：

- 失败点：点击完整详情页“作为输入”后，“确认使用”仍可见。
- 结论：`useAsInput()` 未关闭完整详情抽屉，教师输入区仍被详情页遮挡。

修复详情关闭后，第二次运行继续失败：

- 失败点：后端消息已保存 `artifactRefs`，但页面教师消息未显示引用。
- 结论：`mapBackendMessage()` 只映射 `content`，未把后端保存的引用转换为教师可见文本。

第三次失败来自测试断言过宽：

- 失败点：测试用全页 `artifactReference` 隐藏判断引用 chip 消失，但历史教师消息中应保留刚发送过的引用。
- 修正：改为断言“移除引用”按钮隐藏，并检查 textarea 正文仍保留。

## 3. 实现内容

代码改动：

- `src\hooks\useWorkbenchController.ts`
  - `useAsInput()` 在关闭 rail 和 side panel 的同时关闭完整详情抽屉。
- `src\lib\workbench-mappers.ts`
  - 后端消息带 `artifactRefs` 且正文尚未包含“引用：”时，追加教师可见引用文本。
- `tests\e2e\stage2-deterministic.spec.ts`
  - 新增 M10 浏览器用例，覆盖详情页复用、composer 引用、后端 `artifactRefs`、教师消息引用回显、移除引用不清空输入。

文档改动：

- 新增 `docs\stages\local-real-mvp-m10-artifact-reuse-plan.md`。
- 新增 `docs\stages\local-real-mvp-m10-artifact-reuse-test-plan.md`。
- 新增本报告。
- 更新 `docs\stages\local-real-mvp-current-state-audit.md`。

## 4. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests/artifact-markdown-download.test.mjs` | 通过；1 test passed |
| `npm test` | 通过；Node 11 tests passed；Vitest 15 files / 68 tests passed |
| `npm run build` | 通过；Next.js 编译、TypeScript、静态页面生成均通过 |
| `npm run test:e2e:stage2` | 通过；Chromium desktop 2 passed，含 M10 产物复用闭环 |
| `npm run test:e2e:stage8` | 通过；Chromium narrow + Firefox desktop 共 4 passed，含 M10 用例 |
| `npm run test:e2e:stage7` | 通过；双 browser context 隔离 1 passed |

## 5. 审查结论

M10 已完成“复用节点产物作为下一步输入”的本地真实闭环。教师从产物详情点击“作为输入”后会回到 composer，看到引用 chip 和可编辑输入；发送后后端保存 `artifactRefs`，页面消息也能回显引用；清除引用不会清空已编辑正文。

本阶段没有扩大 provider 能力边界。M6 live OpenAI smoke 仍因缺少真实凭据未通过，不能宣称真实模型已可用。

## 6. 后续建议

下一阶段仍优先补验 M6 live OpenAI smoke；若凭据继续不可用，则可推进真实文件能力拆分规划，优先从 PPTX 文本大纲到可下载 PPTX 的最小文件闭环开始。

