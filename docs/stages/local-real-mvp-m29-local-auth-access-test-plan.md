# Local Real MVP M29 Local Auth Access Test Plan

日期：2026-07-07

## 1. 测试目标

M29 测试目标是证明本地账号/权限最小闭环成立：浏览器会话能获得本地用户身份，新项目归属当前用户，项目列表和所有项目读写入口按 actor 过滤，跨会话不能读取、确认、重做、生成或下载对方项目内容。

## 2. TDD 红灯用例

### M29-1：本地会话 helper

命令：

```powershell
node --test tests\local-session-auth.test.mjs
```

红灯标准：

- 模块不存在或函数不存在时失败。
- 缺 cookie 的请求应生成新的本地 actor。
- helper 应在响应上设置 `shanhai_local_user` httpOnly cookie。
- 带 cookie 的请求应复用相同 actor，不重新生成。
- 非法 cookie 应被丢弃并重新生成。

### M29-2：service 项目访问策略

命令：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage29-local-auth-access.test.ts --maxWorkers=1
```

红灯标准：

- `createWorkbenchService(repository, actorA).createProject(...)` 创建的项目必须写入 `ownerUserId = actorA.userId`。
- actorA 的 `listProjects` 能看到自己的项目。
- actorB 的 `listProjects` 看不到 actorA 的项目。
- actorB 调 `getProjectSnapshot`、`addMessage`、`approveArtifact`、`regenerateArtifact`、`getArtifact` 必须失败。
- owner 为空的历史项目仍可被 actorA 读取，保持本地兼容。

## 3. 集中验收命令

### M29-3：全量测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M29-4：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma generate、Next 编译、TypeScript、静态页面生成均通过。
- 如仍有 Turbopack output tracing warning，记录来源，不把 warning 包装成已消除。

### M29-5：浏览器隔离回归

命令：

```powershell
npm run test:e2e:stage7
```

通过标准：

- 两个 browser context 分别创建项目。
- A/B 项目列表、消息、产物和刷新恢复不串。

### M29-6：真实生成浏览器回归

命令：

```powershell
node scripts\run-stage27-e2e.mjs
```

通过标准：

- 教师真实生成入口、刷新、PPTX/PNG/MP4 下载和材料包联动不回归。

### M29-7：提交前审查

命令：

```powershell
git diff --check
git check-ignore -v .env .tmp
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -like '*local-real-mvp-mainline*' -and $_.CommandLine -match 'vitest|jest|playwright|next dev' }
```

通过标准：

- 无空白错误。
- `.env`、`.tmp` 不进入 git。
- 文档、测试、脚本和服务端代码不包含真实 key、token、私有端点、签名 URL 或任务标识值。
- 当前 worktree 无残留测试/dev 进程。

## 4. 失败处理

- 如果 E2E 因新 cookie 机制失败，优先检查 route 是否给创建项目响应设置 cookie。
- 如果跨用户仍能读项目，优先检查 service 是否在对应方法调用 `ensureProjectAccess`。
- 如果下载 route 绕过权限，优先检查 route 是否用带 actor 的 service 先读取 artifact。
- 如果旧项目不可见，检查 `ownerUserId = null` 的兼容判断。
