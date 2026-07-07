# Local Real MVP M34 Real Client Exe Packaging Test Plan

日期：2026-07-07

## 1. 测试目标

M34 测试目标是为真实 Windows 客户端 exe 打包建立可执行验收边界：先验证桌面壳入口、Next standalone 运行边界、localhost 工作台链路和打包配置，再决定是否生成未签名候选包。

## 2. TDD 红灯用例

### M34-1：桌面打包配置缺失时失败

命令：

```powershell
node --test tests\desktop-packaging.test.mjs
```

红灯标准：

- 没有 `desktop\electron-main.mjs` 时失败。
- 没有 `desktop\preload.mjs` 时失败。
- 没有 `npm run desktop:smoke` 时失败。
- 没有 `npm run desktop:pack` 时失败。
- 没有 electron-builder 配置时失败。

### M34-2：桌面 smoke 不启动真实 provider

命令：

```powershell
npm run desktop:smoke
```

通过标准：

- 只验证桌面壳入口、standalone 输出、脚本、端口策略和配置。
- 不调用 OpenAI、Coze、图片或视频真实 provider。
- 输出不包含 key、token、私有 endpoint、完整 `.env` 或用户敏感路径。

### M34-3：localhost 客户端链路不回归

命令：

```powershell
npm run test:e2e:stage33
```

通过标准：

- 使用 `http://localhost:<port>` 入口。
- 新建项目、输入需求、刷新恢复和 Markdown 下载成功。
- 教师可见界面不出现工程词。

### M34-4：真实打包候选

命令：

```powershell
npm run desktop:pack
```

通过标准：

- 如果本机依赖、网络和打包缓存满足条件，应生成 Windows 未签名候选包。
- 如果失败，必须保留失败原因和下一步最小动作，不能宣称 exe 已完成。
- 打包产物目录必须被 git ignore，不提交二进制。

## 3. 集中验收命令

| 命令 | 通过标准 |
| --- | --- |
| `node --test tests\desktop-packaging.test.mjs` | exit 0；桌面配置测试通过 |
| `npm run desktop:smoke` | exit 0；桌面壳 smoke 通过 |
| `npm run preflight:client-exe` | exit 0；客户端验证准备仍通过 |
| `npm run test:e2e:stage33` | exit 0；localhost 客户端链路不回归 |
| `npm test` | exit 0；Node 和 Vitest 失败数为 0 |
| `npm run build` | exit 0；Next 编译和 TypeScript 通过 |
| `npm run desktop:pack` | 生成真实本地候选包，或记录明确 blocker |

## 4. 提交前审查

```powershell
git diff --check
git check-ignore -v .env .tmp data artifact-storage-root dist
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -like '*local-real-mvp-mainline*' -and $_.CommandLine -match 'electron|next|playwright|vitest|jest' }
```

额外审查：

- 不提交 `dist\`、安装包、exe、数据库、素材或 `.env`。
- 不把未签名候选包说成生产发布版。
- 不把桌面 smoke 说成真实 exe 安装验收。
- Electron preload 不暴露任意 Node API 到页面。
