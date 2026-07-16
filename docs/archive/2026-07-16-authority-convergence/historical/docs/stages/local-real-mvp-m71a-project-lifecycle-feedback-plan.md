# M71A 项目生命周期与工作台反馈实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or inline execution task-by-task. Every task uses TDD and has a verification command before moving to the next task.

日期：2026-07-11

状态：approved for implementation

关联需求：RQ-014、`docs\product\2026-07-11-project-lifecycle-and-feedback-polish-requirements.md`

## Goal

完成反馈选中态、轻量问候、项目重命名、归档、软删除、回收站和恢复的真实全栈闭环；不实现永久物理删除。

## Architecture

反馈选中态仅改 `FeedbackDialog` 与现有 controller 的已使用 chip 判断，不改变反馈存储合同。轻量问候继续由真实 `OpenAIMainConversationAgent` 生成，新增严格但非硬编码的 JSON 输出约束；deterministic agent 仅在测试/未配置模型时保持同一自然语气。

项目生命周期与业务进度分离，新增 `archivedAt`、`deletedAt`、`lifecycleVersion`。新增独立 `project-lifecycle-service` 处理版本条件更新、stale job 对账、项目生命周期权限和审计；Repository 的所有业务写操作在同一 Prisma SQLite transaction 内检查 active 生命周期后再写入。侧栏由独立项目条目组件承载选择、重命名与操作菜单，避免在 `<button>` 内嵌套 input 或按钮。

## Tech Stack

Next.js App Router、React 19、TypeScript、Prisma 7 + SQLite/better-sqlite3、Radix Dialog/Popover、lucide-react、Vitest、Node test、Playwright。

## Hard Scope Boundary

- 只修改 M71A 所列前端、工作台、认证授权、SQLite 初始化、路由、测试、阶段文档和回退脚本。
- 禁止修改 `docs\architecture\**`、视频结构化链路、Provider 配置、MCP、部署、真实资产生成逻辑和永久删除。
- 保留现有未提交 `next-env.d.ts`，不读取其语义、不修改、不暂存、不提交。
- 删除只设置 `deletedAt` 并进入回收站；不得调用 Prisma `project.delete`，不得删除磁盘产物。

## File Map

| 文件 | 职责 |
|---|---|
| `prisma\schema.prisma` | Project 生命周期字段与索引 |
| `scripts\init-sqlite-schema.mjs` | 新库建表与旧 SQLite 可重试升级 |
| `src\server\workbench\project-lifecycle-service.ts` | 版本条件更新、stale task 对账、事务内审计、错误类型 |
| `src\server\workbench\repository.ts` | active guard 与实际业务写入放入同一 transaction |
| `src\server\workbench\service.ts` | 生命周期 API 服务、视图列表与 snapshot 映射 |
| `src\server\auth\authorization.ts` | `canManageProjectLifecycle` 与成员/非成员区分 |
| `src\server\auth\project-member-management.ts` | 成员变更 transaction 内 active guard |
| `src\app\api\workbench\projects\route.ts` | `view=active|archived|trash` 列表合同 |
| `src\app\api\workbench\projects\[projectId]\route.ts` | PATCH 生命周期动作与 401/403/404/409 映射 |
| `src\lib\types.ts`、`src\lib\workbench-mappers.ts`、`src\lib\workbench-api.ts` | 浏览器项目生命周期合同与请求客户端 |
| `src\hooks\useWorkbenchController.ts` | 项目视图、列表刷新、冲突/恢复反馈、非 active snapshot 退出 |
| `src\components\layout\ProjectSidebar.tsx` | 活跃/归档/回收站视图与固定底部入口 |
| `src\components\layout\ProjectListItem.tsx` | 独立的选择、双击编辑、铅笔、菜单和键盘行为 |
| `src\components\layout\ProjectLifecycleConfirmDialog.tsx` | 归档/移入回收站确认弹窗 |
| `src\components\layout\MediaWorkbench.tsx` | 为桌面与窄屏 Sidebar 传入生命周期 controller |
| `src\components\feedback\FeedbackDialog.tsx` | 可感知的 selected/focus/hover 状态与绿色提交按钮 |
| `src\server\conversation\model-main-conversation-agent.ts` | 轻量问候 JSON 输出约束 |
| `src\server\conversation\main-conversation-agent.ts` | deterministic fallback 的一致问候语气 |
| `scripts\m71a-project-lifecycle-rollback.mjs` | dry-run、清单导出、受控恢复、幂等回退 |
| `scripts\run-m71a-e2e.mjs` | 隔离 SQLite、临时 Next server 与桌面/390px M71A 浏览器验收 |

