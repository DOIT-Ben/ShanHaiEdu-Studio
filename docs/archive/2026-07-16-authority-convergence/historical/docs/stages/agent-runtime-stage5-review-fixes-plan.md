# Agent Runtime Stage 5 Review Fixes Plan

日期：2026-07-07

## 1. 第一性原理：本阶段核心需求

独立审查指出 Runtime 主线仍有合并阻塞项：类型验收失败、OpenAI 输出质量门禁不足、上游 artifact 正文未进入模型请求。Stage 5 目标是处理这些必须修复项，并把审查意见处理结果写入收尾记录。

成功标准：

- `npx tsc --noEmit` 通过。
- OpenAI runtime 不接受缺少必备字段或 `## 自检清单` 的薄输出。
- OpenAI request 携带已确认上游 artifact 的正文 excerpt，且做长度截断。
- 聚合出口不再导出会创建 SDK client 的 factory，降低前端误 import 风险。
- `*.tsbuildinfo` 作为本地构建缓存被忽略。

## 2. 可复用方案调研

复用审查结论：

- TypeScript 联合类型需要显式类型守卫。
- OpenAI 结构化输出仍需运行时质量校验。
- 上游 artifact 合同包含 `markdown`，request 不应丢弃。

复用项目规则：

- 审查意见必须处理，或记录为明确风险。
- 未跟踪且不属于 Runtime 阶段的文件不得纳入提交。

## 3. 复用、适配与必要自研

复用：

- 复用 Vitest 测试框架。
- 复用 `taskGuidance.requiredFields` 做 OpenAI 输出校验。

必要自研：

- `tests\agent-runtime\test-helpers.ts` 类型守卫。
- `assertMarkdownMeetsTaskGuidance` 运行时质量门禁。
- `createMarkdownExcerpt` 上游正文截断。

## 4. 验证标准

- `npm test -- --maxWorkers=2`
- `npx tsc --noEmit`
- `npm run build`
- `git diff --check`
- 前端 OpenAI 直连扫描无匹配。
- key 形态扫描无匹配。
