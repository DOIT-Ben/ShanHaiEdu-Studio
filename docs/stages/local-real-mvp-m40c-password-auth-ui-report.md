# Local Real MVP M40-C Password Auth UI Report

日期：2026-07-08

## 1. 阶段目标

M40-C 目标是把 M40-B 的密码登录 API 接入浏览器入口，让 `SHANHAI_AUTH_MODE=password` 与 `NEXT_PUBLIC_SHANHAI_AUTH_MODE=password` 下的用户必须先登录或创建账号，再进入 ShanHaiEdu 工作台。

本阶段不做 OAuth/SSO、组织邀请、管理员后台、密码重置、验证码、rate limit、登录风控或公网部署。

## 2. 实现内容

- 新增 `src\lib\auth-api.ts`：封装 `me/register/login/logout`。
- 新增 `src\hooks\usePasswordAuth.ts`：只在 `NEXT_PUBLIC_SHANHAI_AUTH_MODE=password` 时启用登录门禁。
- 新增 `src\components\auth\PasswordAuthGate.tsx`：提供登录/创建账号最小界面。
- 调整 `src\components\layout\MediaWorkbench.tsx`：未登录时显示门禁，登录后再挂载工作台 controller。
- 调整 `src\components\conversation\WorkbenchTopbar.tsx`：显示当前教师和退出入口。
- 新增 `tests\password-auth-client.test.mjs`。
- 新增 `tests\e2e\stage40c-password-auth-ui.spec.ts` 和 `scripts\run-stage40c-e2e.mjs`。
- `package.json` 新增 `npm run test:e2e:stage40c`。

## 3. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\password-auth-client.test.mjs` | 通过：2 tests passed |
| `npm run test:e2e:stage40c` | 通过：Chromium desktop + Chromium narrow，2 passed |
| `npm test` | 通过：Node 86/86；Vitest 24 files / 91 tests |
| `npm run build` | 通过 |
| `npm run test:e2e:stage2` | 通过：Chromium desktop 2 passed |
| `npm run test:e2e:stage7` | 通过：Chromium desktop 1 passed |

## 4. 审查结论

已完成：

- password auth mode 下未登录先显示登录门禁。
- 创建账号后进入真实工作台。
- 登录 session 刷新后仍可恢复。
- 退出后返回登录门禁，并清理当前项目本地选择。
- 默认本地模式不强制登录，M1-M5 主链路和 M7 双上下文隔离未回归。
- 登录 UI 避免工程词，不展示 token、hash、provider、endpoint 或内部路径。

仍未完成：

- 完整 CSRF 落库校验在 auth route 上的强制接入。
- rate limit、验证码、登录风控、密码重置、多因素认证。
- OAuth/SSO、组织/班级/邀请协作、管理员和审计查询 UI。
- 公网部署、域名、HTTPS 和生产安全监控。

## 5. 下一步建议

优先做 M40-D：账号权限系统继续系统性完善，补充 CSRF 落库校验接入、登录频率保护、项目 membership 管理入口或最小邀请/共享模型的阶段规划。