---

### Task 1: 定义反馈选中态并锁定回归测试

**Files:**
- Modify: `src\components\feedback\FeedbackDialog.tsx`
- Modify: `tests\m67-feedback-ui-wiring.test.mjs`
- Modify: `tests\e2e\beta-feedback-center.spec.ts`

- [ ] **Step 1: 先写失败测试**

在 `m67-feedback-ui-wiring.test.mjs` 追加断言，要求反馈类别、影响程度和已使用 chip 同时具备 `aria-pressed`、2px 选中边框、勾选图标和可见 focus ring：

```js
assert.match(dialogSource, /aria-pressed=\{controller\.category === option\.id\}/);
assert.match(dialogSource, /data-feedback-chip[\s\S]*aria-pressed=\{controller\.description\.includes\(chip\)\}/);
assert.match(dialogSource, /border-2 border-\[#367d6d\].*bg-\[#eef7f3\]/);
assert.match(dialogSource, /<Check className="h-3\.5 w-3\.5"/);
assert.match(dialogSource, /description\.includes\(chip\)/);
assert.match(dialogSource, /bg-\[#367d6d\].*text-white/);
```

在 Playwright 反馈流程中断言点击类别和 chip 后 `aria-pressed=true`，并用 computed style 或稳定 class 断言 selected 边框宽度为 2px。

- [ ] **Step 2: 运行定向测试，确认红灯**

Run:

```powershell
node --test tests/m67-feedback-ui-wiring.test.mjs
npm run test:e2e:m67
```

Expected: 新增 selected-state 断言失败；既有反馈流程保持可运行。

- [ ] **Step 3: 最小实现选中态**

在 `FeedbackDialog.tsx` 导入 `Check`，为三类选项复用同一类名规则：

```tsx
const selectedChoiceClass = "border-2 border-[#367d6d] bg-[#eef7f3] font-medium text-[#123f33] shadow-[0_0_0_2px_rgba(54,125,109,0.12)]";
const idleChoiceClass = "border border-input bg-background text-muted-foreground hover:border-[#8fcbbb] hover:bg-[#f7fbf9] hover:text-foreground";
```

选中项渲染：

```tsx
<span className="flex min-w-0 flex-1 items-center justify-between gap-2">
  <span>{option.label}</span>
  {selected && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
</span>
```

快速补充的 selected 条件使用 `controller.description.includes(chip)`；继续复用 `appendDescriptionChip` 的去重逻辑。提交按钮仅在可提交时使用：

```tsx
className="border-[#367d6d] bg-[#367d6d] text-white hover:bg-[#286657] active:bg-[#1e5145]"
```

快速补充按钮同时设置：

```tsx
aria-pressed={controller.description.includes(chip)}
```

- [ ] **Step 4: 复跑定向测试**

Run the Step 2 commands.

Expected: Node test 0 failures; E2E 通过并保留图片粘贴、失败重试和 CSRF 行为。

- [ ] **Step 5: 提交反馈体验批次**

```powershell
git add src/components/feedback/FeedbackDialog.tsx tests/m67-feedback-ui-wiring.test.mjs tests/e2e/beta-feedback-center.spec.ts
git commit -m "feat: 强化反馈选中态与提交层级 | v0.10.9 | YYYY-MM-DD HH:MM"
```

### Task 2: 收紧轻量问候输出合同

**Files:**
- Modify: `src\server\conversation\model-main-conversation-agent.ts`
- Modify: `src\server\conversation\main-conversation-agent.ts`
- Modify: `tests\model-main-conversation-agent.test.ts`

- [ ] **Step 1: 写失败的模型请求与 deterministic 回退测试**

新增两个测试：

