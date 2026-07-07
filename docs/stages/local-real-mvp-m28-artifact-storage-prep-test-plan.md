# Local Real MVP M28 Artifact Storage Prep Test Plan

日期：2026-07-07

## 1. 测试目标

M28 测试目标是证明真实素材存储已具备生产部署前的基础：本地默认 `.tmp` 行为不回归，配置 `ARTIFACT_STORAGE_ROOT` 后可以写入固定存储根目录，metadata 不保存绝对路径，下载解析同时兼容旧 `.tmp` 和新 `artifact-storage/...` key，并拒绝越界路径。

## 2. 集中验收命令

### M28-1：存储单元测试

命令：

```powershell
node --test tests\artifact-storage.test.mjs
```

通过标准：

- 未配置 `ARTIFACT_STORAGE_ROOT` 时，`writeLocalArtifact` 写入 `.tmp/<category>/...` 并返回 `.tmp/...` metadata。
- 配置 `ARTIFACT_STORAGE_ROOT` 时，`writeLocalArtifact` 写入配置目录，并返回 `artifact-storage/<category>/...` metadata。
- `resolveLocalArtifactOutput` 可解析旧 `.tmp/...` metadata。
- `resolveLocalArtifactOutput` 可解析新 `artifact-storage/...` metadata。
- 绝对路径、`..`、空路径、非允许前缀均被拒绝。

### M28-2：全量回归测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M28-3：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Next.js 编译和 TypeScript 通过。
- 如仍有 Turbopack output tracing warning，确认是否仍指向本地文件读取风险，并记录到报告。

### M28-4：浏览器回归

命令：

```powershell
node scripts\run-stage27-e2e.mjs
```

通过标准：

- Chromium desktop 通过。
- 真实生成入口、下载按钮、PPTX/PNG/MP4 下载和材料包联动不回归。

### M28-5：提交前审查

命令：

```powershell
git diff --check
git check-ignore -v .env .tmp
rg -n --hidden -g "!node_modules" -g "!src/generated" -g "!*.pdf" "sk-[A-Za-z0-9]|token\s*=|api[_-]?key\s*=|Bearer\s+[A-Za-z0-9]|https://[^\s)]+sig=|task[_-]?id\s*[:=]" docs\stages tests scripts src\server
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -like '*local-real-mvp-mainline*' -and $_.CommandLine -match 'vitest|jest|playwright|next dev' }
```

通过标准：

- 无空白错误。
- `.env`、`.tmp` 不进入 git。
- 文档、测试、脚本和服务端代码不包含真实 key、token、私有端点、远程签名 URL 或任务标识。
- 当前 worktree 无残留测试/dev 进程。

## 3. 失败处理

- 如果旧 `.tmp` metadata 解析失败，优先修兼容解析，不迁移历史 metadata。
- 如果新 `artifact-storage/...` metadata 保存为绝对路径，必须回退并改为逻辑 key。
- 如果下载 route 出错，优先检查统一解析函数，不在各 route 中重新手写路径拼接。
- 如果构建 warning 增加，检查是否引入了更宽泛的 `process.cwd()` 拼接或动态文件追踪。
