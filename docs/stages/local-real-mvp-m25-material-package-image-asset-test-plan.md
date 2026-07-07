# Local Real MVP M25 Material Package Image Asset Test Plan

日期：2026-07-07

## 1. 测试目标

M25 测试目标是验证最终材料包在存在本地图片 artifact 时包含 PNG/JPEG 文件，并在 README 中正确说明图片已包含但仍需教师核对；同时保证没有图片时旧材料包能力不回归，已有视频集成不回归。

## 2. 集中验收命令

### M25-1：材料包生成器 Node 测试

命令：

```powershell
node --test tests\artifact-package-download.test.mjs
```

通过标准：

- 无图片输入时仍包含 `README.md`、`final-delivery.md`、`ppt-outline.pptx`。
- 有图片输入时额外包含 `classroom-visual.png` 或 `classroom-visual.jpg`。
- 图片 buffer 与输入 PNG/JPEG 一致。
- README 有图片时说明“已包含课堂视觉图”，并提醒正式授课前核对视觉准确性、版权和课堂适配。
- README 无图片时不得出现“图片文件已生成”。
- 有视频输入时 `intro-video.mp4` 仍保持可打包。
- 非 final delivery artifact 仍被拒绝。

### M25-2：材料包 route 集成测试

命令：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage13-material-package.test.ts --maxWorkers=1
```

通过标准：

- 项目内存在带 `storage.imageAsset` 的 PPT artifact 时，package route 返回 ZIP。
- ZIP 包含 `classroom-visual.png`。
- ZIP 中图片文件头包含 PNG 魔数。
- 非 final delivery artifact 仍返回 400。

### M25-3：全量回归测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M25-4：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Next.js 编译和 TypeScript 通过。
- 如仍有 Turbopack output tracing warning，确认是否仍指向既有本地视频读取风险，并记录到报告。

### M25-5：提交前审查

命令：

```powershell
git diff --check
git check-ignore -v .env .tmp .tmp\stage13-image-package-test
```

通过标准：

- `.env`、`.tmp` 和真实图片不进入 git。
- 文档、测试和代码不包含真实 key、token、私有端点、task id 或远程签名 URL。

## 3. 失败处理

- 如果无图片材料包旧测试失败，优先保持向后兼容，不把图片变成必需资产。
- 如果 route 测试必须读取本地图片，只使用 `.tmp` fixture。
- 如果图片路径安全能力需要变更，必须复用 M24 helper，不在 package route 中重新手写路径读取。
- 如果构建 warning 仍出现，只记录生产存储风险；除非影响 exit code 或本地 MVP 可用性，不为消 warning 破坏本地文件能力。
