# Local Real MVP M31 Production Readiness Test Plan

日期：2026-07-07

## 1. 测试目标

M31 测试目标是证明本地真实 MVP 具备上线前生产准备检查能力：脚本能发现缺失配置，能在配置齐全时给出安全通过结果，并且不会泄露密钥、token、私有端点或 `.env` 内容。

## 2. TDD 红灯用例

### M31-1：生产预检脚本缺失时失败

命令：

```powershell
node --test tests\production-preflight.test.mjs
```

红灯标准：

- 没有 `scripts\production-preflight.mjs` 时测试失败。
- 没有 `npm run preflight:production` 时测试失败。
- `next.config.ts` 未配置 standalone 时测试失败。

### M31-2：缺失 env 时失败且不泄密

同一命令内覆盖：

- 未设置 `DATABASE_URL`、`ARTIFACT_STORAGE_ROOT` 和 provider env 时，检查结果 `ok=false`。
- 输出包含缺失项 id，但不包含伪造的 secret 值、私有 URL 或 Bearer token。

### M31-3：配置齐全时通过

同一命令内覆盖：

- 使用测试内临时目录和伪造 env，检查结果 `ok=true`。
- 检查项包含 package scripts、standalone、SQLite、artifact storage、OpenAI、Coze PPT、图片和视频。
- JSON 输出不包含 env 原始值。

## 3. 集中验收命令

| 命令 | 通过标准 |
| --- | --- |
| `node --test tests\production-preflight.test.mjs` | exit 0；所有 M31 预检测试通过 |
| `npm run preflight:production` | exit 0；输出 `ok=true`；不打印密钥、token、私有端点或 `.env` 内容 |
| `npm test` | exit 0；Node 和 Vitest 失败数为 0 |
| `npm run build` | exit 0；Next 编译和 TypeScript 通过；如仍有 tracing warning 记录来源 |
| `npm run test:e2e:stage7` | exit 0；本地 actor 与项目隔离不回归 |
| `node scripts\run-stage27-e2e.mjs` | exit 0；真实生成入口、下载和材料包联动不回归 |

## 4. 提交前审查

命令：

```powershell
git diff --check
git check-ignore -v .env .tmp
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -like '*local-real-mvp-mainline*' -and $_.CommandLine -match 'vitest|jest|playwright|next dev' }
```

额外审查：

- 对本轮变更文件执行脱敏扫描。
- 确认 runbook 不包含真实 key、token、私有端点、账号或完整 `.env`。
- 确认教师可见 UI 没有新增工程词。
