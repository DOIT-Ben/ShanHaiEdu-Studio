# Local Real MVP M23 Material Package Video Asset Test Plan

日期：2026-07-07

## 1. 测试目标

M23 测试目标是验证最终材料包在存在本地视频 artifact 时包含 MP4 文件，并在 README 中正确说明视频已包含但仍需教师核对；同时保证没有视频时旧材料包能力不回归。

## 2. 集中验收命令

### M23-1：材料包生成器 Node 测试

命令：

```powershell
node --test tests\artifact-package-download.test.mjs
```

通过标准：

- 无视频输入时仍包含 `README.md`、`final-delivery.md`、`ppt-outline.pptx`。
- 有视频输入时额外包含 `intro-video.mp4`。
- `intro-video.mp4` buffer 与输入 MP4 一致。
- README 有视频时说明“已包含导入视频文件”，并提醒正式授课前核对视频质量。
- README 无视频时不得出现“视频成片已生成”。
- 非 final delivery artifact 仍被拒绝。

### M23-2：材料包 route 集成测试

命令：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage13-material-package.test.ts --maxWorkers=1
```

通过标准：

- 项目内存在带 `storage.videoAsset` 的导入视频 artifact 时，package route 返回 ZIP。
- ZIP 包含 `intro-video.mp4`。
- ZIP 中视频文件头包含 MP4 `ftyp` box。
- 非 final delivery artifact 仍返回 400。

### M23-3：全量回归测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M23-4：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Next.js 编译和 TypeScript 通过。

### M23-5：提交前审查

命令：

```powershell
git diff --check
git check-ignore -v .env .tmp
```

通过标准：

- `.env`、`.tmp` 和真实 MP4 不进入 git。
- 文档、测试和代码不包含真实 key、token、私有端点、task id 或远程签名 URL。

## 3. 失败处理

- 如果无视频材料包旧测试失败，优先保持向后兼容，不把视频变成必需资产。
- 如果 route 测试必须读取本地 MP4，只使用 `.tmp` fixture。
- 如果构建出现 output tracing warning，记录风险；除非影响 exit code 或本地 MVP 可用性，不为消 warning 破坏本地文件能力。
