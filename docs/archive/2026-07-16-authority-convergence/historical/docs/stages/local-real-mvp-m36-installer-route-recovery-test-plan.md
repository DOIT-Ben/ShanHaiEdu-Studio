# Local Real MVP M36 Installer Route Recovery Test Plan

日期：2026-07-07

## 1. 测试目标

M36 测试目标是把 M35 的安装器 blocker 变成可判断、可修复、可验收的安装器路线：默认 unpacked smoke 必须继续通过；显式安装器 smoke 必须能区分安装进程退出、文件解压、卸载器生成、安装后启动和卸载结果。

## 2. 红灯用例

### M36-1：部分安装状态可诊断

命令：

```powershell
node --test tests\desktop-installer-smoke.test.mjs
```

红灯标准：

- 当安装目录中已有 exe 和 server 但没有卸载器时，结果不能只返回泛化的 `silent-install=false`。
- 必须能分别报告：
  - `silent-install-exit`
  - `installed-exe`
  - `installed-server`
  - `silent-install-uninstaller`
  - `silent-uninstall`

### M36-2：默认 smoke 不受安装器探针影响

命令：

```powershell
npm run desktop:installer-smoke
```

通过标准：

- `installerMode=skipped`。
- 安装包和 unpacked exe 存在。
- packaged resources 仍排除本地敏感和测试目录。
- unpacked exe HTTP 200。

### M36-3：显式安装器路线 smoke

命令：

```powershell
$env:SHANHAI_RUN_INSTALLER_SMOKE='1'
npm run desktop:installer-smoke
Remove-Item Env:\SHANHAI_RUN_INSTALLER_SMOKE
```

通过标准：

- 若路线已修复：安装进程退出、安装后 exe 和 server 存在、安装后 exe HTTP 200、卸载器存在、静默卸载 exit 0。
- 若路线仍失败：输出明确失败阶段，不再只报告“缺 required files”；报告写入 M36 阶段结果，不声明安装/卸载完成。

## 3. 集中验收命令

| 命令 | 通过标准 |
| --- | --- |
| `node --test tests\desktop-installer-smoke.test.mjs` | exit 0；诊断粒度测试通过 |
| `npm run desktop:installer-smoke` | exit 0；默认 unpacked smoke 通过 |
| `$env:SHANHAI_RUN_INSTALLER_SMOKE='1'; npm run desktop:installer-smoke` | exit 0 或输出 M36 明确 blocker |
| `npm test` | exit 0；Node 和 Vitest 失败数为 0 |
| `npm run build` | exit 0；Next 编译和 TypeScript 通过 |

## 4. 提交前审查

```powershell
git diff --check
git check-ignore -v .env .tmp data artifact-storage-root dist-desktop desktop-bundle test-results
Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'ShanHaiEdu Studio.exe' -and $_.CommandLine -like '*local-real-mvp-mainline*') -or ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*local-real-mvp-mainline*' -and $_.CommandLine -match 'vitest|jest|playwright|next dev|electron|server.js') }
```

额外审查：

- 不提交 `dist-desktop\`、`desktop-bundle\`、`test-results\`、数据库或素材目录。
- 不在报告中粘贴 key、token、私有 endpoint、远程签名 URL 或完整 `.env`。
- 不把 one-click、assisted 或 portable 任一路线的局部通过扩大成正式生产发布。
