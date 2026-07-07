# Backend Workflow Lite Stage 6 Closeout

日期：2026-07-07

## 1. 阶段目标

Stage 6 目标是完成最小并发与隔离强化：重复 finish 不能改写已完成 run，旧 run 迟到不能覆盖新 run 的当前 node 状态，过期 artifact regenerate 请求必须被拒绝。

## 2. 已完成内容

- 增强 `finishAgentRun(projectId, runId, input)`：
  - 只允许 `status=running` 的 run finish。
  - 非 running run 再次 finish 时抛出 `AgentRun already finished`。
  - 查询同项目同 nodeKey 的 latest run。
  - 旧 run 迟到 finish 时只更新 run 自身，不更新当前 node。
  - latest run failed 时才把 node 标记为 `failed`。
- 增强 finish route：
  - 重复 finish / 已完成 run 返回 409。
- 增强 `regenerateArtifact(projectId, artifactId, input)`：
  - 新增可选 `expectedLatestVersion`。
  - 传入值与当前 latest version 不一致时抛出 `Artifact version conflict`。
- 增强 regenerate route：
  - 接收 `expectedLatestVersion`。
  - version conflict 返回 409。
- 新增 Stage 6 测试：
  - 重复 finish 拒绝。
  - 旧 run 迟到失败不覆盖新 run 的 node in_progress。
  - route 重复 finish 返回 409。
  - stale regenerate expected latest version guard。
  - 项目间 artifact version 独立递增。

## 3. TDD 证据

```text
npm run test:stage6
RED：1 个测试文件，5 个用例中 4 个失败。
失败点：
- 重复 finish 没有被拒绝。
- 旧 run 迟到失败把 node 改成 failed。
- route 重复 finish 返回 200 而不是 409。
- stale regenerate 没有被 expected latest version guard 拒绝。

npm run test:stage6
GREEN：通过，1 个测试文件，5 个用例，失败数 0。
```

## 4. 集中验收

```text
npm run test:stage1
结果：通过，1 个测试文件，4 个用例，失败数 0。

npm run test:stage2
结果：通过，1 个测试文件，6 个用例，失败数 0。

npm run test:stage3
结果：通过，1 个测试文件，7 个用例，失败数 0。

npm run test:stage4
结果：通过，1 个测试文件，6 个用例，失败数 0。

npm run test:stage5
结果：通过，1 个测试文件，7 个用例，失败数 0。

npm run test:stage6
结果：通过，1 个测试文件，5 个用例，失败数 0。

npm run build
结果：通过，Next.js production build exit 0。

git diff --check
结果：通过，exit 0。

真实 API smoke
结果：通过。
验证：
- duplicate finish 返回 409。
- stale regenerate 返回 409。
返回：duplicateFinishStatus=409，staleRegenerateStatus=409。
```

## 5. 审查与处理

自审结论：

- Stage 5 独立审查遗留的 P2 已处理：非 running run 不能重复 finish，旧 run 迟到不会覆盖新 run 对应的当前 node 状态。
- projectId 仍作为所有 run、artifact、snapshot 查询边界，Stage 6 增加了项目间 version counter 隔离测试。
- `expectedLatestVersion` 是可选字段，不破坏 Stage 3 既有 regenerate 调用。
- 409 冲突合同已在 route-level 测试和 HTTP smoke 中验证。

风险记录：

- 本阶段未把 `(projectId,nodeKey,version)` 改为数据库唯一约束。原因：当前开发期 SQLite 使用 `prisma db push`，在已有本地 `dev.db` 上添加唯一约束会触发 `--accept-data-loss` 确认，普通阶段验收不应默认执行潜在破坏性 schema push。
- 后续进入 migration / Postgres 准备阶段时，应通过正式 migration、备份和数据检查再下沉唯一约束。

## 6. 未完成边界

Stage 6 不声明完成以下能力：

- 真正多进程并发写入下的数据库锁与 retry。
- Postgres migration 文件和生产库约束。
- Runtime 长任务队列。
- 前端冲突提示文案。

## 7. 下一阶段建议

Stage 7 进入 Backend Workflow Lite 主线收束：

- 统一 API 合同文档。
- 补齐前端/Runtime 需要的最小 contract examples。
- 做全主线自审：状态真源、snapshot、approve/regenerate、AgentRun、隔离和恢复。
- 判断本主线是否已达到可合并 main 的 backend contract skeleton 标准。
