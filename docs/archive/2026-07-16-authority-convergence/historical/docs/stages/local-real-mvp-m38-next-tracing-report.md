# Local Real MVP M38 Next Standalone Tracing Report

日期：2026-07-07

## 1. 阶段目标

M38 目标是收敛 Next standalone 构建中的 NFT tracing warning，避免 video route 因运行时本地素材路径把项目根、生成物、本地数据或文档误带入 route trace。

本阶段不改变 PPT、图片、视频生成能力，不改变 provider 凭据读取，不删除 `desktop:prepare`，不声明正式客户端签名或公网发布完成。

## 2. 根因与变更

根因：

- `npm run build` exit 0，但 Turbopack 提示 `Encountered unexpected file in NFT list`。
- import trace 指向 `local-artifact-storage.ts -> video-generation-run.ts -> video route`。
- video route 的 NFT 清单曾包含 `.tmp`、`data`、`desktop-bundle`、文档、测试和根级项目文件，说明动态本地素材路径触发了过宽 tracing。

本阶段变更：

- `src\server\artifact-storage\local-artifact-storage.ts` 对运行时 `process.cwd()` 路径加 `turbopackIgnore` 标记。
- `next.config.ts` 为 API routes 增加 `outputFileTracingExcludes`，排除本地生成物、测试、文档、桌面 bundle、根级非运行配置和本地数据库。
- `tests\next-tracing-readiness.test.mjs` 增加 M38 静态防回归测试。

## 3. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\next-tracing-readiness.test.mjs` | 通过；2 tests passed |
| `node --test tests\artifact-storage.test.mjs` | 通过；2 tests passed |
| `npm run build` | 通过；exit 0；不再出现 NFT tracing warning |
| `npm run desktop:prepare` | 通过；`ok=true` |
| `npm run desktop:installer-smoke` | 通过；默认模式 `installerMode=skipped`，unpacked exe HTTP 200 |

补充 NFT 清单检查：

- video route NFT 清单总数：250。
- 本地生成物、项目文档、测试、桌面 bundle、本地数据库等风险项计数：0。

## 4. 审查结论

M38 已消除当前 Next standalone 构建中的 Turbopack NFT tracing warning，并把 API route 的本地生成物排除策略固化到 `next.config.ts` 和静态测试中。

当前仍保留：

- `desktop:prepare` 作为桌面打包安全过滤门禁。
- ArtifactStorage 的 `.tmp` 默认模式和 `ARTIFACT_STORAGE_ROOT` 部署卷模式。
- 未签名客户端候选包边界。

当前仍不能表述为：

- 对象存储、CDN、素材生命周期清理已完成。
- 独立生产 worker 已完成。
- 正式签名客户端、自动更新或公网生产部署已完成。

## 5. 下一阶段建议

优先级从高到低：

1. 补 Electron 图标、description、author、asar/asarUnpack 和基础 crash/log 目录。
2. 做公网正式认证规划，覆盖密码/OAuth/SSO、CSRF token、管理员、共享协作和审计日志。
3. 做任务队列生产化规划，覆盖 worker、重试、取消、限流、监控和失败 repair。
4. 做 WebKit、真实移动设备或触摸手势专项验证。
