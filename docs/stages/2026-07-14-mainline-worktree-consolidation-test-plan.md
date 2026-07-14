# 主线、分支与工作目录收敛测试计划

更新时间：2026-07-14

## 1. 候选拓扑门

1. `git merge-base --is-ancestor main codex/post-v1-planning-checkpoint` 必须成功。
2. 候选相对 `main` 只能是直线领先，不得同时领先和落后。
3. `codex/post-v1-planning-checkpoint` 必须包含 `codex/v1-9r-control-plane`。
4. 互动课件规格文件必须与 Workbench 服务引用同时存在。
5. `git diff --check main..codex/post-v1-planning-checkpoint` 必须通过。

## 2. 候选代码门

按单 worker 或项目既有资源上限执行：

```powershell
npx vitest run tests\activities\interactive-courseware-spec.test.ts --maxWorkers=1
npx vitest run tests\action-policy.test.ts tests\task-contract.test.ts tests\agent-tools\main-agent-tool-registry.test.ts tests\agent-runtime\main-agent-react-checkpoint.test.ts --maxWorkers=1
npm test
npx tsc --noEmit
npm run build
```

任何失败都必须先归因；不得通过跳过失败测试、启用 deterministic fixture 或删除断言获得通过。

## 3. 文档与隐私门

1. `docs\README.md`、`docs\stages\README.md`、当前需求基线和主线状态入口正常。
2. 新增计划、测试计划和保留的 Codex SDK 候选文档不存在断链。
3. `git diff --check` 通过。
4. 提交前只审查本次差异中的敏感信息，不输出任何密钥值。
5. `.env`、SQLite、Artifact 与 feedback 目录不得进入提交。

## 4. 快进后门

1. `main` 必须包含候选的全部 5 个提交。
2. 工作树必须干净，或只包含本治理阶段明确列出的待提交文档。
3. 所有待删除本地分支必须满足 `git merge-base --is-ancestor <branch> main`。
4. detached worktree 必须干净，且其 HEAD 必须由 `main` 可达。
5. 历史标签的对象 ID 与治理前记录一致。

## 5. 推送与远端清理后门

1. `main...origin/main` 左右计数为 `0 0`。
2. `origin/HEAD` 指向 `origin/main`。
3. 除 `origin/main` 外，不再保留本计划列出的历史远端开发分支。
4. 最终 `git worktree list` 只包含权威 `main` 目录。
5. 最终本地分支列表只包含 `main`。

## 6. 保护性检查

- `v0.5`、`v1`、`v1.1.0-alpha` 和 `v1.1.0-alpha.1` 标签对象 ID 不变。
- `local-real-mvp-mainline\artifact-storage-root` 及其他业务数据目录保持原位。
- 不运行真实 Provider，不创建真实媒体GenerationJob，不产生新的最终包。
