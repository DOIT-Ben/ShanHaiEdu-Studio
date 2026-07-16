# M68 真实工具金路径闭环计划

日期：2026-07-11

## 1. 目标

让工具链从“已注册、已路由、部分 provider 可执行”推进到“资产图、视频拼接、最终材料包都能产出真实可校验 Artifact”。本阶段完成后，教师任务可以在服务端门禁下形成 PPTX、图片、导入视频和最终 ZIP 材料包的真实交付链路。

## 2. 范围

纳入本阶段：

- 将 `asset_image_generate` 从 blocked tool 改为可执行 provider tool，复用图片 provider，但输入必须是已批准的 `asset_brief_generate`。
- 将 `concat_only_assemble` 从 blocked tool 改为可执行 package tool，只按已批准的 `video_segment_generate` 顺序拼接真实 MP4 片段，并保存为 `concat_only_assemble` Artifact。
- 将 `final_package` 从内部清单语义升级为真实 ZIP package tool，必须包含真实 PPTX、课堂图片、最终导入视频、清单和 metadata。
- `ToolRouter` 继续只信任服务端 `resolvedArtifacts`，provider/package 工具不得使用模型裸传的 artifact refs 作为事实依据。
- 下载 Route 优先读取已保存的 package Artifact；缺必要真实材料时返回失败，不临时伪装完整包。

不纳入本阶段：

- 视频转码、转场、滤镜、字幕烧录和复杂剪辑。
- MCP Client Adapter。
- 多用户管理和前端体验收口。
- 真实外部 provider smoke；若本机缺少密钥，仅做本地 adapter 与文件门禁验证。

## 3. 实施顺序

1. 写失败测试：工具注册、资产图 provider 输入、视频拼接、真实最终包、下载 Route 门禁。
2. 扩展工具定义：`asset_image_generate`、`concat_only_assemble`、`final_package` 都改为可执行工具。
3. 扩展 provider adapter：资产图使用 `asset_brief_generate`，输出 `asset_image_generate`。
4. 新增 package adapter：视频拼接与最终 ZIP 只使用 resolved artifacts，并写入本地 artifact storage。
5. 调整下载 Route 和工作流上游依赖，确保最终包不再允许缺图片或视频。
6. 跑阶段测试、全量测试、构建、diff 检查和 graphify。
7. 提交本阶段改动，不推送。

## 4. 风险与控制

- 风险：文件级 MP4 拼接可能遇到片段编码或容器不兼容。控制：只做保守拼接并校验输出，失败即阻断，不伪装成功。
- 风险：最终包历史逻辑允许缺图片/视频。控制：M68 后最终包缺任一真实资产直接失败。
- 风险：native loop 或模型伪造 artifact refs 越权触发 provider。控制：沿用 ToolRouter resolved Artifact 校验，测试覆盖裸 refs 被拒。
- 风险：外部 provider 缺密钥导致无法真实联网验收。控制：本阶段先保证 adapter、storage、quality gate、download contract；真实 smoke 留作上线前门禁。

## 5. 验证方式

- `npx vitest run tests/tool-registry.test.ts tests/tool-router.test.ts tests/provider-tool-adapter.test.ts tests/package-tool-adapter.test.ts --maxWorkers=1`
- `node --test tests/artifact-package-download.test.mjs`
- `npm test`
- `npm run build`
- `git diff --check`
- `graphify update .`

## 6. 完成标准

- `asset_image_generate`、`concat_only_assemble`、`final_package` 均为 implemented tool。
- 资产图、拼接视频和最终 ZIP 均写入本地 artifact storage，并包含 `artifactTruth` 与通过的 `qualityGate`。
- 最终 ZIP 包含 PPTX、课堂图片、导入视频、最终说明和 metadata；缺任一项不得成功。
- 工作区提交一笔 M68 commit，不推送。
