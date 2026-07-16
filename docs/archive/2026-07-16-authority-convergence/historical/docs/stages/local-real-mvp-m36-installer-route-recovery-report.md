# Local Real MVP M36 Installer Route Recovery Report

日期：2026-07-07

## 1. 阶段目标

M36 目标是收敛 M35 暴露的安装器 blocker：显式静默安装/卸载 smoke 在 180 秒内失败，表现为安装目录中已有部分应用文件，但安装器未退出、卸载器未生成、安装后 exe 未返回 HTTP 200。

本阶段不做正式签名、不做自动更新、不做公网发布、不 push，也不把未签名候选包表述为生产发布版。

## 2. 根因判断

M35 的失败不是 assisted NSIS 路线根本不可用，而是 smoke 过早超时并杀掉安装器。

证据：

- 180 秒超时后，`test-results\stage35-install` 只有 6260 个文件，约 707 MB。
- `dist-desktop\win-unpacked` 有 15699 个文件，约 883 MB。
- 这说明安装器还在解压或复制大体积应用目录时被 smoke 终止，因此卸载器尚未写入，安装后 exe 也不能稳定启动。
- 将安装器等待窗口调整到 600 秒后，静默安装、安装后 exe HTTP 200、卸载器生成和静默卸载均通过。

## 3. 本阶段变更

- `scripts\desktop-installer-smoke.mjs`
  - 增加 `resolveInstallerTimeoutMs`，默认安装器等待窗口为 600000 ms。
  - 支持通过 `SHANHAI_INSTALLER_TIMEOUT_MS` 覆盖等待窗口，低于 60000 ms 或非法值回落到默认值。
  - 将显式安装器结果拆成细粒度检查：`silent-install-exit`、`installed-exe`、`installed-server`、`installed-exe-http`、`silent-install-uninstaller`、`silent-uninstall`。
  - 修正检查顺序：先验证安装后 exe HTTP 200，再执行静默卸载。
- `tests\desktop-installer-smoke.test.mjs`
  - 增加部分安装诊断测试。
  - 增加安装器超时默认值和覆盖值测试。

## 4. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\desktop-installer-smoke.test.mjs` | 通过；5 tests passed |
| `npm run desktop:installer-smoke` | 通过；默认 unpacked exe HTTP 200 |
| `$env:SHANHAI_RUN_INSTALLER_SMOKE='1'; npm run desktop:installer-smoke` | 通过；静默安装、安装后 exe HTTP 200、卸载器生成、静默卸载均通过 |

显式安装器 smoke 通过项：

- `silent-install-exit=true`
- `installed-exe=true`
- `installed-server=true`
- `installed-exe-http=true`
- `silent-install-uninstaller=true`
- `silent-uninstall=true`

## 5. 审查结论

M36 已收敛 M35 安装器 blocker：

- 当前未签名 NSIS assisted installer 可完成显式静默安装/卸载 smoke。
- 当前安装后 exe 可在本地 loopback 端口返回 HTTP 200。
- 当前 smoke 能区分部分安装、缺卸载器、安装后启动失败和卸载失败。

当前仍不能表述为：

- 正式签名生产安装包已完成。
- 自动更新已完成。
- 人工安装体验、快捷方式、图标品牌、用户数据目录和卸载残留已完成全量验收。
- 公网生产发布已完成。

## 6. 下一阶段建议

优先级从高到低：

1. 做 M37 客户端人工安装体验验收：安装向导、安装目录、快捷方式、启动、关闭、卸载残留。
2. 修 Next standalone tracing 根因，减少桌面打包对 `desktop:prepare` 安全过滤的依赖。
3. 补 Electron 图标、description、author、asar/asarUnpack 和基础 crash/log 目录。
4. 进入公网正式认证规划与实现。
