# 主线、分支与工作目录收敛计划

更新时间：2026-07-14

## 1. 目标

将当前 Git 开发状态收敛为一个权威代码目录和一个活动开发分支：

```text
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main
main
```

收敛后，`main` 必须包含当前 R5 控制面实现、R5 状态文档、互动课件规格基础切片及已接受的后续规划；历史标签保持原提交，不移动、不重写。

## 2. 当前基线

- `main` 位于 `44f8241`。
- `codex/v1-9r-control-plane` 位于 `6087f0b`，比 `main` 领先 2 个提交，但其 Workbench 服务已引用尚未纳入该分支的互动课件规格文件，不能单独作为合并候选。
- `codex/post-v1-planning-checkpoint` 位于 `94002b9`，完整包含上述 2 个提交，并补齐互动课件规格、测试和后续规划，共比 `main` 领先 5 个提交。
- 临时 detached worktree `E:\desktop\AI\1000_temp\shanhai-ui-review-aed4d55` 工作树干净，所指提交已经进入 `main`。
- 两条远端 `origin/ChatGPT/*` 分支指向同一提交，仍有一份 V1 后 Codex SDK 候选架构文档未进入 `main`。

## 3. 范围

1. 关闭本轮人工验收产生的混合预览进程。
2. 在完整检查点 `94002b9` 上执行集中验证。
3. 将 `main` 以 `--ff-only` 快进到完整检查点，不制造不必要的合并提交。
4. 将远端重复分支中的最终 Codex SDK 候选文档以一份正式仓内文件保留。
5. 更新主线状态与文档入口，使 `main` 成为后续唯一恢复点。
6. 删除已完全进入 `main` 的本地历史分支和干净临时 worktree。
7. 在本地收敛和验证完成后，单独执行提交、推送与远端分支删除门。

## 4. 不纳入范围

- 不继续 R5 真实 Provider 黑盒。
- 不执行 V1-9 真实图片、视频、PPTX 或最终包链路。
- 不修改 Main Agent、Tool、HumanGate、Provider 或媒体业务逻辑。
- 不移动历史标签。
- 不删除 `.env`、SQLite、Artifact、feedback、历史交付物或其他业务数据。
- 不把 `local-real-mvp-mainline\artifact-storage-root` 当作代码 worktree 删除；该目录是受保护的历史业务数据。

## 5. 本地分支处理

合并前保留：

```text
main
codex/v1-9r-control-plane
codex/post-v1-planning-checkpoint
```

已经完全进入 `main`，验证后删除：

```text
feature/mvp-agent-runtime-adapter
feature/mvp-backend-workflow-lite
feature/mvp-e2e-verification
feature/mvp-frontend-api-backed-workbench
integration/unified-mainline
mainline/local-real-mvp
```

`main` 快进并验证后删除：

```text
codex/v1-9r-control-plane
codex/post-v1-planning-checkpoint
```

## 6. 远端分支处理

1. 先将完整候选推送到 `origin/main`。
2. 将两条 `origin/ChatGPT/*` 分支中的最终候选文档保留到 `main` 后，删除重复远端分支。
3. 删除已经进入 `origin/main` 的早期 feature、integration 和 local-real-mvp 远端分支。
4. 删除已被 `main` 取代的旧 `origin/master`。
5. 删除已经进入 `main` 的 `origin/codex/v1-9r-control-plane`。

远端删除前再次核对 `origin/HEAD` 仍指向 `origin/main`，并确认不存在未保护的独有提交。

## 7. 风险与回退

- 快进前记录 `main=44f8241` 和候选 `94002b9`；快进失败时停止，不使用强制更新。
- 任何测试、类型检查、构建、隐私检查或文档链接检查失败时，不推送、不删除分支。
- 本地分支只在其提交已由 `main` 可达后删除；远端分支只在 `origin/main` 已包含对应提交或最终文档后删除。
- detached worktree 只在工作树干净且提交已由 `main` 可达时移除。
- 历史标签和业务数据不参与回退操作。

## 8. 完成标准

- 本地只有 `main` 一个活动分支。
- Git worktree 只有权威代码目录 `main`。
- `main` 与 `origin/main` 指向相同已验证提交。
- 所有计划保留的代码和文档由 `main` 可达。
- 旧分支无未保护的独有内容。
- 业务数据、历史标签和用户在途成果保持不变。
