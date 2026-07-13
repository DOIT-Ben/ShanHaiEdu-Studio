# ShanHaiEdu V1-8 两用户并发与恢复测试计划

更新时间：2026-07-13

状态：`executed`

## 1. 验收矩阵

| ID | 场景 | 通过标准 |
|---|---|---|
| T8-01 | 双用户授权隔离 | 乙不能读取或写入甲的项目、消息、任务和产物 |
| T8-02 | 跨项目并行租约 | 甲乙项目租约同时成功，不存在全局串行锁 |
| T8-03 | 同项目单写者 | 第二 worker 被拒绝，旧 fencing token 不能提交 |
| T8-04 | 强度隔离 | 两项目档位和 intensityVersion 独立 |
| T8-05 | TurnJob 隔离 | actor、session、fence、强度快照和 FIFO 按项目隔离 |
| T8-06 | GenerationJob 隔离 | inputHash、taskId、状态和结果归属不串线 |
| T8-07 | VideoShot 隔离 | 相同 shotId 可存在于不同项目，选定片段不互相覆盖 |
| T8-08 | 恢复不重提 | 已持久化 taskId 后恢复 submit=0、poll=1 |
| T8-09 | 预算事件隔离 | 预算事件只存在各自项目消息元数据中 |
| T8-10 | 无真实 Provider | 所有并发测试使用夹具，真实请求次数为0 |

## 2. 计划测试文件

- `tests\v1-two-user-concurrency-isolation.test.ts`
- `tests\project-execution-lease.test.ts`
- `tests\generation-job-recovery.test.ts`
- `tests\video-shot-persistence.test.ts`
- `src\server\workbench\__tests__\stage60-conversation-turn-queue.test.ts`

## 3. 阶段门禁

```text
npx tsc --noEmit --pretty false
npx vitest run tests/v1-two-user-concurrency-isolation.test.ts tests/project-execution-lease.test.ts tests/generation-job-recovery.test.ts tests/video-shot-persistence.test.ts src/server/workbench/__tests__/stage60-conversation-turn-queue.test.ts --maxWorkers=1
npm test
npm run build
git diff --check
```

综合测试必须使用隔离 SQLite、两个独立 password actor 和当前目标部署形态的单应用 Prisma singleton。另用第二 client 验证 WAL 可见性；多 client 持租约并行写限制单独登记到 V1-10 部署拓扑门禁。不得调用真实媒体 Provider。无 UI 改动时浏览器项记录为不适用。
