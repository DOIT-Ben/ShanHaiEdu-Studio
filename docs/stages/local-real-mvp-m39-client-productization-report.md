# Local Real MVP M39 Client Productization Report

日期：2026-07-07

## 1. 阶段目标

M39 目标是在 M37-M38 的客户端可安装、可启动、可卸载和 standalone tracing 收敛基础上，补齐 Windows 客户端候选包的基础产品化工程边界：metadata、图标、asar 打包、必要 unpack、日志目录和崩溃转储目录。

本阶段不做正式签名、不做自动更新、不做公网发布、不改业务工作台 UI，也不把当前未签名候选包表述为正式发布版。

## 2. 本阶段变更

桌面打包配置：

- `electron-builder.config.cjs` 启用 `asar: true`。
- 增加 `asarUnpack`，覆盖 `desktop-bundle/**` 和 `node_modules/**`。
- 增加 `extraMetadata.description` 与 `extraMetadata.author`。
- `win.icon` 指向 `desktop\assets\icon.ico`。

桌面壳：

- `desktop\electron-main.mjs` 在 `userData` 下创建：
  - `data`
  - `artifact-storage-root`
  - `logs`
  - `crash-dumps`
- 使用 `app.setAppLogsPath(logsDir)` 固定日志目录。
- 使用 `app.setPath("crashDumps", crashDumpsDir)` 固定崩溃转储目录。
- standalone server 查找增加 `app.asar.unpacked` 候选路径。

测试与 smoke：

- `tests\desktop-packaging.test.mjs` 增加 metadata、icon、asar/unpack、日志/崩溃目录和 asar unpacked server 查找断言。
- `tests\desktop-installer-smoke.test.mjs` 增加 userData 下日志与崩溃目录检查的静态防回归。
- `scripts\desktop-installer-smoke.mjs` 适配 asar 后的 `resources\app.asar.unpacked\desktop-bundle\server.js` 路径，并在 userData 检查中覆盖 `logs` 与 `crash-dumps`。

## 3. 排障记录

第一次启用 asar 后，`desktop:pack` 通过，但 `desktop:installer-smoke` 默认 HTTP smoke 失败。

根因：

- `desktop-bundle` 已被 unpack 到真实目录。
- 但 `node_modules` 仍在 `app.asar` 内。
- Electron node 子进程从 `app.asar.unpacked\desktop-bundle\server.js` 启动时，无法向上解析 `next` 等运行依赖。

修复：

- 将 `node_modules/**` 加入 `asarUnpack`。
- 保持 `desktop-bundle` 在真实 unpacked 目录运行，避免 `server.js` 在 asar 虚拟目录执行 `chdir(__dirname)` 失败。

## 4. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\desktop-packaging.test.mjs` | 通过；5 tests passed |
| `node --test tests\desktop-installer-smoke.test.mjs` | 通过；7 tests passed |
| `npm run build` | 通过；exit 0；无 NFT tracing warning |
| `npm run desktop:prepare` | 通过；`ok=true` |
| `npm run desktop:pack` | 通过；重新生成未签名候选 setup exe 与 win-unpacked exe |
| `npm run desktop:installer-smoke` | 通过；默认模式 `installerMode=skipped`，unpacked exe HTTP 200 |
| 隔离 `SHANHAI_DESKTOP_USER_DATA_DIR` 直接启动 unpacked exe | 通过；HTTP 200，`data`、`artifact-storage-root`、`logs`、`crash-dumps` 均存在 |

## 5. 审查结论

M39 已把客户端候选包推进到基础产品化工程态：

- 有基础图标资产。
- 有客户端 metadata。
- 已启用 asar。
- Next standalone server 和运行依赖位于 unpacked 真实目录，默认 smoke 可启动。
- 桌面端 userData 下具备数据、素材、日志和崩溃转储目录。

当前仍不能表述为：

- 正式签名客户端安装包已完成。
- 自动更新已完成。
- 崩溃上报、日志采集或监控已完成。
- 人工可见安装向导截图验收已完成。
- 公网生产发布已完成。

## 6. 下一阶段建议

优先级从高到低：

1. 做公网正式认证规划，覆盖密码/OAuth/SSO、CSRF token、管理员、共享协作和审计日志。
2. 做任务队列生产化规划，覆盖 worker、重试、取消、限流、监控和失败 repair。
3. 做 WebKit、真实移动设备或触摸手势专项验证。
4. 做正式签名、自动更新和人工可见安装向导专项。
