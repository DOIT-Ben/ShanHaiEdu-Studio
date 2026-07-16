# Local Real MVP M1 Browser Loop Report

日期：2026-07-07

## 1. 阶段目标

M1 目标是在本地真实浏览器中验证最小 MVP 闭环：新建项目、输入一句话备课需求、生成需求规格说明书、查看右侧真实产物、确认产物，并在刷新后恢复状态。

本阶段继续使用 deterministic runtime，不声明真实模型、PPTX、图片或视频 provider 已接入。

## 2. 本轮修复

### 2.1 空 body 新建项目失败

现象：

- 首次运行 `npm run test:e2e:stage2` 时，点击“新建项目”后 `POST /api/workbench/projects` 返回 500。
- 服务端错误为 `Unexpected end of JSON input`。

根因：

- 浏览器 API client 新建项目时发送无 body 的 `POST`。
- `src\app\api\workbench\projects\route.ts` 直接执行 `request.json()`，空 body 会抛错。

修复：

- 增加 `parseOptionalProjectBody()`，空请求体按 `{}` 处理，仍保留有 JSON body 时的字段读取。
- 新增 Stage 7 route contract 测试，覆盖无 body 新建默认项目。

### 2.2 教师界面暴露内部字段

现象：

- 浏览器截图显示右侧产物预览中暴露 `generationMode` 和 `nextSuggestedAction`。

根因：

- `src\lib\workbench-mappers.ts` 已过滤 `schema`、`node_id`、`provider` 等字段，但未过滤 agent runtime 的内部结构字段。

修复：

- 扩展 `isVisibleStructuredLabel()` 过滤 `generationMode` 与 `nextSuggestedAction`。
- 扩展 `tests\workbench-api.test.mjs`，确保这些字段不会进入 preview fields 或可复用内容。

### 2.3 E2E 断言适配真实后端时间

现象：

- 真实后端 `updatedAt` 映射为 `07-07 10:xx`，旧测试固定期待 `刚刚`。
- 同一句摘要在侧栏摘要与关键字段中出现两次，触发 Playwright strict mode。

修复：

- 将“产物预览”断言改为不绑定具体时间。
- 对重复摘要断言使用第一处可见文本。

## 3. 验收记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `node --test tests/workbench-api.test.mjs` | 红灯后绿灯 | 新增内部字段过滤断言先失败，修复后 9 tests passed |
| `npx vitest run src/server/workbench/__tests__/stage7-mainline-contract.test.ts --maxWorkers=1` | 红灯后绿灯 | 无 body 新建项目测试先失败，修复后 4 tests passed |
| `npm test` | 通过 | Node 9 tests passed；Vitest 11 files / 64 tests passed |
| `npm run build` | 通过 | Prisma Client 生成成功；Next.js 编译、TypeScript、静态页面生成均通过 |
| `npm run test:e2e:stage2` | 通过 | Chromium desktop 1 passed；覆盖新建、发送、产物、详情、确认、刷新恢复 |
| 测试 worker 残留检查 | 通过 | 未发现匹配 Vitest/Jest/Playwright 的残留 Node 进程 |

成功截图：

- `test-results\e2e\stage2-deterministic-E2E-S-1250f--and-restores-after-refresh-chromium-desktop\stage2-requirement-approved-restored.png`

## 4. 风险与边界

- 当前 M1 只覆盖 Chromium desktop，尚未验证窄屏和多浏览器。
- 当前闭环只到需求规格说明书，不覆盖教案、PPT 大纲、导入视频方案或最终交付包。
- 当前 deterministic runtime 仍是开发态可验证运行时，不代表真实模型 provider 已完成。
- 本阶段未执行部署、push、旧 worktree 删除或远端分支清理。

## 5. 审查结论

M1 浏览器真实 MVP 闭环通过。当前主线已经具备从本地浏览器完成最小需求规格产物闭环的证据，可以进入 M2：需求规格到教案文本闭环。
