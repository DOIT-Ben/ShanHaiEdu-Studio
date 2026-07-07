# Local Real MVP M37 Client Install Experience Test Plan

日期：2026-07-07

## 1. 测试目标

M37 测试目标是证明客户端安装体验关键系统证据可重复检查：安装后 Windows 卸载入口存在、开始菜单入口存在、桌面运行创建用户数据目录，卸载后注册表入口、快捷方式和测试安装目录核心文件消失。

## 2. TDD 红灯用例

### M37-1：安装体验聚合检查

命令：

```powershell
node --test tests\desktop-installer-smoke.test.mjs
```

红灯标准：

- 缺少 `summarizeInstallExperienceState` 导出时失败。
- 缺少以下检查项时失败：
  - `uninstall-registry-entry`
  - `start-menu-shortcut`
  - `desktop-user-data`
  - `uninstall-removes-registry`
  - `uninstall-removes-start-menu`
  - `uninstall-removes-core-files`

### M37-2：默认 smoke 不执行系统安装体验检查

命令：

```powershell
npm run desktop:installer-smoke
```

通过标准：

- `installerMode=skipped`。
- 只验证候选包、资源安全和 unpacked exe HTTP 200。
- 不写注册表、不创建快捷方式。

### M37-3：显式安装体验 smoke

命令：

```powershell
$env:SHANHAI_RUN_INSTALLER_SMOKE='1'
npm run desktop:installer-smoke
Remove-Item Env:\SHANHAI_RUN_INSTALLER_SMOKE
```

通过标准：

- 安装器退出。
- 安装后 exe 和 server 存在。
- 安装后 exe HTTP 200。
- 卸载注册表项存在。
- 开始菜单快捷方式存在。
- 桌面运行创建 userData 下的 `data` 与 `artifact-storage-root`。
- 静默卸载 exit 0。
- 卸载后注册表项消失。
- 卸载后开始菜单快捷方式消失。
- 卸载后测试安装目录核心文件消失。

## 3. 集中验收命令

| 命令 | 通过标准 |
| --- | --- |
| `node --test tests\desktop-installer-smoke.test.mjs` | exit 0；M37 聚合检查测试通过 |
| `npm run desktop:installer-smoke` | exit 0；默认 unpacked smoke 通过 |
| `$env:SHANHAI_RUN_INSTALLER_SMOKE='1'; npm run desktop:installer-smoke` | exit 0；安装体验检查项通过 |
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
- 不在报告中粘贴 key、token、私有 endpoint、完整用户目录、远程签名 URL 或完整 `.env`。
- 不把静默安装体验 smoke 扩大表述为正式签名发布。