```ts
it("requires a short natural greeting without plans or tool output", async () => {
  const agent = new OpenAIMainConversationAgent({ client: fakeResponsesClient(greetingOutput), model: "test-model" });
  const turn = await agent.respond({ userMessage: "你好", availableArtifactKinds: [] });
  expect(client.lastPayload?.instructions).toContain("轻量问候");
  expect(turn.toolPlan).toBeUndefined();
  expect(turn.deliveryPlan).toBeUndefined();
  expect(turn.shouldRunToolNow).toBe(false);
  expect(turn.assistantMessage.body).not.toMatch(/教案、PPT、图片、视频和最终交付包/);
});

it("keeps deterministic casual chat to two short sentences", async () => {
  const turn = await createDeterministicMainConversationAgent().respond({ userMessage: "你好", availableArtifactKinds: [] });
  expect(turn.assistantMessage.body).toBe("你好，我在。你今天想准备哪一节课？告诉我年级和课题就可以开始。");
  expect(turn.toolPlan).toBeUndefined();
  expect(turn.deliveryPlan).toBeUndefined();
});
```

- [ ] **Step 2: 运行红灯测试**

Run:

```powershell
npx vitest run tests/model-main-conversation-agent.test.ts --maxWorkers=1
```

Expected: 新 deterministic 文案和 instruction 断言失败。

- [ ] **Step 3: 修改主 Agent 指令和 fallback**

在 `buildMainAgentRequest` instructions 中加入以下可验证约束：

```text
用户只输入问候或极短社交语时，回复限制为一到两句：先自然回应，再只追问年级、学科或课题中的一个最容易回答的信息。此时 toolPlan、deliveryPlan、shouldRunToolNow 和产物承诺必须为空或 false；不要列出教案、PPT、图片、视频或材料包流程。
```

将 deterministic `isCasualChat` 分支正文改为：

```ts
body: "你好，我在。你今天想准备哪一节课？告诉我年级和课题就可以开始。"
```

并删除该分支的固定“做公开课课件”快捷回复，返回空 `quickReplies`，避免再次把对话锁进固定流程。

- [ ] **Step 4: 复跑测试**

Run the Step 2 command.

Expected: 通过，且小学范围、pending plan 与 provider 不可用测试不回归。

- [ ] **Step 5: 提交问候策略批次**

```powershell
git add src/server/conversation/model-main-conversation-agent.ts src/server/conversation/main-conversation-agent.ts tests/model-main-conversation-agent.test.ts
git commit -m "fix: 优化轻量问候对话策略 | v0.10.9 | YYYY-MM-DD HH:MM"
```

### Task 3: 增加生命周期字段、SQLite 升级和回退脚本

**Files:**
- Modify: `prisma\schema.prisma`
- Modify: `scripts\init-sqlite-schema.mjs`
- Create: `scripts\m71a-project-lifecycle-rollback.mjs`
- Create: `tests\project-lifecycle-sqlite-upgrade.test.mjs`
- Create: `tests\m71a-project-lifecycle-rollback.test.mjs`

- [ ] **Step 1: 写数据库升级和回退脚本失败测试**

测试必须创建 legacy SQLite `Project` 表并插入既有项目，再运行 `db:init` 两次，断言：

```js
assert.deepEqual(projectColumns.filter((name) => ["archivedAt", "deletedAt", "lifecycleVersion"].includes(name)), ["archivedAt", "deletedAt", "lifecycleVersion"]);
assert.equal(project.lifecycleVersion, 0);
assert.equal(project.archivedAt, null);
assert.equal(project.deletedAt, null);
assert.equal(indexes.some((index) => index.name === "Project_archivedAt_deletedAt_updatedAt_idx"), true);
```

回退脚本测试必须覆盖：默认 dry-run 不更新行、`--export` 只输出 id/state/version、缺少 `--apply` 或确认环境变量返回非零、受控 apply 清空时间字段并保留关系、第二次 apply 是 no-op。

- [ ] **Step 2: 运行红灯测试**

Run:

```powershell
node --test tests/project-lifecycle-sqlite-upgrade.test.mjs tests/m71a-project-lifecycle-rollback.test.mjs
```

Expected: 生命周期列、索引和脚本不存在导致失败。

- [ ] **Step 3: 最小 schema、升级和脚本实现**

`Project` 模型增加：

```prisma
archivedAt       DateTime?
deletedAt        DateTime?
lifecycleVersion Int       @default(0)

@@index([archivedAt, deletedAt, updatedAt])
```

初始化脚本增加：

