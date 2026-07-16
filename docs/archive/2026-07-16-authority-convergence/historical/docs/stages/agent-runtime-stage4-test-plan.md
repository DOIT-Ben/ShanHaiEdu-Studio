# Agent Runtime Stage 4 Test Plan

日期：2026-07-07

## 1. 测试目标

验证 Agent Runtime Adapter 主线是否达到可合并状态。

## 2. 集中验收命令

```powershell
$env:VITEST_MAX_WORKERS='2'; npm test -- --maxWorkers=2
npm run build
git diff --check
rg -n -i "openai|dangerouslyAllowBrowser" src\components src\app
rg -n "sk-[A-Za-z0-9_-]{20,}" docs src tests package.json package-lock.json
git status --short --branch
```

## 3. 通过标准

- Vitest：4 个测试文件全部通过，23 条测试全部通过。
- Build：Next.js production build exit 0。
- Diff：无 whitespace error。
- 前端边界扫描：无匹配。
- 密钥形态扫描：无匹配。
- 本阶段提交后工作区干净。
