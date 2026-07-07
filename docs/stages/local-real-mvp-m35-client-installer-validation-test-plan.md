# Local Real MVP M35 Client Installer Validation Test Plan

日期：2026-07-07

## 1. 测试目标

M35 测试目标是证明客户端安装包具备可重复验收边界：候选安装包存在且不入 git，打包资源不含本地敏感/临时目录，unpacked exe 可启动本地服务，安装器静默安装/卸载可在显式开关下执行并清理进程。

## 2. TDD 红灯用例

### M35-1：安装包 smoke 脚本配置

命令：

```powershell
node --test tests\desktop-installer-smoke.test.mjs
```

红灯标准：

- 没有 `scripts\desktop-installer-smoke.mjs` 时失败。
- 没有 `npm run desktop:installer-smoke` 时失败。
- 没有安装包或 unpacked exe 时失败。

### M35-2：资源安全和 ignored 目录

同一命令内覆盖：

- `dist-desktop\` 被 git ignore。
- `desktop-bundle\` 被 git ignore。
- packaged resources 不包含 `.env`、data、`.tmp`、docs、tests、test-results。

### M35-3：unpacked exe smoke

命令：

```powershell
npm run desktop:installer-smoke
```

通过标准：

- 启动 `dist-desktop\win-unpacked\ShanHaiEdu Studio.exe`。
- 固定端口返回 HTTP 200。
- 结束后无当前 worktree 下的客户端进程残留。

### M35-4：显式安装器 smoke

命令：

```powershell
$env:SHANHAI_RUN_INSTALLER_SMOKE='1'
npm run desktop:installer-smoke
Remove-Item Env:\SHANHAI_RUN_INSTALLER_SMOKE
```

通过标准：

- 静默安装到 `test-results\stage35-install`。
- 安装后 exe 可启动并返回 HTTP 200。
- 静默卸载执行完成。
- 结束后无当前 worktree 下的客户端进程残留。

## 3. 集中验收命令

| 命令 | 通过标准 |
| --- | --- |
| `node --test tests\desktop-installer-smoke.test.mjs` | exit 0；安装包 smoke 测试通过 |
| `npm run desktop:installer-smoke` | exit 0；默认 unpacked smoke 通过 |
| `$env:SHANHAI_RUN_INSTALLER_SMOKE='1'; npm run desktop:installer-smoke` | exit 0；显式安装/卸载 smoke 通过，或报告 blocker |
| `npm test` | exit 0；Node 和 Vitest 失败数为 0 |
| `npm run build` | exit 0；Next 编译和 TypeScript 通过 |

## 4. 提交前审查

```powershell
git diff --check
git check-ignore -v .env .tmp data artifact-storage-root dist-desktop desktop-bundle
Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'ShanHaiEdu Studio.exe' -and $_.CommandLine -like '*local-real-mvp-mainline*') -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*local-real-mvp-mainline*' -and $_.CommandLine -match 'vitest|jest|playwright|next dev|electron') }
```

额外审查：

- 不提交 `dist-desktop\`、`desktop-bundle\`、安装目录、数据库或素材目录。
- 不把未签名安装包说成生产发布版。
- 不在报告中粘贴本机敏感路径之外的 key、token、私有 endpoint 或完整 `.env`。