```js
ensureColumn(db, "Project", "archivedAt", 'ALTER TABLE "Project" ADD COLUMN "archivedAt" DATETIME');
ensureColumn(db, "Project", "deletedAt", 'ALTER TABLE "Project" ADD COLUMN "deletedAt" DATETIME');
ensureColumn(db, "Project", "lifecycleVersion", 'ALTER TABLE "Project" ADD COLUMN "lifecycleVersion" INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE INDEX IF NOT EXISTS "Project_archivedAt_deletedAt_updatedAt_idx" ON "Project"("archivedAt", "deletedAt", "updatedAt")');
```

回退脚本必须拒绝直接 apply，执行条件固定为：

```text
node scripts/m71a-project-lifecycle-rollback.mjs --apply --confirm RESTORE_ALL_PROJECTS
SHANHAI_M71A_BACKUP_CONFIRMED=YES
```

SQL 只允许：

```sql
UPDATE "Project" SET "archivedAt" = NULL, "deletedAt" = NULL, "lifecycleVersion" = "lifecycleVersion" + 1
WHERE "archivedAt" IS NOT NULL OR "deletedAt" IS NOT NULL;
```

脚本在 transaction 中执行并输出计数，不读取、不输出项目标题、消息、产物、路径或密钥。

- [ ] **Step 4: 生成 Prisma Client 并复跑测试**

Run:

```powershell
npx prisma generate
node --test tests/project-lifecycle-sqlite-upgrade.test.mjs tests/m71a-project-lifecycle-rollback.test.mjs
```

Expected: Prisma generate exit 0；两套 Node 测试 0 failures。

- [ ] **Step 5: 提交数据库和回退脚本批次**

```powershell
git add prisma/schema.prisma scripts/init-sqlite-schema.mjs scripts/m71a-project-lifecycle-rollback.mjs tests/project-lifecycle-sqlite-upgrade.test.mjs tests/m71a-project-lifecycle-rollback.test.mjs
git commit -m "feat: 增加项目生命周期数据库与回退脚本 | v0.10.9 | YYYY-MM-DD HH:MM"
```

### Task 4: 实现项目生命周期领域服务、权限和 stale 对账

**Files:**
- Create: `src\server\workbench\project-lifecycle-service.ts`
- Modify: `src\server\auth\authorization.ts`
- Modify: `src\server\workbench\types.ts`
- Modify: `src\server\workbench\repository.ts`
- Modify: `src\server\workbench\service.ts`
- Create: `tests\project-lifecycle-service.test.ts`

- [ ] **Step 1: 写领域服务失败测试**

测试必须覆盖：状态矩阵、版本冲突、no-op 审计、成员权限、stale 任务和事务回滚。关键测试结构：

```ts
await expect(service.mutateProjectLifecycle(project.id, { action: "archive", expectedLifecycleVersion: 0 })).resolves.toMatchObject({ changed: true, project: { lifecycleState: "archived", lifecycleVersion: 1 } });
await expect(service.mutateProjectLifecycle(project.id, { action: "trash", expectedLifecycleVersion: 0 })).rejects.toMatchObject({ code: "project_version_conflict", status: 409 });
await expect(service.mutateProjectLifecycle(project.id, { action: "rename", title: "新标题", expectedLifecycleVersion: 1 })).rejects.toMatchObject({ code: "project_lifecycle_conflict", status: 409 });
```

使用固定 `now` 创建以下 stale 数据：queued ConversationTurnJob 无 lease、running ConversationTurnJob 过期 lease、30 分钟未更新的 GenerationJob、30 分钟未结束 AgentRun；断言生命周期操作先把它们标记 failed，再允许 archive。

并发屏障测试使一个业务写 transaction 在 active guard 后暂停，另一个 lifecycle mutation 竞争；断言最终只能有一个提交，且不存在 archived project 的新消息、产物或审计漏写。

- [ ] **Step 2: 运行红灯测试**

Run:

```powershell
npx vitest run tests/project-lifecycle-service.test.ts --maxWorkers=1
```

Expected: module、字段和服务方法不存在导致失败。

- [ ] **Step 3: 定义领域合同和权限**

在 `workbench/types.ts` 增加：

