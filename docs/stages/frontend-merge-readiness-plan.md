# Frontend Merge Readiness Plan

日期：2026-07-07

## 1. 当前目标

本阶段目标是为 `feature/mvp-frontend-api-backed-workbench` 做合并前收口，不重复已经完成的 Frontend API-backed Workbench 主线，也不合并 `main`。

成功标准：

- 只读核对当前分支、远端和工作区状态。
- 明确本分支合并 `main` 前必须关注的风险。
- 汇总 Stage 1-4 的 UI、adapter 和浏览器回归证据。
- 规划下一条前端主线，阶段不超过 10 个。
- 本阶段只提交文档，不做视觉重写、不改其他 worktree。

## 2. 第一性原理

合并前收口不是继续开发功能，而是回答三个问题：

```text
这个分支现在是否干净
这个分支合并前还有哪些已知风险
下一条前端主线应该从哪些真实集成缺口继续
```

Frontend API-backed Workbench 已经完成前端边界迁移。当前最重要的是防止把开发态 adapter、未完成后端合同、失效 lint 脚本或遗留文件误当成可直接生产上线的完成态。

## 3. 调研与复用

复用项目既有证据：

- `docs\mainlines\frontend-api-backed-workbench.md`
- `docs\stages\frontend-api-backed-stage1-closeout.md`
- `docs\stages\frontend-api-backed-stage2-closeout.md`
- `docs\stages\frontend-api-backed-stage3-closeout.md`
- `docs\stages\frontend-api-backed-stage4-closeout.md`

复用已有成熟做法：

- 合同边界：API client、mapper、controller 分层，避免 React 组件直连后端细节。
- 测试边界：`npm test`、`npx tsc --noEmit`、`npm run build`、工程词扫描、`git diff --check`。
- 浏览器回归：桌面与窄屏检查，不用源码判断替代 UI 验收。
- 交付收口：提交前只 stage 本阶段文件，排除不属于本分支的遗留文件。

不新增外部依赖，不把 Playwright 写入项目依赖，不引入新视觉系统。

## 4. 本阶段执行方案

### 4.1 只读核对

执行：

```powershell
git fetch origin feature/mvp-frontend-api-backed-workbench
git status --short --branch
git branch -vv
```

确认：

- 当前分支仍是 `feature/mvp-frontend-api-backed-workbench`。
- 本地 HEAD 与 `origin/feature/mvp-frontend-api-backed-workbench` 对齐。
- 工作区只剩已排除的 `SHANHAIEDU_LEGACY_RETROSPECTIVE.md`。

### 4.2 风险收口

合并前必须逐项说明：

- `npm run lint` 脚本债务。
- 真实后端接入与真实 provider 不在本前端分支内声明完成。
- 响应式证据来自 Stage 4 浏览器回归，合并后仍需 smoke。
- 用户可见工程词已经扫描，但后续真实后端错误文案仍需守住边界。
- `SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 不属于本分支，不提交。

### 4.3 下一主线规划

下一条前端主线聚焦从“前端边界可用”走向“真实 MVP 演示可用”：

- 真实后端联调。
- 错误恢复。
- 加载态。
- 真实项目切换。
- 可访问性。
- 最终 MVP 演示路径。

阶段数不超过 10，每阶段都保留规划、测试、集中开发、集中验收、审查、提交和 push 的 loop engineering 节奏。

## 5. 不做范围

- 不合并 `main`。
- 不改 `main` worktree 或其他 feature worktree。
- 不重写 UI。
- 不新增真实 provider 调用。
- 不提交 `SHANHAIEDU_LEGACY_RETROSPECTIVE.md`。
- 不把 development adapter 当作生产真源。

## 6. 验证与收尾

本阶段是文档收口，验证以版本状态和文档一致性为主：

```powershell
git status --short --branch
git diff --check
```

提交前检查：

- staged files 只包含本阶段两份文档。
- legacy 文件仍未跟踪且未暂存。
- commit message 使用中文规范。
- push 到 `origin/feature/mvp-frontend-api-backed-workbench` 后等待主 Codex 统一集成决策。
