# Local Real MVP M38 Next Standalone Tracing Test Plan

日期：2026-07-07

## 1. 测试目标

M38 测试目标是证明 Next standalone 构建不再因为 ArtifactStorage 的运行时文件路径触发 NFT tracing warning，同时保持本地素材写入、解析和桌面打包准备能力不回归。

## 2. 当前红灯基线

命令：

```powershell
npm run build
```

当前事实：

- 命令 exit 0。
- 构建日志出现 `Encountered unexpected file in NFT list`。
- import trace 指向 `local-artifact-storage.ts -> video-generation-run.ts -> video route`。

M38 完成后，同一命令必须 exit 0 且不再出现该 warning。

## 3. 自动化测试

### M38-1：ArtifactStorage 行为不回归

命令：

```powershell
node --test tests\artifact-storage.test.mjs
```

通过标准：

- 默认模式继续写入 `.tmp\<category>\<file>`。
- 配置 `ARTIFACT_STORAGE_ROOT` 时继续返回 `artifact-storage/<category>/<file>` 逻辑 key。
- 旧 `.tmp/...` 和新 `artifact-storage/...` metadata 都可解析。
- 绝对路径、盘符路径和 `..` 越界路径继续返回 `null`。

### M38-2：Tracing 静态防回归

命令：

```powershell
node --test tests\next-tracing-readiness.test.mjs
```

通过标准：

- `local-artifact-storage.ts` 中运行时 cwd 路径带有 `turbopackIgnore` 标记。
- 默认存储根仍静态限定在 `.tmp`，不能退化成项目根。
- 测试不读取 `.env`，不枚举用户数据目录。

### M38-3：真实构建验收

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- 不出现 `Encountered unexpected file in NFT list`。
- 不出现 `whole project was traced unintentionally`。
- `.next\standalone\server.js` 存在。

### M38-4：桌面打包链路不回归

命令：

```powershell
npm run desktop:prepare
npm run desktop:installer-smoke
```

通过标准：

- `desktop-bundle` 可生成。
- 默认 installer smoke 仍为 `installerMode=skipped`。
- unpacked exe HTTP 200。
- `dist-desktop`、`desktop-bundle`、`test-results` 仍被 git ignore。

## 4. 审查项

- 不改真实 provider 凭据读取。
- 不输出 key、token、远程素材 URL 或本机绝对隐私路径。
- 不把 `desktop:prepare` 删除或降级；M38 只减少 tracing 风险，不取消安全过滤门禁。
- 不把当前未签名客户端描述为正式发布版。