```ts
export type ProjectLifecycleState = "active" | "archived" | "trash";
export type ProjectLifecycleAction = "rename" | "archive" | "trash" | "restore";
export type ProjectLifecycleMutation = { action: ProjectLifecycleAction; expectedLifecycleVersion: number; title?: string };
```

`ProjectRecord` 增加 `lifecycleState`、`lifecycleVersion`、`archivedAt`、`deletedAt`。

在 `authorization.ts` 增加：

```ts
export function canManageProjectLifecycle(project: ProjectLike, actor?: WorkbenchActor) {
  if (!actor) return true;
  if (project.ownerUserId === actor.userId) return true;
  if (!project.ownerUserId && resolveActorAuthMode(actor) === "local") return true;
  return getProjectMembershipRole(actor, project.id) === "owner";
}
```

系统 admin 不得因 `isAdmin` 自动通过该方法。

- [ ] **Step 4: 实现 transaction 内生命周期变更和业务写 guard**

`project-lifecycle-service.ts` 暴露：

```ts
export class ProjectLifecycleError extends Error {
  constructor(readonly code: "project_not_found" | "project_forbidden" | "project_version_conflict" | "project_lifecycle_conflict" | "project_busy", readonly status: 403 | 404 | 409, message: string) { super(message); }
}

export async function mutateProjectLifecycle(input: {
  projectId: string;
  actor: WorkbenchActor;
  mutation: ProjectLifecycleMutation;
  now?: Date;
}): Promise<{ changed: boolean; project: ProjectRecord }>;
```

实现必须在单一 `prisma.$transaction` 中完成以下顺序：读取项目和 membership、执行 `reconcileStaleProjectJobs`、检查授权、检查 `expectedLifecycleVersion`、检查 pending jobs、按矩阵 `updateMany({ where: { id, lifecycleVersion }, data })`、写审计、重新读取项目。`updateMany.count !== 1` 必须转为 409 版本冲突。

`reconcileStaleProjectJobs` 仅在生命周期 transaction 中运行，并使用以下更新条件：

```ts
await tx.conversationTurnJob.updateMany({
  where: { projectId, status: { in: ["queued", "running"] }, updatedAt: { lte: staleBefore }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
  data: { status: "failed", errorCode: "lifecycle_stale", errorMessage: "这项未完成的生成已超时，请重新发起。", finishedAt: now, lockedBy: null, lockedUntil: null },
});
```

对 GenerationJob 和 AgentRun 采用相同 `updatedAt`/`startedAt` 30 分钟阈值。不得重新领取、不得调用外部 Provider。

Repository 中每个业务写方法改为在其已存在或新增的 transaction 内调用：

```ts
await assertActiveProjectForWrite(tx, projectId);
```

覆盖 `addMessage`、`updateMessageMetadata`、`saveArtifact`、`approveArtifact`、`regenerateArtifact`、agent run、generation job、conversation turn job 和 message+turn 原子入队。`project-member-management.ts` 的 add/update/remove 成员 transaction 同样调用 active guard。所有 guard 失败返回 `ProjectLifecycleError`，不会在归档/回收站项目写入。

- [ ] **Step 5: 复跑领域测试**

Run the Step 2 command.

Expected: 状态矩阵、版本冲突、权限、stale 对账、事务原子性测试通过。

- [ ] **Step 6: 提交生命周期领域批次**

```powershell
git add prisma/schema.prisma scripts/init-sqlite-schema.mjs scripts/m71a-project-lifecycle-rollback.mjs src/server/auth/authorization.ts src/server/auth/project-member-management.ts src/server/workbench/project-lifecycle-service.ts src/server/workbench/repository.ts src/server/workbench/service.ts src/server/workbench/types.ts tests/project-lifecycle-sqlite-upgrade.test.mjs tests/m71a-project-lifecycle-rollback.test.mjs tests/project-lifecycle-service.test.ts
git commit -m "feat: 增加项目归档与回收站生命周期 | v0.10.9 | YYYY-MM-DD HH:MM"
```

### Task 5: 接通项目列表、PATCH 路由与浏览器数据合同

**Files:**
- Modify: `src\app\api\workbench\projects\route.ts`
- Modify: `src\app\api\workbench\projects\[projectId]\route.ts`
- Modify: `src\app\api\workbench\projects\[projectId]\snapshot\route.ts`
- Modify: `src\lib\types.ts`
- Modify: `src\lib\workbench-mappers.ts`
- Modify: `src\lib\workbench-api.ts`
- Modify: `tests\workbench-api.test.mjs`
- Create: `tests\project-lifecycle-routes.test.mjs`

