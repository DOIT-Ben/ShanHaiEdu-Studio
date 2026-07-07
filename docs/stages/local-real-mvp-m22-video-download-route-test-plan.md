# Local Real MVP M22 Video Download Route Test Plan

日期：2026-07-07

## 1. 测试目标

M22 测试目标是验证已保存 `storage.videoAsset` 的 artifact 可以通过后端 `GET /video` 下载本地 MP4 文件，同时拒绝缺少视频资产或指向 `.tmp` 外路径的 artifact。

## 2. 集中验收命令

### M22-1：视频下载 route 目标测试

命令：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/video-generation/__tests__/video-download-route.test.ts --maxWorkers=1
```

通过标准：

- 带 `structuredContent.storage.videoAsset.localOutput` 的 artifact 返回 200。
- 响应 `content-type` 为 `video/mp4`。
- 响应 `content-disposition` 为附件下载，并包含安全 MP4 文件名。
- 返回 buffer 与 `.tmp` 中的 fixture MP4 完全一致。
- 缺少 `videoAsset` 的 artifact 返回 400。
- 指向 `.tmp` 外的 localOutput 返回 400。
- route 响应不包含 task id、远程 URL、token 或私有端点。

### M22-2：全量回归测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M22-3：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Next.js route 编译通过。

### M22-4：提交前审查

命令：

```powershell
git diff --check
git check-ignore -v .env .tmp .tmp\video-download-test
```

通过标准：

- `.env`、`.tmp`、测试 MP4 和真实 MP4 不进入 git。
- 文档、测试和代码不包含真实 key、token、私有端点、task id 或远程签名 URL。

## 3. 失败处理

- 如果红灯测试不是因为 `GET` route 或下载 helper 缺失，而是测试夹具错误，先修测试。
- 如果下载路径安全测试失败，不允许通过放宽路径约束解决。
- 如果 build 失败，先修 TypeScript 类型，不以局部测试通过代替构建验收。
