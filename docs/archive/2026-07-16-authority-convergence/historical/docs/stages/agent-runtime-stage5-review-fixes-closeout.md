# Agent Runtime Stage 5 Review Fixes Closeout

日期：2026-07-07

## 1. 审查意见处理

独立审查结论：With fixes 后再合并。

已处理：

- TypeScript 验收失败：新增 `tests\agent-runtime\test-helpers.ts`，所有测试访问成功结果前显式收窄。
- OpenAI 输出质量门禁不足：新增 `assertMarkdownMeetsTaskGuidance`，模型输出缺少任务必备字段或 `## 自检清单` 时返回失败恢复态。
- 上游 artifact 正文丢失：OpenAI request 现在携带 `markdownExcerpt`，并限制长度，避免 prompt 过长。
- 服务端边界偏脆：聚合出口不再导出 `createAgentRuntimeFromEnv`，该 factory 需从 `runtime-factory.ts` 服务端路径显式导入。
- `tsconfig.tsbuildinfo` 误入工作区：已将 `*.tsbuildinfo` 加入 `.gitignore`，不纳入提交。

可接受风险：

- `SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 是未跟踪文件，不属于 Runtime 阶段交付，未纳入提交。若需要保留，应由对应 retrospective/legacy 任务单独处理。
- 真实 OpenAI provider smoke 仍未执行；本阶段只验证服务端边界和 fake client。

## 2. 验收证据

已执行：

```powershell
$env:VITEST_MAX_WORKERS='2'; npm test -- --maxWorkers=2 tests/agent-runtime/openai-runtime.test.ts
npx tsc --noEmit
$env:VITEST_MAX_WORKERS='2'; npm test -- --maxWorkers=2
npm run build
git diff --check
rg -n -i "openai|dangerouslyAllowBrowser" src\components src\app
rg -n "sk-[A-Za-z0-9_-]{20,}" docs src tests package.json package-lock.json
```

结果：

- OpenAI runtime tests: 1 file / 4 tests passed
- TypeScript: exit 0
- Full runtime tests: 4 files / 24 tests passed
- Build: Next.js production build compiled successfully, TypeScript finished successfully
- Diff check: exit 0
- Frontend OpenAI boundary scan: exit 1, no matches
- Key-shape scan: exit 1, no matches

## 3. 当前未跟踪文件归属

- `SHANHAIEDU_LEGACY_RETROSPECTIVE.md`：未跟踪，不属于 Runtime 阶段交付，未提交。
- `tsconfig.tsbuildinfo`：TypeScript 本地构建缓存，已通过 `.gitignore` 忽略。

## 4. 最终只读审查记录

用户指定的只读审查线程 `019f3924-e46f-7f20-a680-968ed38ea5e1` 已完成复核。

结论：

- P0：未发现。
- P1：未发现。
- P2：`SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 仍是未跟踪文件，不应纳入本 Runtime 分支。
- 建议：可以 push 当前 Runtime commits；不要提交未跟踪复盘文档。

处理：

- 未跟踪复盘文档继续排除在本 Runtime 分支外。
- 真实 OpenAI provider smoke 未执行，保留为显式环境配置后的单独验证项。
- `npm audit` 仍有 2 个 moderate 风险；`audit fix --force` 会做破坏性依赖变更，不在本 Runtime 合同主线内强修。
