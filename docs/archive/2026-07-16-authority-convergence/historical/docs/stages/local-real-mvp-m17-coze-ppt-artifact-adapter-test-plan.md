# Local Real MVP M17 Coze PPT Artifact Adapter Test Plan

日期：2026-07-07

## 1. 测试目标

M17 测试目标是验证真实 Coze PPT 能力已从脚本 smoke 推进到后端 artifact 能力：PPT 大纲 artifact 可以生成一个带本地 PPTX 文件引用的新 artifact，下载 route 会优先返回这个真实文件，最终材料包也能复用它。

## 2. 集中验收命令

### M17-1：后端 adapter 与 route 测试

命令：

```powershell
node scripts\init-sqlite-schema.mjs
npx vitest run src/server/coze-ppt\__tests__\coze-ppt-artifact-adapter.test.ts --maxWorkers=1
```

通过标准：

- 对 `ppt_draft` artifact 调用 `POST /coze-ppt` 会保存新版本 artifact。
- 新 artifact 的 `structuredContent.storage.cozePptx` 包含本地输出路径、文件名、字节数、sha256 和生成模式。
- route 响应不包含 token、远程 PPTX URL 或私有端点。
- 对非 `ppt_draft` artifact 调用 route 返回 400。
- PPTX 下载 route 优先返回本地 Coze PPTX buffer。

### M17-2：PPTX 下载回归

命令：

```powershell
node --test tests\artifact-pptx-download.test.mjs
```

通过标准：

- 无 Coze 文件时仍可生成 M11 最小 PPTX。
- 非 PPT artifact 仍被拒绝。

### M17-3：总测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M17-4：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma Client、Next.js 编译、TypeScript 和静态页面生成均通过。

### M17-5：提交前审查

命令：

```powershell
git diff --check
git status --short
```

通过标准：

- `.env`、`.tmp`、真实 PPTX、token、远程签名 URL 不进入 git。
- 新增 route 不把工程词暴露到教师可见前端。
- 只提交 M17 范围内的文档、测试、服务端模块和 route。

## 3. 失败处理

- 如果 route 返回远程 URL，必须改为本地下载转存。
- 如果本地路径可越界读取，必须加路径约束。
- 如果非 PPT artifact 可触发 Coze，必须阻断。
- 如果材料包仍使用最小 PPTX 而忽略已生成的 Coze 文件，必须修正选择逻辑。
