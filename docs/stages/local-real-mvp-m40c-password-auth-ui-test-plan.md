# Local Real MVP M40-C Password Auth UI Test Plan

日期：2026-07-08

## 1. 测试目标

M40-C 测试目标是证明浏览器在 password auth mode 下具备真实登录门禁：未登录只能看到登录/创建账号入口；注册或登录成功后进入工作台；刷新后仍保持登录；退出后回到登录门禁；本地默认模式不受影响。

## 2. TDD 红灯用例

### M40-C-1：Auth API client 合同

命令：

```powershell
node --test tests\password-auth-client.test.mjs
```

红灯标准：

- `src\lib\auth-api.ts` 不存在时失败。
- `getCurrentPasswordUser` 未请求 `/api/auth/me` 时失败。
- `registerPasswordUser` 未请求 `/api/auth/register` 时失败。
- `loginPasswordUser` 未请求 `/api/auth/login` 时失败。
- `logoutPasswordUser` 未请求 `/api/auth/logout` 时失败。
- 失败响应未转换为教师可读错误时失败。

### M40-C-2：password mode 浏览器闭环

命令：

```powershell
npm run test:e2e:stage40c
```

红灯标准：

- 未登录时仍显示工作台输入框或项目按钮则失败。
- 创建账号后不能进入工作台则失败。
- 登录后不能新建项目则失败。
- 刷新后登录态丢失则失败。
- 退出后仍能看到工作台则失败。
- 可见文本出现工程词则失败。

## 3. 集中验收

| 命令 | 通过标准 |
| --- | --- |
| `node --test tests\password-auth-client.test.mjs` | 通过，无失败 |
| `npm run test:e2e:stage40c` | Chromium desktop 通过 |
| `npm test` | 总测试通过 |
| `npm run build` | 构建通过 |
| `npm run test:e2e:stage2` | 既有本地默认主链路不回归 |
| `npm run test:e2e:stage7` | 本地默认双上下文隔离不回归 |

## 4. 审查项

- 登录 UI 不展示工程词。
- 不在前端存储密码、session token、hash 或敏感 provider 信息。
- 默认本地模式不强制登录。
- password mode 下未登录工作台 API 返回 401 时，用户看到的是登录门禁而不是错误堆栈。
- 退出后清除当前工作台视图，避免残留上一个用户的项目内容。
