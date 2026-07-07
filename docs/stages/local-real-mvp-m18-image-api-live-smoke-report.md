# Local Real MVP M18 Image API Live Smoke Report

日期：2026-07-07

## 1. 阶段目标

M18 将图片能力从台账 readiness 推进到服务端真实 live smoke：使用私有台账固定 `free` 图片通道调用 OpenAI-compatible 图片生成接口，生成一张本地课堂视觉图，并完成最小图片合法性校验。

本阶段不把图片能力接入教师 UI，不宣称图片 artifact adapter 已完成，不提交真实图片文件。

## 2. 开发与修正

- 新增 `scripts\image-smoke.mjs`，支持解析 `b64_json` 和 URL 两类图片响应。
- 新增 PNG/JPEG 魔数校验，真实输出落到 `.tmp\image-smoke\`。
- 新增 `IMAGE_PROVIDER_CHANNEL` 通道选择，M18 固定使用 `free`。
- 修复 endpoint 拼接：台账 base URL 可以是根地址、`/v1` 地址或完整 `/v1/images/generations` endpoint，脚本统一规范为正确 generation endpoint。
- 新增 `tests\image-smoke-script.test.mjs`，覆盖响应解析、图片校验、endpoint 拼接、缺 env 门禁和 `free` 通道脱敏失败输出。

## 3. 验收证据

### M18-1 脚本单元测试

命令：

```powershell
node --test tests\image-smoke-script.test.mjs
```

结果：通过，5 tests passed。

### M18-2 真实图片 live smoke

命令：

```powershell
node scripts\image-smoke.mjs
```

结果：通过。

脱敏输出摘要：

```json
{
  "ok": true,
  "provider": "image_generation",
  "channel": "free",
  "model": "gpt-image-2",
  "fileName": "m18-1783408992232-percentage-intro.png",
  "localOutput": ".tmp/image-smoke/m18-1783408992232-percentage-intro.png",
  "bytes": 1196644,
  "sha256": "b9778aafad1883a5d97de0609025614f81ce54c091a3429ab3f15a7826ca17a7",
  "imageValid": true,
  "mime": "image/png"
}
```

## 4. 安全与边界

- `.env` 仅本地映射固定通道变量，未提交。
- `.tmp\image-smoke\` 中的真实图片未提交。
- 文档、脚本输出和测试不包含真实 key、token、私有端点、远程图片 URL 或完整 provider 响应。
- `primary` 通道曾返回 403，`free` 通道为本阶段固定可用通道；后续如果切换通道，必须重新跑 live smoke。

## 5. 集中回归

命令：

```powershell
npm test
npm run build
git diff --check
git check-ignore -v .env .tmp .tmp\image-smoke\m18-1783408992232-percentage-intro.png
```

结果：

- `npm test` 通过：Node 26 tests passed；Vitest 17 files / 71 tests passed。
- `npm run build` 通过：Prisma Client、Next.js 编译、TypeScript 和静态页面生成均通过。
- worker 残留检查通过：未发现 `vitest`、`jest`、`playwright`、`image-smoke` 或 `node:test` 残留进程。
- `git diff --check` 通过；仅提示 `docs\stages\local-real-mvp-current-state-audit.md` 下次 Git 接触时 LF 会替换为 CRLF，不是空白错误。
- `.env`、`.tmp` 和真实图片输出均被 `.gitignore` 忽略。
- 敏感模式扫描通过，未发现真实 key、token、私有端点或远程签名 URL。

## 6. 剩余工作

M18 只证明真实图片 API 与本地文件链路可用。后续仍需分阶段完成：

1. 图片 artifact adapter：把真实图片文件保存到后端产物层，并纳入最终材料包或图片节点。
2. 图片质量与尺寸校验：补充尺寸解码、slot 合同、失败恢复和教师可见边界。
3. 视频真实 API readiness/live smoke。
4. 账号权限和生产部署准备。
