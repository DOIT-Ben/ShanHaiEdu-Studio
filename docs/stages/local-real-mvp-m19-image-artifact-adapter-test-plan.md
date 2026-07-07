# Local Real MVP M19 Image Artifact Adapter Test Plan

日期：2026-07-07

## 1. 测试目标

M19 测试目标是验证 M18 的真实图片生成能力可以被后端 artifact adapter 安全承接：从 `ppt_draft` artifact 触发图片生成后，后端保存一个新版本 `ppt_draft` artifact，并在 `structuredContent.storage.imageAsset` 中记录本地图片 metadata，同时不泄露 key、token、私有端点或远程图片 URL。

## 2. 集中验收命令

### M19-1：后端 artifact adapter 定向测试

命令：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/image-generation/__tests__/image-artifact-adapter.test.ts --maxWorkers=1
```

通过标准：

- `ppt_draft` artifact 可以触发图片生成 route。
- route 调用 `generateImageFromArtifact`，并把返回的本地图片 metadata 保存进新 artifact。
- 新 artifact 标题、摘要和 markdownContent 不伪装完整图片工作流已完成。
- route 响应不包含 `Bearer`、远程 URL、key 或完整 provider 响应。
- 非 `ppt_draft` artifact 返回 400，且不调用 provider adapter。

### M19-2：M18 图片脚本契约回归

命令：

```powershell
node --test tests\image-smoke-script.test.mjs
```

通过标准：

- 图片响应解析、魔数校验、endpoint 拼接、缺 env 门禁和 `free` 通道脱敏输出均通过。

### M19-3：项目回归测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M19-4：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma Client、Next.js 编译、TypeScript 和静态页面生成均通过。

### M19-5：提交前审查

命令：

```powershell
git diff --check
git check-ignore -v .env .tmp
```

通过标准：

- `.env`、`.tmp`、真实图片文件、token、远程图片 URL 不进入 git。
- 文档、脚本、route 和测试不包含真实 key、私钥、远程签名 URL 或完整 provider 响应。
- 没有新增教师 UI 工程词暴露。

## 3. 失败处理

- 如果 provider adapter 失败，route 只返回教师可理解错误，不打印底层凭据、端点或堆栈。
- 如果返回图片不是 PNG/JPEG，adapter 记录 `invalid_image_output`，不把 HTTP 200 当成功。
- 如果本地路径越界或文件缺失，下载/读取能力不得放行；M19 只保存 metadata，不新增下载 route。
- 如果测试发现 `storage` 等内部字段进入教师 UI，本阶段必须先修复红线，再继续。