- [ ] **Step 1: 写路由和浏览器客户端失败测试**

路由测试矩阵至少包含：

```js
GET /api/workbench/projects?view=active -> 200
GET /api/workbench/projects?view=unknown -> 400
PATCH rename with missing expectedLifecycleVersion -> 400
PATCH with stale version -> 409 and project lifecycle summary
PATCH non-member -> 404 body equals missing-project body
PATCH editor/viewer -> 403
PATCH password mode without csrf -> 403
PATCH cross-site origin -> 403
```

客户端测试必须断言：

```js
await client.listProjects("trash");
await client.mutateProjectLifecycle("project-a", { action: "restore", expectedLifecycleVersion: 3 });
assert.equal(calls[0].url, "https://example.test/api/workbench/projects?view=trash");
assert.deepEqual(JSON.parse(calls[1].init.body), { action: "restore", expectedLifecycleVersion: 3 });
assert.equal(calls[1].init.method, "PATCH");
```

- [ ] **Step 2: 运行红灯测试**

Run:

```powershell
node --test tests/project-lifecycle-routes.test.mjs tests/workbench-api.test.mjs
```

Expected: view 参数、PATCH 路由、浏览器客户端方法和映射字段缺失导致失败。

- [ ] **Step 3: 实现 API 和客户端合同**

列表路由只接受：

```ts
const view = new URL(request.url).searchParams.get("view") ?? "active";
if (!["active", "archived", "trash"].includes(view)) return NextResponse.json({ error: "项目列表暂时没有取回，请刷新后重试。" }, { status: 400 });
```

`[projectId]/route.ts` 增加 PATCH，使用 `ProjectLifecycleError.status` 映射 403/404/409；所有 404 返回同一教师文案。`ProjectItem` 和 `BackendProjectRecord` 增加：

```ts
lifecycleState: "active" | "archived" | "trash";
lifecycleVersion: number;
archivedAt: string | null;
deletedAt: string | null;
```

`WorkbenchDataSource` 增加：

```ts
export type ProjectLifecycleState = "active" | "archived" | "trash";
export type ProjectLifecycleMutation = { action: "rename" | "archive" | "trash" | "restore"; expectedLifecycleVersion: number; title?: string };

listProjects: (view?: ProjectLifecycleState) => Promise<ProjectItem[]>;
mutateProjectLifecycle: (projectId: string, mutation: ProjectLifecycleMutation) => Promise<{ changed: boolean; project: ProjectItem }>;
```

这些是浏览器专用镜像类型，不能从 `src\server\workbench\types.ts` 导入，避免客户端 bundle 引入服务端实现。

Mock adapter 必须按相同状态矩阵更新 seed 项目，保证显式 mock 开关仍能运行；默认 API data source 不得退回 mock。

- [ ] **Step 4: 复跑路由与客户端测试**

Run the Step 2 command.

Expected: 所有路由状态、CSRF、跨域、映射和客户端 body 断言通过。

- [ ] **Step 5: 提交 API 与客户端合同批次**

```powershell
git add src/app/api/workbench/projects/route.ts src/app/api/workbench/projects/[projectId]/route.ts src/app/api/workbench/projects/[projectId]/snapshot/route.ts src/lib/types.ts src/lib/workbench-mappers.ts src/lib/workbench-api.ts tests/project-lifecycle-routes.test.mjs tests/workbench-api.test.mjs
git commit -m "feat: 接通项目生命周期接口合同 | v0.10.9 | YYYY-MM-DD HH:MM"
```

### Task 6: 实现 controller、侧栏条目和确认交互

**Files:**
- Create: `src\components\layout\ProjectListItem.tsx`
- Create: `src\components\layout\ProjectLifecycleConfirmDialog.tsx`
- Modify: `src\components\layout\ProjectSidebar.tsx`
- Modify: `src\components\layout\MediaWorkbench.tsx`
- Modify: `src\hooks\useWorkbenchController.ts`
- Modify: `tests\m51-interaction-polish-and-button-audit.test.mjs`
- Create: `tests\m71a-project-sidebar-contract.test.ts`
- Create: `tests\e2e\m71a-project-lifecycle.spec.ts`
- Create: `scripts\run-m71a-e2e.mjs`
- Modify: `package.json`

