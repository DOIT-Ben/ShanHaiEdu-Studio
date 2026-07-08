# M54-0 主线合并收口报告

日期：2026-07-08

## 目标

把长期开发分支 `mainline/local-real-mvp` 合回 `main`，让后续本地演示、部署准备和新阶段开发都能以 `main` 作为最新基线，同时保留 `mainline/local-real-mvp` 作为本地主线推进记录。

## 合并前状态

- `main`：`b58b31d`，与 `origin/main` 同步。
- `mainline/local-real-mvp`：`56cad2b`，领先 `main` 63 个提交。
- 当前 M54 路线文档已先提交到 `mainline/local-real-mvp`：
  - `docs/stages/local-real-mvp-m54-agentic-conversation-workbench-plan.md`
  - `docs/ui/frontend-workbench/local-real-mvp-m54a-frontend-workbench-roadmap.md`
  - `docs/stages/local-real-mvp-m54b-agentic-conversation-roadmap.md`

## 合并动作

在 `E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main` 执行：

```text
git merge --ff-only mainline/local-real-mvp
```

结果：

- `main` 从 `b58b31d` fast-forward 到 `56cad2b`。
- 未产生合并冲突。
- 合并后 `main` 与本地 `mainline/local-real-mvp` 一致。

## 验证记录

合并前在 `mainline/local-real-mvp`：

| 命令 | 结果 |
| --- | --- |
| `npm test` | 通过；Node TAP 128/128，Vitest 25 files / 100 tests |
| `npm run build` | 通过；Next.js production build 成功 |
| stale worker check | 未发现 Vitest/Jest/Playwright 残留 Node 进程 |

合并后在 `main`：

| 命令 | 结果 |
| --- | --- |
| `npm test` | 第一次失败，原因是该 worktree 未安装合并后新增依赖 `jszip` / `pptxgenjs`，且 Windows checkout 将 fixture markdown 转为 CRLF |
| `npm install` | 通过，安装 lockfile 依赖 |
| `.gitattributes` 固定 `fixtures/ppt/*.md text eol=lf` | 已补充，防止 Windows worktree 行尾漂移 |
| `npm test` | 通过；Node TAP 128/128，Vitest 25 files / 100 tests |
| `npm run build` | 通过；Next.js production build 成功 |
| stale worker check | 未发现 Vitest/Jest/Playwright 残留 Node 进程 |

## 主线治理结论

- 现在 `main` 已成为最新可演示和部署准备基线。
- `mainline/local-real-mvp` 与 `main` 本地应继续保持对齐。
- M54 起的两条能力路线仍然存在，但只是同一 Git 主线下的并行能力子主线：
  - 前端聊天式工作台：`docs/ui/frontend-workbench/local-real-mvp-m54a-frontend-workbench-roadmap.md`
  - 后端对话智能体：`docs/stages/local-real-mvp-m54b-agentic-conversation-roadmap.md`
- 旧 `feature/mvp-*` 和 `integration/unified-mainline` 只作为历史追溯，不再承接新开发。

## 未执行动作

- 未 push 到远程。
- 未删除旧分支或旧 worktree。
- 未运行真实 provider 生成。

## 下一步

1. 将 `.gitattributes` 和本报告提交到 `main`。
2. 将该提交同步回 `mainline/local-real-mvp`，保持本地两条主线引用一致。
3. 用户确认后，再决定是否 push `main` 和 `mainline/local-real-mvp` 到远程。
4. 后续开发从最新 `main` 或与其对齐的 `mainline/local-real-mvp` 开始，但不再从旧 feature 分支继续。
