# Local Real MVP M37 Client Install Experience Report

日期：2026-07-07

## 1. 阶段目标

M37 目标是在 M36 静默安装、启动、卸载 smoke 通过的基础上，补齐客户端安装体验关键系统证据：Windows 卸载入口、开始菜单入口、桌面端用户数据目录，以及卸载后系统入口和测试安装目录核心文件清理。

本阶段不做正式签名、不做自动更新、不做图标品牌精修、不做公网发布、不 push，也不把未签名候选包表述为生产发布版。

## 2. 本阶段变更

桌面壳：

- `desktop\electron-main.mjs` 新增 `SHANHAI_DESKTOP_USER_DATA_DIR` 支持。
- smoke 可把 Electron `userData` 隔离到 `test-results\stage37-user-data`，避免用真实用户目录判断测试结果。

安装体验 smoke：

- `scripts\desktop-installer-smoke.mjs` 新增安装体验检查：
  - `uninstall-registry-entry`
  - `start-menu-shortcut`
  - `desktop-user-data`
  - `uninstall-removes-registry`
  - `uninstall-removes-start-menu`
  - `uninstall-removes-core-files`
- 卸载后清理检查增加等待窗口，避免 uninstaller exit 后系统入口异步清理造成误判。
- 注册表匹配从只看 `InstallLocation` 扩展为同时匹配卸载字符串中的测试安装目录。

测试：

- `tests\desktop-installer-smoke.test.mjs` 增加安装体验聚合检查测试。
- `tests\desktop-packaging.test.mjs` 增加桌面壳 userData 覆盖入口静态检查。

## 3. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\desktop-packaging.test.mjs` | 通过；3 tests passed |
| `node --test tests\desktop-installer-smoke.test.mjs` | 通过；6 tests passed |
| `npm run desktop:pack` | 通过；重新生成包含 M37 桌面壳改动的未签名候选包 |
| `npm run desktop:installer-smoke` | 通过；默认 unpacked exe HTTP 200 |
| `$env:SHANHAI_RUN_INSTALLER_SMOKE='1'; npm run desktop:installer-smoke` | 通过；安装体验检查项全部通过 |

显式安装体验 smoke 通过项：

- `silent-install-exit=true`
- `installed-exe=true`
- `installed-server=true`
- `installed-exe-http=true`
- `silent-install-uninstaller=true`
- `silent-uninstall=true`
- `uninstall-registry-entry=true`
- `start-menu-shortcut=true`
- `desktop-user-data=true`
- `uninstall-removes-registry=true`
- `uninstall-removes-start-menu=true`
- `uninstall-removes-core-files=true`

## 4. 审查结论

M37 已完成未签名候选客户端的自动化安装体验关键证据：

- Windows 卸载入口可识别。
- 开始菜单快捷方式可识别。
- 安装后 exe 可启动本地 loopback 服务。
- 桌面端运行会创建可控 userData 下的 `data` 和 `artifact-storage-root`。
- 静默卸载后注册表入口、开始菜单快捷方式和测试安装目录核心文件会清理。

当前仍不能表述为：

- 正式签名客户端安装包已完成。
- 自动更新已完成。
- 人工可见安装向导截图验收已完成。
- 图标品牌、快捷方式图标、崩溃日志、窗口生命周期全量体验已完成。
- 公网生产发布已完成。

## 5. 下一阶段建议

优先级从高到低：

1. 修 Next standalone tracing 根因，减少桌面打包对 `desktop:prepare` 安全过滤的依赖。
2. 补 Electron 图标、description、author、asar/asarUnpack 和基础 crash/log 目录。
3. 做公网正式认证规划与实现。
4. 做任务队列生产化规划，覆盖 worker、重试、取消、限流、监控和失败 repair。
