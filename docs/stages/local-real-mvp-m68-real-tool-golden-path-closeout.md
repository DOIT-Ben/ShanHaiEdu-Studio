# M68 真实工具金路径闭环收尾

日期：2026-07-11

状态：工程完成；真实外部 provider smoke 未执行

## 1. 完成内容

- `asset_image_generate` 已从 blocked tool 改为可执行 provider tool，基于已批准 `asset_brief_generate` 调用图片 provider，保存为 `asset_image_generate` Artifact。
- `concat_only_assemble` 已从 blocked tool 改为可执行 package tool，只读取已批准 `video_segment_generate`，按版本与时间顺序拼接真实 MP4，并保存为 `concat_only_assemble` Artifact。
- `final_package` 已升级为 `create_final_package` package tool，必须读取真实 PPTX、课堂图片和导入视频，生成保存版 ZIP 材料包。
- 最终 ZIP 必须包含 `ppt-outline.pptx`、`classroom-visual.png/jpg`、`intro-video.mp4`、`final-delivery.md` 和 `manifest.json`。
- 下载 Route 优先读取 `final_delivery.storage.packageAsset` 中已保存的 ZIP；旧临时组包路径仍保留兼容，但现在缺图片或视频会失败。
- ToolRouter 对 package tool 使用与 provider tool 相同的服务端 `resolvedArtifacts` 门禁，裸 `artifactRefs` 不可触发执行。
- `LocalArtifactStorage` 新增 `package-artifacts` 存储类别。
- 工作流最终交付上游已校准为需求、教案、PPT 设计稿、PPTX、课堂图片和拼接视频。

## 2. 关键边界

- 本阶段不做视频转码、转场、滤镜、字幕烧录或复杂剪辑；文件级拼接后必须通过 MP4 基础校验，否则失败。
- `intro_video` 旧工具仍保持 blocked，M68 真实链路使用结构化视频前置链路、视频片段和 `concat_only_assemble`。
- 未执行真实外部图片、视频或 PPTX provider 网络 smoke；本阶段验证覆盖 adapter、storage、quality gate、download contract 和本地构建。

## 3. 验证证据

```text
npx vitest run tests/tool-registry.test.ts tests/tool-router.test.ts tests/provider-tool-adapter.test.ts tests/package-tool-adapter.test.ts --maxWorkers=1
  4 files passed / 57 tests passed

node --test tests/artifact-package-download.test.mjs
  5 tests passed / 0 failed

npm test
  Node: 198 passed / 0 failed
  Vitest: 459 passed / 0 failed

npm run build
  Prisma Client generated
  Next.js production build exit 0
```

## 4. 未包含范围

- 未执行真实外部 Provider 网络 smoke。
- 未把 provider/package 工具暴露给 OpenAI native tool loop。
- 未实现 MCP Client Adapter。
- 未完成多用户管理和前端功能需求收口。

## 5. 下一步

按用户指定顺序，下一阶段进入 M69 内测版本多用户管理：支持分配账号登录，公开注册继续关闭；补齐管理员用户管理、账号停启用、凭据重置、会话撤销、项目/产物/反馈共享与隔离机制，并在完成后提交不推送。
