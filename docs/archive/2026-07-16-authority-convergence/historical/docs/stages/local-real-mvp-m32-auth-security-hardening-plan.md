# Local Real MVP M32 Auth Security Hardening Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M32 的核心需求是把 M29 的本地账号/权限最小闭环推进到更系统的安全边界：当前已有本地 actor、项目 owner、service 访问判断，但还缺少浏览器写接口来源校验、安全响应头和 HTTPS 场景下的 cookie 强化。

本阶段仍不做公网注册、密码登录、OAuth、SSO、组织/班级、管理员后台或计费多租户。当前最小成功标准是：

- 所有 workbench 写接口统一经过同源来源校验，跨站 POST/PUT/PATCH/DELETE 被拒绝。
- 同源浏览器请求和无浏览器来源头的本地内部调用不被破坏。
- 本地会话 cookie 继续 `HttpOnly`、`SameSite=Lax`，并在 HTTPS 或代理 HTTPS 场景下自动增加 `Secure`。
- Next 全局安全响应头覆盖页面和 API，降低点击劫持、MIME sniffing、过宽权限和 referrer 泄露风险。
- 用户可见 UI 不新增工程词，不暴露安全实现细节。

## 2. 可复用方案调研

项目内可复用：

- `src\server\auth\local-session.ts` 已集中生成本地会话和 cookie。
- `src\server\auth\workbench-route.ts` 已是所有 workbench API route 的统一 actor 包装入口。
- M29 service 层访问控制已覆盖项目、消息、产物、真实生成和下载 route。
- `next.config.ts` 已是统一配置入口，M31 已加入 standalone 输出。

外部成熟方案参考：

- OWASP CSRF Prevention Cheat Sheet 建议校验 `Origin`/`Referer` 等 source origin，并结合 SameSite cookie 做纵深防御。
- Next.js 官方 headers 配置可在 `next.config.ts` 中为路由统一设置安全响应头。
- Next.js cookie 运行在标准 HTTP cookie 语义上，`HttpOnly`、`SameSite`、`Secure` 是认证 cookie 的基础安全属性。

本阶段取舍：

- 优先使用同源来源校验，不引入 CSRF token 表或第三方 auth 库。
- 缺少 `Origin`/`Referer`/`Sec-Fetch-Site` 的本地脚本或 Node 测试请求暂时允许，避免破坏本地内部调用；浏览器跨站请求会被拦截。
- 不在前端新增可见 UI，不改变教师工作流。

## 3. 复用、适配和必要自研

复用：

- 继续使用 `withLocalWorkbenchActor` 作为统一 API 包装点。
- 继续使用现有 `shanhai_local_user` cookie。
- 继续保留 M29 actor 项目访问判断。

适配：

- `createLocalSessionSetCookieHeader` 增加可选 request 参数，根据 `https:` 或 `x-forwarded-proto=https` 增加 `Secure`。
- `withLocalWorkbenchActor` 在 handler 前调用写接口来源校验。
- `next.config.ts` 增加安全 headers。

必要自研：

- 新增 `assertLocalWorkbenchRequestAllowed(request)`。
- 拒绝跨站 `Origin`、跨站 `Referer` 或 `Sec-Fetch-Site: cross-site` 的写请求。
- 返回教师不可见的 API 安全错误，不泄露内部判断细节。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M32 阶段规划和测试定义。
2. 写红灯测试：跨站 POST 被拒，同源 POST 允许，GET 不被拦截。
3. 写红灯测试：HTTPS 请求生成 `Secure` cookie。
4. 写红灯测试：`next.config.ts` 暴露安全 headers。
5. 实现 auth guard、Secure cookie 和 Next headers。
6. 跑 M32 专项测试、`npm test`、`npm run build`、Stage7、Stage27。
7. 更新 M32 报告和当前状态审计。
8. 提交 M32，不 push。

主要风险：

- 过严来源校验可能误伤本地 Node 测试、脚本或客户端 exe 容器调用；本阶段对无来源头请求保持兼容。
- `Content-Security-Policy` 过严可能破坏 Next dev 或内联样式；本阶段先配置不易破坏当前应用的基础头，不强行加完整 CSP。
- 这仍不是公网正式认证系统，不能包装为密码/OAuth/组织权限已完成。

验证标准：

- `node --test tests\auth-security-hardening.test.mjs` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- `npm run test:e2e:stage7` 通过。
- `node scripts\run-stage27-e2e.mjs` 通过。
- `git diff --check`、脱敏扫描、残留进程检查通过。
