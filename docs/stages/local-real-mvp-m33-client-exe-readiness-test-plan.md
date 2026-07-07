# Local Real MVP M33 Client Exe Readiness Test Plan

日期：2026-07-07

## 1. 测试目标

M33 测试目标是证明 ShanHaiEdu 本地真实 MVP 具备客户端 exe 验证前置条件：本地服务可以通过 `localhost` 入口完成核心浏览器流程，下载和会话不回归，并且 readiness 脚本能清楚地区分“可准备封装验证”和“真实 exe 尚未打包”。

## 2. TDD 红灯用例

### M33-1：客户端验证预检脚本

命令：

```powershell
node --test tests\client-exe-readiness.test.mjs
```

红灯标准：

- 没有 `scripts\client-exe-readiness.mjs` 时测试失败。
- 没有 `npm run preflight:client-exe` 时测试失败。
- Next standalone、build/start 脚本或下载 route 缺失时结果 `ok=false`。

### M33-2：准备态输出不伪装 exe 已完成

同一命令内覆盖：

- 当前没有真实桌面打包工程时，结果仍可表达 web-to-exe readiness。
- 输出包含 warning，说明真实 exe 打包工程未配置。
- 输出不包含密钥、token、私有端点或完整 `.env`。

### M33-3：localhost 容器等价 E2E

命令：

```powershell
npm run test:e2e:stage33
```

通过标准：

- 使用 `http://localhost:<port>` 入口打开工作台。
- 新建项目、输入需求、刷新恢复成功。
- 可下载 Markdown 文件。
- 教师可见界面不出现工程词。

## 3. 集中验收命令

| 命令 | 通过标准 |
| --- | --- |
| `node --test tests\client-exe-readiness.test.mjs` | exit 0；M33 预检测试通过 |
| `npm run preflight:client-exe` | exit 0；输出 `ok=true`；warning 明确真实 exe 工程尚未配置 |
| `npm run test:e2e:stage33` | exit 0；Chromium desktop 1 passed |
| `npm test` | exit 0；Node 和 Vitest 失败数为 0 |
| `npm run build` | exit 0；Next 编译和 TypeScript 通过；如仍有 tracing warning 记录来源 |

## 4. 提交前审查

```powershell
git diff --check
git check-ignore -v .env .tmp data artifact-storage-root
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -like '*local-real-mvp-mainline*' -and $_.CommandLine -match 'vitest|jest|playwright|next dev' }
```

额外审查：

- M33 文档不宣称真实 exe 已生成、安装或发布。
- readiness 输出不展示真实 key、token、私有 endpoint 或本机敏感路径。
- Stage33 不新增用户可见工程词。
