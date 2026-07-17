# 项目开发门禁制度化阶段归档

日期：2026-07-17
状态：VERIFIED / CLOSED

本目录保存 `project-development-gates` 阶段退出活动权威时的机器合同、实施计划和测试计划原文。三份原件均来自提交 `88dae43c3cd2d71b792388ad15b93a74d4ac7bac`，迁移前后字节数和 SHA-256 完全一致；映射见 `archive-manifest.json`。

## 关闭证据

- 本地 clean 验证：Node `387/387`；Vitest `1563/1563`，197 个文件；TypeScript、ESLint、生产构建和 `git diff --check` 通过。
- GitHub Actions：`quality-gates` run `29592707672` 成功，绑定 HEAD `88dae43c3cd2d71b792388ad15b93a74d4ac7bac`。
- verification artifact：`dirty=false`，HEAD、tree、working tree digest、policy SHA、stage SHA 与同一候选本机重算一致，五项 required check 的 `exitCode` 均为 `0`。
- GitHub `main` 已将 `quality-gates` 设为 required check；未要求 PR review，`enforce_admins=false`，普通受保护写入禁止 force-push 和删除。

## 证据边界

本阶段只关闭开发防复发门禁，不关闭真实 Provider 连续性、R5、V1-9、完整产品 E2E、教师签收或 release。管理员当前仍可绕过分支保护；后续若要求管理员也不可绕过，必须切换为 `enforce_admins=true` 并采用 PR 合并流程。