- [ ] **Step 1: 写侧栏和 controller 的失败测试**

合同测试需覆盖：

```ts
expect(projectItemSource).toContain("onDoubleClick");
expect(projectItemSource).toContain('aria-label="重命名项目"');
expect(projectItemSource).toContain('aria-label="项目操作"');
expect(projectItemSource).toContain("event.key === \"Enter\"");
expect(projectItemSource).toContain("event.key === \"Escape\"");
expect(sidebarSource).toContain("已归档");
expect(sidebarSource).toContain("回收站");
expect(sidebarSource).not.toContain("showDisabledUtilities");
```

Playwright 流程：新建项目 → 双击标题 → 填写新标题 → Enter → 刷新仍存在；项目菜单 archive → 已归档列表出现 → restore → active 出现；trash → 回收站出现 → restore → active 出现。窄屏 390px 在 Sheet 内重复 rename 与 restore。删除确认文案必须包含“会进入回收站，可以恢复”。

- [ ] **Step 2: 运行红灯测试**

Run:

```powershell
npx vitest run tests/m71a-project-sidebar-contract.test.ts --maxWorkers=1
node --test tests/m51-interaction-polish-and-button-audit.test.mjs
npm run test:e2e:m71a
```

Expected: 新组件、props、回收站入口与生命周期浏览器流程缺失。

- [ ] **Step 3: 实现 controller 视图与生命周期操作**

`useWorkbenchController` 新增：

```ts
const [projectView, setProjectView] = useState<ProjectLifecycleState>("active");
async function openProjectView(view: ProjectLifecycleState) {
  const items = await dataSource.listProjects(view);
  setProjectView(view);
  setProjects(items);
  if (view !== "active") {
    setActiveProjectId("");
    window.localStorage.removeItem(activeProjectStorageKey);
    setMessages([]);
    setArtifacts([]);
    setTurnJobs([]);
  }
}
async function mutateProjectLifecycle(projectId: string, mutation: ProjectLifecycleMutation) {
  const result = await dataSource.mutateProjectLifecycle(projectId, mutation);
  await openProjectView(projectView);
  if (result.project.lifecycleState !== "active" && projectId === activeProjectId) await openProjectView("active");
}
```

当 active snapshot 返回 archived/trash 时执行：清空消息/产物/任务、移除 localStorage active id、刷新 active 列表、选择第一项或欢迎空态；409 版本冲突显示“项目状态已变化，请刷新后再操作。”，不自动重放。

- [ ] **Step 4: 实现侧栏组件**

`ProjectListItem` 使用非按钮容器，内部控件分离：

```tsx
<div className="group relative rounded-md" data-project-id={project.id}>
  <button type="button" onClick={() => onSelect(project.id)} aria-current={active ? "page" : undefined} className="w-full text-left">{project.title}</button>
  <Button type="button" variant="ghost" size="icon" aria-label="重命名项目" title="重命名项目" onClick={startRename}><Pencil /></Button>
  <Popover>
    <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label="项目操作" title="项目操作"><MoreHorizontal /></Button></PopoverTrigger>
    <PopoverContent align="end" className="w-36 p-1">
      <button type="button" onClick={startRename}>重命名</button>
      <button type="button" onClick={() => onRequestLifecycle(project, "archive")}>归档</button>
      <button type="button" onClick={() => onRequestLifecycle(project, "trash")}>移入回收站</button>
    </PopoverContent>
  </Popover>
</div>
```

编辑 input 行为：Enter 调 `onRename(project, title)` 后屏蔽紧接 blur；Escape 恢复原 title 并屏蔽 blur；空白或超过 80 字符只显示就地错误，不发 PATCH。归档/回收站动作通过 `ProjectLifecycleConfirmDialog` 确认。

`ProjectSidebar` 固定底部渲染：

```tsx
<Button variant="ghost" onClick={() => onViewChange("archived")}><Archive /></Button>
<Button variant="ghost" onClick={() => onViewChange("trash")}><Trash2 /></Button>
<ProfileMenu currentUser={currentUser} projectId={activeProjectId || undefined} compact={collapsed} onOpenFeedback={onOpenFeedback} onOpenUserManagement={onOpenUserManagement} onLogout={onLogout} />
```

