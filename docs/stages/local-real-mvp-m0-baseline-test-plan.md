# Local Real MVP M0 Baseline Test Plan

日期：2026-07-07

## 1. 测试目标

M0 测试目标是确认本地真实可用 MVP 主线具备继续推进 M1 的基础可信度。测试不验证教师完整浏览器闭环，也不验证真实 OpenAI、PPTX、图片或视频 provider。

## 2. 测试范围

纳入范围：

- 分支和工作树状态。
- 统一测试入口。
- Next.js 构建。
- Stage 2 preflight。
- 提交前 diff 与敏感信息基础检查。

不纳入范围：

- 浏览器真实 MVP 闭环。
- 真实模型调用。
- 真实 PPTX、图片、视频产物生成。
- 生产部署、远端 push、旧 worktree 删除。

## 3. 集中验收命令

### M0-1：分支与工作树

命令：

```powershell
git status --short --branch
```

通过标准：

- 当前分支是 `mainline/local-real-mvp`。
- 没有未解释的非本轮改动。

### M0-2：统一测试入口

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。
- 未发现测试 worker 残留。

### M0-3：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma generate、Next.js 编译、TypeScript 检查和静态生成均无失败。

### M0-4：Stage 2 preflight

命令：

```powershell
npm run test:e2e:stage2:preflight
```

通过标准：

- exit 0。
- preflight 检查项全部通过。
- 结论只作为进入 M1 浏览器闭环的前置条件，不替代浏览器实测。

### M0-5：提交前检查

命令：

```powershell
git diff --check
git status --short
```

通过标准：

- 无空白错误。
- 暂存前只包含 M0 授权范围内的文档和必要报告。

## 4. 失败处理

- 若 `npm test` 失败，先记录失败命令、首个失败点和最小复现，不进入 build 结论。
- 若 `npm run build` 失败，先按构建错误归因，不进入 M1。
- 若 Stage 2 preflight 失败，M0 可以记录为“基础测试/构建通过但 M1 前置条件阻塞”，不得启动浏览器闭环。
- 连续两轮排障未通过时，收敛为已知事实、失败点和下一步最小动作。
