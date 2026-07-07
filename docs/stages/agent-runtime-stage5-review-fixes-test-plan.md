# Agent Runtime Stage 5 Review Fixes Test Plan

日期：2026-07-07

## 1. 测试目标

验证独立审查提出的必须修复项已处理。

## 2. 自动化测试

新增或调整：

- 测试 helper `expectSucceeded`：解决 TypeScript 联合类型收窄。
- OpenAI success stub：包含完整必备字段和 `## 自检清单`。
- OpenAI thin-output test：缺少必备字段时返回失败恢复态。
- OpenAI request test：确认上游 artifact markdown excerpt 被发送。

## 3. 集中验收命令

```powershell
$env:VITEST_MAX_WORKERS='2'; npm test -- --maxWorkers=2
npx tsc --noEmit
npm run build
git diff --check
rg -n -i "openai|dangerouslyAllowBrowser" src\components src\app
rg -n "sk-[A-Za-z0-9_-]{20,}" docs src tests package.json package-lock.json
git status --short --branch
```

通过标准：

- 所有命令达到预期 exit code。
- 未跟踪 `SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 不纳入本阶段提交。
