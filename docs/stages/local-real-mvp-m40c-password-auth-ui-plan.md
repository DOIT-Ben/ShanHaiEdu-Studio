# Local Real MVP M40-C Password Auth UI Plan

日期：2026-07-08

## 1. 第一性原理：当前阶段核心需求

M40-C 的核心需求是把 M40-B 已完成的密码登录 API 接到浏览器工作台入口，让 `SHANHAI_AUTH_MODE=password` 下的用户必须先登录或创建账号，再进入真实工作台。登录后工作台 API 使用服务端 `shanhai_session` cookie 识别用户，不再回退本地匿名 actor。

本阶段不是完整账号中心，也不是公网安全终局；它只证明浏览器网站和客户端壳将来可以承载 password auth mode 的最小真实闭环。

## 2. 可复用方案调研

项目内可复用：

- M40-B 已提供 `POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`。
- `MediaWorkbench` 是当前页面级工作台入口，适合挂载认证门禁。
- `WorkbenchTopbar` 是工作台顶部状态区，适合显示当前教师与退出入口。
- `workbench-api.ts` 已统一封装浏览器 fetch，可复用同源 cookie 默认行为。
- `tests\e2e` 已有 Playwright 浏览器验收和临时 SQLite 初始化脚本。

行业/成熟方法论复用：

- 继续沿用 M40-B 的 OWASP Authentication / Session Management / Password Storage 口径：登录失败通用、session 使用 httpOnly cookie、响应体不暴露敏感字段。
- 前端交互遵循当前 conversational workbench 模式：登录只作为进入工作台的门禁，不把账号系统变成营销页或工程控制台。

## 3. 复用、适配和必要自研

复用：

- 复用 M40-B auth API，不新增后端认证模型。
- 复用 `Button`、全局灰白 UI token、现有三栏工作台。
- 复用 Playwright 的临时数据库和真实浏览器流程。

适配：

- 新增 `src\lib\auth-api.ts`：封装 `me/register/login/logout`，统一 teacher-facing 错误。
- 新增 `src\hooks\usePasswordAuth.ts`：只在 `NEXT_PUBLIC_SHANHAI_AUTH_MODE=password` 时启用认证门禁。
- 新增 `src\components\auth\PasswordAuthGate.tsx`：登录/创建账号最小界面。
- 修改 `MediaWorkbench`：未登录时显示门禁，登录后渲染现有工作台。
- 修改 `WorkbenchTopbar`：登录用户显示教师名与退出按钮；本地模式保持现有状态。

必要自研：

- 浏览器端最小表单状态、错误提示、提交中状态。
- password auth mode 专项 E2E 脚本，验证未登录不可见工作台、注册后可新建项目、刷新仍保持登录、退出后回到登录门禁。

## 4. 开发方案、风险和验证标准

开发步骤：

1. 写 M40-C 阶段计划和测试定义。
2. 写红灯测试：auth API client 单元测试、password mode 浏览器 E2E。
3. 实现 auth client、auth hook、登录门禁和 topbar 退出入口。
4. 跑 M40-C 聚焦测试和浏览器验收。
5. 跑 `npm test`、`npm run build`、既有 stage2/stage7 回归。
6. 更新 M40-C 报告和当前状态审计。

主要风险：

- 本地默认模式被登录门禁误伤，导致原有本地 MVP 无法直接打开。
- password mode 下工作台仍回退本地匿名 actor。
- 登录页出现工程词或过度营销化设计。
- 退出后没有刷新工作台状态，导致旧项目内容残留。

验证标准：

- `node --test tests\password-auth-client.test.mjs` 通过。
- `npm run test:e2e:stage40c` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- 既有 `npm run test:e2e:stage2` 和 `npm run test:e2e:stage7` 不回归。
- 页面可见文本不出现 `schema`、`manifest`、`provider`、`node_id`、`storage`、`API`、`debug`、`local path`。
