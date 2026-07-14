# 主线总览

更新时间：2026-07-14

## 1. 当前唯一入口

```text
代码目录：E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main
开发分支：main
远端主线：origin/main
状态入口：docs\mainlines\current-mainline-status.md
```

2026-07-14 已完成本地分支和 worktree 收敛。后续产品、前端、后端、Runtime、E2E、部署与文档工作均从 `main` 当前 HEAD 开始，不再从 `feature/mvp-*`、`integration/unified-mainline`、`mainline/local-real-mvp`、`codex/*` 或 detached worktree 继续开发。

当前产品阶段仍停在 V1-9R5 Provider 健康门；项目治理优先不代表 R5、V1-9 或发布已经通过。

## 2. 当前治理状态

本地目标状态：

| 项目 | 当前口径 |
| --- | --- |
| 本地代码目录 | 仅 `main\` |
| 本地活动分支 | 仅 `main` |
| Git worktree | 仅权威 `main\` 目录 |
| 历史标签 | 保留原对象，不移动、不重写 |
| 历史开发分支 | 内容进入 `main` 后删除 |
| 临时审查目录 | 任务结束、结果回写且工作树干净后移除 |

远端历史分支已在 `origin/main` 包含全部有效内容后删除；最终远端只保留 `origin/main`。详细证据见 `docs\stages\2026-07-14-mainline-worktree-consolidation-closeout.md`。

## 3. 数据与代码边界

集合根下的 `local-real-mvp-mainline\artifact-storage-root` 只保留历史 PPT、图片、视频、feedback 等业务数据，不是代码工作区，也不是后续开发入口。

以下内容不随分支治理删除：

- `.env` 和其他本机配置；
- SQLite、WAL、SHM；
- Artifact、feedback、上传文件和真实交付物；
- `test-results\archive` 及被当前验收文档引用的证据；
- `docs\archive` 和历史阶段报告；
- annotated tags。

## 4. 执行规则

- 常规工作直接在 `main` 上按项目计划实施；需要隔离高风险实验时才创建短生命周期分支。
- 临时分支必须从最新 `main` 创建，完成后经测试进入 `main` 并及时删除。
- 新需求、架构调整和阶段开发继续遵守“需求基线 -> plan -> test-plan -> 实现 -> 集中验收 -> closeout”。
- 不把本地预览、mock、deterministic fixture 或历史证据写成真实 Provider 与发布完成。
- 任何删除、远端分支清理、生产写入和部署继续执行对应授权门。

## 5. 基线验收

主线治理至少执行：

```powershell
npm test
npx tsc --noEmit
npm run build
git diff --check
```

测试和构建结果、分支删除清单、worktree 状态与残余风险必须写入治理 closeout。

## 6. 关联文档

- `docs\product\current-requirements-baseline.md`
- `docs\mainlines\current-mainline-status.md`
- `docs\mainlines\local-real-mvp.md`（历史路线）
- `docs\stages\2026-07-14-mainline-worktree-consolidation-plan.md`
- `docs\stages\2026-07-14-mainline-worktree-consolidation-test-plan.md`
- `docs\runbooks\v1-invited-release-recovery.md`
