# Local Real MVP M32 Auth Security Hardening Test Plan

日期：2026-07-07

## 1. 测试目标

M32 测试目标是证明账号权限系统在 M29 本地 owner 隔离基础上新增浏览器安全边界：写接口能阻断跨站请求，HTTPS 场景 cookie 带 `Secure`，全局安全响应头存在，且现有本地浏览器链路不回归。

## 2. TDD 红灯用例

### M32-1：写接口来源校验

命令：

```powershell
node --test tests\auth-security-hardening.test.mjs
```

红灯标准：

- 跨站 `POST` 返回 403。
- 同源 `POST` 返回 handler 响应。
- `GET` 请求不执行写接口拦截。

### M32-2：HTTPS cookie 加固

同一命令内覆盖：

- HTTP 请求生成 cookie 不强制 `Secure`。
- HTTPS 请求或 `x-forwarded-proto=https` 请求生成 cookie 包含 `Secure`。
- cookie 仍包含 `HttpOnly`、`SameSite=Lax`、`Path=/`。

### M32-3：Next 安全响应头

同一命令内覆盖：

- `next.config.ts` 暴露 headers 配置。
- 至少包含 `X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`。

## 3. 集中验收命令

| 命令 | 通过标准 |
| --- | --- |
| `node --test tests\auth-security-hardening.test.mjs` | exit 0；M32 专项测试通过 |
| `npm test` | exit 0；Node 和 Vitest 失败数为 0 |
| `npm run build` | exit 0；Next 编译和 TypeScript 通过；如仍有 tracing warning 记录来源 |
| `npm run test:e2e:stage7` | exit 0；本地 actor 与项目隔离不回归 |
| `node scripts\run-stage27-e2e.mjs` | exit 0；真实生成入口、下载和材料包联动不回归 |

## 4. 提交前审查

```powershell
git diff --check
git check-ignore -v .env .tmp data artifact-storage-root
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -like '*local-real-mvp-mainline*' -and $_.CommandLine -match 'vitest|jest|playwright|next dev' }
```

额外审查：

- 安全错误响应不输出内部判断细节。
- 文档不宣称公网正式认证已完成。
- 不提交 `.env`、本地数据库、素材目录或 provider 响应。
