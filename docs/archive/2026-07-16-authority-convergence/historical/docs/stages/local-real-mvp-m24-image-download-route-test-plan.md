# Local Real MVP M24 Image Download Route Test Plan

日期：2026-07-07

## 1. 测试目标

M24 测试目标是验证已保存 `storage.imageAsset` 的 artifact 可以通过后端 `GET /image` 下载本地 PNG/JPEG 文件，同时拒绝缺少图片资产或指向 `.tmp` 外路径的 artifact。

## 2. 集中验收命令

### M24-1：图片下载 route 目标测试

命令：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/image-generation/__tests__/image-download-route.test.ts --maxWorkers=1
```

通过标准：

- 带 `structuredContent.storage.imageAsset.localOutput` 的 artifact 返回 200。
- 响应 `content-type` 为 `image/png` 或 `image/jpeg`。
- 响应 `content-disposition` 为附件下载，并包含安全图片文件名。
- 返回 buffer 与 `.tmp` 中的 fixture 图片完全一致。
- 缺少 `imageAsset` 的 artifact 返回 400。
- 指向 `.tmp` 外的 localOutput 返回 400。
- route 响应不包含远程 URL、token 或私有端点。

### M24-2：全量回归测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M24-3：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Next.js 编译和 TypeScript 通过。

### M24-4：提交前审查

命令：

```powershell
git diff --check
git check-ignore -v .env .tmp .tmp\image-download-test
```

通过标准：

- `.env`、`.tmp`、测试图片和真实图片不进入 git。
- 文档、测试和代码不包含真实 key、token、私有端点或远程签名 URL。

## 3. 失败处理

- 如果红灯测试不是因为 `GET` route 或下载 helper 缺失，而是测试夹具错误，先修测试。
- 如果下载路径安全测试失败，不允许通过放宽路径约束解决。
- 如果 build 出现 output tracing warning，记录风险；除非影响 exit code 或本地 MVP 可用性，不为消 warning 破坏本地文件能力。
