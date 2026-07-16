# Local Real MVP M39 Client Productization Test Plan

日期：2026-07-07

## 1. 测试目标

M39 测试目标是证明 Windows 客户端候选包具备基础产品化元数据和运行目录边界：图标、description、author、asar/unpack、日志目录、崩溃转储目录和默认 smoke 不回归。

## 2. TDD 红灯用例

### M39-1：桌面打包配置产品化字段

命令：

```powershell
node --test tests\desktop-packaging.test.mjs
```

红灯标准：

- `electron-builder.config.cjs` 缺少 `asar: true` 时失败。
- 缺少 `asarUnpack` 覆盖 `desktop-bundle/**` 时失败。
- 缺少 `desktop\assets\icon.ico` 时失败。
- `win.icon` 未指向该图标时失败。
- 缺少 `extraMetadata.description` 或 `extraMetadata.author` 时失败。

### M39-2：桌面主进程运行目录

命令：

```powershell
node --test tests\desktop-packaging.test.mjs
```

红灯标准：

- `desktop\electron-main.mjs` 缺少 `app.setAppLogsPath` 时失败。
- 缺少 `app.setPath("crashDumps", ...)` 时失败。
- 缺少 `app.asar.unpacked` server candidate 时失败。

### M39-3：安装体验 smoke userData 扩展

命令：

```powershell
node --test tests\desktop-installer-smoke.test.mjs
```

红灯标准：

- `desktop-user-data` 检查未覆盖 `logs` 和 `crash-dumps` 时失败。

## 3. 集中验收

| 命令 | 通过标准 |
| --- | --- |
| `node --test tests\desktop-packaging.test.mjs` | 通过，无失败 |
| `node --test tests\desktop-installer-smoke.test.mjs` | 通过，无失败 |
| `npm run build` | exit 0，无 NFT tracing warning |
| `npm run desktop:prepare` | `ok=true` |
| `npm run desktop:pack` | 生成未签名 setup exe 与 win-unpacked exe |
| `npm run desktop:installer-smoke` | 默认模式通过，unpacked exe HTTP 200 |

## 4. 审查项

- 不提交 `.env`、`.tmp`、`data`、`artifact-storage-root`、`dist-desktop`、`desktop-bundle`、`test-results`。
- 不在文档或日志中写入 key、token、私有 endpoint、远程素材 URL。
- 不宣称正式签名、自动更新、崩溃上报或公网发布完成。
- 不为了 asar 打包破坏 Next standalone server 启动路径。
