# M71A 项目生命周期与工作台反馈测试计划

日期：2026-07-11

状态：approved for implementation

关联计划：`docs\stages\local-real-mvp-m71a-project-lifecycle-feedback-plan.md`

## 1. 测试目标

验证反馈选中态真实可感知、轻量问候不再触发固定生产链路，以及项目重命名、归档、软删除、回收站和恢复在数据库、权限、路由、浏览器和回退层都可用且不丢失数据。

## 2. 测试分层

| 层级 | 重点 | 命令 |
|---|---|---|
| Node 源码/客户端合同 | 反馈 UI、侧栏交互标记、API request body | `node --test tests/m67-feedback-ui-wiring.test.mjs tests/m51-interaction-polish-and-button-audit.test.mjs tests/workbench-api.test.mjs` |
| Vitest 领域服务 | 问候策略、生命周期矩阵、权限、stale 对账、并发屏障 | `npx vitest run tests/model-main-conversation-agent.test.ts tests/project-lifecycle-service.test.ts --maxWorkers=1` |
| SQLite 升级/回退 | fresh/legacy、两次升级、索引、dry-run、受控恢复 | `node --test tests/project-lifecycle-sqlite-upgrade.test.mjs tests/m71a-project-lifecycle-rollback.test.mjs` |
| 路由合同 | GET view、PATCH、CSRF、同源、401/403/404/409 | `node --test tests/project-lifecycle-routes.test.mjs` |
| 浏览器 | 隔离账号下的反馈状态、桌面与 390px 项目生命周期 | `npm run test:e2e:m67`、`npm run test:e2e:m71a` |
| 阶段回归 | 全量测试与生产构建 | `npm test`、`npm run build` |

## 3. 必测用例

### 3.1 反馈

- 类别、影响程度和已使用快速补充分别有 selected 的 2px 绿色边框、勾选图标和 `aria-pressed=true`。
- Hover 与 selected 不混淆；focus ring 在键盘导航时可见。
- 重复点击同一快速补充不重复写入描述。
- 表单可提交时“提交反馈”为绿色主按钮；提交中与失败重试不破坏原有禁用和草稿保留行为。

### 3.2 轻量问候

- “你好”请求的 model instructions 含轻量问候约束。
- 返回不得带 `toolPlan`、`deliveryPlan`、`shouldRunToolNow=true` 或产物承诺。
- deterministic fallback 只有两句自然问候，询问年级和课题。
- 明确备课请求仍保留既有计划、HumanGate 与小学范围门禁。

### 3.3 生命周期与权限

- legacy 项目升级后字段为 `archivedAt=null`、`deletedAt=null`、`lifecycleVersion=0`。
- active → archive → restore、active → trash → restore、archived → trash 全部正确。
- trash → archive、trash → rename、archived → rename 返回 409。
- no-op 不改 `updatedAt`、排序或 audit。
- lifecycleVersion 不匹配返回 409；旧 archive/trash/restore/rename 重放不能覆盖新状态。
- owner 与 member owner 可操作；editor/viewer 403；非成员与非成员 admin 404 且正文相同。
- admin 列表不自动获得全局项目；已知 ID snapshot 的既有运维读取能力保持。
- stale queued/running conversation job、generation job、agent run 变 failed；未过期 job 继续阻止 archive/trash。
- archive/trash 和任何业务写入并发时，最终没有 non-active 项目的新消息、成员、产物、任务或 audit 漏写。

### 3.4 API、浏览器与回退

- `view=active|archived|trash` 过滤、排序和映射一致；非法 view 400。
- PATCH lifecycle 的 request/response 包含 expectedLifecycleVersion、changed 和项目生命周期摘要。
- password CSRF、跨域 Origin、未登录、403/404/409 路由矩阵正确。
- 双击和铅笔按钮都能重命名；Enter 保存、Escape 取消、blur 保存一次；空/超长不请求。
- archive/trash 均有确认；回收站仅恢复，不出现永久删除。
- 1366px 与 390px 均可完成 rename/archive/trash/restore，无横向溢出。
- 回退脚本 dry-run 与 export 不写库；缺少确认拒绝；apply 后 lifecycle 回到 active；第二次 apply no-op；不删除关联数据或磁盘文件。
- 当前 local-mode 页面发送“你好”完成一次真实模型验收，回复为一到两句自然问候、无完整材料流水线和产物承诺；不在测试记录中写入密钥。

## 4. 通过门槛

- 所有定向和全量命令失败数为 0。
- `npm run build` exit 0。
- 浏览器关键路径完成且 screenshot 可复核。
- reviewer 无 P0/P1。
- `git diff --check` 无空白错误；`next-env.d.ts` 不在 M71A 提交中。
