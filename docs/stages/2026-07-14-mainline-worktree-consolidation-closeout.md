# 主线、分支与工作目录收敛 Closeout

完成时间：2026-07-14

状态：`complete / one local branch / one remote branch / one worktree`

## 1. 完成结果

项目代码入口已收敛为：

```text
代码目录：E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main
本地分支：main
远端分支：origin/main
Git worktree：main\
```

`main` 先从`44f8241`以`--ff-only`快进到完整检查点`94002b9`，再通过治理提交`8787c0a`固化入口文档、旧口径勘误、R5/互动课件回归断言和V1后Codex SDK候选文档。远端同步后`main...origin/main=0/0`。

## 2. 已删除本地分支

```text
feature/mvp-agent-runtime-adapter
feature/mvp-backend-workflow-lite
feature/mvp-e2e-verification
feature/mvp-frontend-api-backed-workbench
integration/unified-mainline
mainline/local-real-mvp
codex/v1-9r-control-plane
codex/post-v1-planning-checkpoint
```

上述提交均由`main`可达后才删除。本地`mainline/local-real-mvp`因远端上游长期落后而需要`-D`，删除前再次确认其HEAD`1bf826b`是`main`祖先，没有独有提交。

## 3. 已删除远端分支

一次`git push --atomic`同时更新`origin/main`并删除：

```text
feature/mvp-agent-runtime-adapter
feature/mvp-backend-workflow-lite
feature/mvp-e2e-verification
feature/mvp-frontend-api-backed-workbench
integration/unified-mainline
mainline/local-real-mvp
codex/v1-9r-control-plane
ChatGPT/codex-sdk-v1-design
ChatGPT/post-v1-codex-mcp-architecture
master
```

两条`ChatGPT/*`分支删除前，最终候选文档已保留为`docs\architecture\用Codex-SDK加强shanhai-studio-V1.md`并加入架构索引。旧`master`只有已被当前项目取代的初始README，远端默认入口保持`main`。

## 4. Worktree与进程治理

- 混合人工预览和其浏览器已停止，端口3231释放。
- detached worktree `E:\desktop\AI\1000_temp\shanhai-ui-review-aed4d55`在工作树干净、HEAD`aed4d55`由`main`可达后使用非强制`git worktree remove`移除。
- 最终`git worktree list`只有权威`main\`目录。

## 5. 代码与文档修正

- 补齐互动课件规格基础切片、SQLite隔离测试和后续规划。
- 将Stage 7固定节点列表更新为包含`interactive_courseware_spec`。
- 删除“批准需求后自动生成教材证据”的旧测试期望，与已关闭的`advanceM2AfterApproval`路径一致。
- 重写当前主线入口，纠正旧工作区和旧分支指令。
- 保留历史`local-real-mvp.md`正文，仅增加当前入口勘误。
- 更新本机生产准备runbook的代码目录，并指向现行V1邀请制发布runbook。

## 6. 验证证据

```text
互动课件定向：1 file / 6 tests passed
控制面定向：4 files / 17 tests passed
受影响回归：3 files / 14 tests passed
Node：284 / 284 passed
Vitest：128 files / 965 tests passed
TypeScript：passed
Next production build：14 pages passed
git diff --check：passed
```

生产构建保留5条既有动态文件模式警告，没有新增构建错误。本阶段未调用真实Provider，未生成图片、视频、PPTX或最终包。

## 7. 保护对象

- `v0.5`、`v1`、`v1.1.0-alpha`、`v1.1.0-alpha.1`标签对象未移动。
- `.env`继续忽略且未进入Git。
- `dev.db`、SQLite sidecar、Artifact、feedback、上传文件和真实交付物未删除或移动。
- `local-real-mvp-mainline\artifact-storage-root`继续作为受保护历史业务数据保留，不是代码入口。
- `test-results\archive`和当前R5文档引用的测试证据未批量清理。

## 8. 残余问题

- 产品状态仍为`V1-9R5 in progress`；唯一R5门仍是Provider稳定完成带Tool的Main Agent Responses和后续结构化文本业务调用。
- R5未关闭前不得进入V1-9真实整包。
- `.next`、`node_modules`、`.tmp`、`output`和`test-results`仍按生成缓存、测试证据或运行数据保留；若后续目标是释放磁盘，需要单独按引用和数据价值分批清理。
- 当前治理不等于单用户线上版已发布。

## 9. 后续恢复入口

后续工作只从以下入口开始：

```text
AGENTS.md
docs\README.md
docs\product\current-requirements-baseline.md
docs\mainlines\current-mainline-status.md
docs\stages\local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-plan.md
```
