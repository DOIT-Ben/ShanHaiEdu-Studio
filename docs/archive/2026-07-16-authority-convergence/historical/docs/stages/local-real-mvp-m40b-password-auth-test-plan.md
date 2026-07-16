# Local Real MVP M40-B Password Auth Test Plan

日期：2026-07-08

## 1. 测试目标

M40-B 测试目标是证明密码登录最小闭环成立：密码强哈希、注册/登录/退出/当前用户 API、服务端 session 记录、session cookie 安全属性、登录失败不泄露账户存在性。

## 2. TDD 红灯用例

### M40-B-1：密码哈希与校验

命令：

```powershell
node --test tests\password-auth.test.mjs
```

红灯标准：

- `hashPassword` 不存在时失败。
- 生成结果包含明文密码时失败。
- 同一密码两次 hash 结果相同时失败。
- 正确密码无法验证时失败。
- 错误密码能验证通过时失败。

### M40-B-2：服务端注册/登录/退出

命令：

```powershell
node --test tests\password-auth.test.mjs
```

红灯标准：

- 注册未创建 `LocalUser.authMode=password` 时失败。
- 注册未创建服务端 `AuthSession` 时失败。
- 数据库保存明文 session token 时失败。
- 登录成功不返回 public session cookie 时失败。
- 登录失败响应区分“用户不存在”和“密码错误”时失败。
- 退出未撤销 session 时失败。

### M40-B-3：Auth API route 合同

命令：

```powershell
node --test tests\password-auth-routes.test.mjs
```

红灯标准：

- `POST /api/auth/register` 没有返回用户摘要和 set-cookie 时失败。
- `POST /api/auth/login` 成功后没有返回同一用户摘要和 set-cookie 时失败。
- `GET /api/auth/me` 缺 cookie 返回 authenticated=false；有效 cookie 返回当前用户。
- `POST /api/auth/logout` 设置清除 cookie，并撤销服务端 session。
- 响应 body 不包含 passwordHash、sessionToken、sessionTokenHash 或原始密码。

## 3. 集中验收

| 命令 | 通过标准 |
| --- | --- |
| `node --test tests\password-auth.test.mjs` | 通过，无失败 |
| `node --test tests\password-auth-routes.test.mjs` | 通过，无失败 |
| `node --test tests\public-auth-model.test.mjs tests\auth-security-hardening.test.mjs` | M40-A 与 M32 回归通过 |
| `npm test` | 总测试通过 |
| `npm run build` | 构建通过 |

## 4. 审查项

- 不提交明文密码、session token、passwordHash 样本或真实账号。
- 不在 API 响应中暴露 `passwordHash`、`sessionTokenHash`、session 明文 token。
- 登录失败错误必须通用。
- public auth mode 不能回退 local actor 冒充已登录用户。
- local auth mode 不应被密码登录改造破坏。