在 `MediaWorkbench` 将同一 controller callbacks 同时传给桌面与移动 Sheet Sidebar，保证相同行为。

`run-m71a-e2e.mjs` 必须仿照 `run-m67-e2e.mjs` 创建 `test-results\m71a-e2e-{pid}-{timestamp}` 临时根目录、isolated SQLite、artifact root、保留 child ownership 的 cleanup 和随机可用端口；其环境固定为：

```js
DATABASE_URL: `file:${databasePath}`,
ARTIFACT_STORAGE_ROOT: artifactRoot,
NEXT_PUBLIC_WORKBENCH_DATA_SOURCE: "api",
NEXT_PUBLIC_SHANHAI_AUTH_MODE: "local",
SHANHAI_AUTH_MODE: "local",
SHANHAI_DB_INIT_SKIP_DOTENV: "1",
PLAYWRIGHT_WORKERS: "1",
CI: "1",
```

runner 初始化 schema 后执行 `tests/e2e/m71a-project-lifecycle.spec.ts` 的 `chromium-desktop` 和 `chromium-narrow`。`package.json` 增加：

```json
"test:e2e:m71a": "node scripts/run-m71a-e2e.mjs"
```

- [ ] **Step 5: 复跑侧栏定向测试与浏览器流**

Run the Step 2 commands.

Expected: 桌面与 390px 操作完成；无嵌套 interactive DOM、无溢出、无 runtime error。

- [ ] **Step 6: 提交客户端生命周期批次**

```powershell
git add package.json scripts/run-m71a-e2e.mjs src/components/layout/ProjectListItem.tsx src/components/layout/ProjectLifecycleConfirmDialog.tsx src/components/layout/ProjectSidebar.tsx src/components/layout/MediaWorkbench.tsx src/hooks/useWorkbenchController.ts tests/m51-interaction-polish-and-button-audit.test.mjs tests/m71a-project-sidebar-contract.test.ts tests/e2e/m71a-project-lifecycle.spec.ts
git commit -m "feat: 支持项目重命名归档与回收站 | v0.10.9 | YYYY-MM-DD HH:MM"
```

### Task 7: 阶段验收、回退演练和收尾

**Files:**
- Create: `docs\stages\local-real-mvp-m71a-project-lifecycle-feedback-closeout.md`
- Modify: `docs\mainlines\current-mainline-status.md`
- Modify: `docs\product\requirements-backlog.md`

- [ ] **Step 1: 执行完整验证**

Run:

```powershell
npm test
npm run build
git diff --check
graphify update .
```

Expected: Node 与 Vitest 均为 0 failures，构建 exit 0，diff 无空白错误，图谱更新成功。

- [ ] **Step 2: 执行浏览器与回退验证**

在隔离 SQLite 数据库执行回退脚本 dry-run、导出、拒绝 apply、受控 apply、幂等复跑。通过 Playwright 截图验证：

```text
output\playwright\m71a-feedback-selected.png
output\playwright\m71a-project-lifecycle-desktop.png
output\playwright\m71a-project-lifecycle-mobile-390.png
```

检查 feedback 默认/hover/focus/selected、轻量问候、重命名 Enter/Escape/blur、archive/trash/restore、侧栏底部顺序、390px 无横向溢出。

在当前 local-mode 页面用“你好”完成一次真实主对话请求，确认回复为一到两句自然问候、不含完整材料流水线、不出现产物承诺；截图保存到 `output\playwright\m71a-greeting-live.png`。该检查是一次真实模型调用，执行前不读取或回显 API 密钥。

- [ ] **Step 3: 更新 closeout 与主线状态**

closeout 必须记录测试精确数量、build 结果、browser viewport、回退脚本演练、graphify 数字、未实现永久删除和仍未关闭的生产门禁。主线状态将 M71A 改为 `done`，下一阶段恢复生产门禁/真实 provider smoke。

- [ ] **Step 4: 最终 review 与提交**

请求只读 reviewer 审查当前 diff，修复所有 P0/P1 后重新执行 Step 1。提交时只包含 M71A 文件：

```powershell
git status --short
```

不得 push。确认 `next-env.d.ts` 仍不在 staged 文件中。
