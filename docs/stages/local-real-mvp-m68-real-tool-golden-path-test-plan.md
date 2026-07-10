# M68 真实工具金路径闭环测试计划

日期：2026-07-11

## 1. 测试目标

验证 M68 不再把 blocked tool、清单或缺材料 ZIP 当成真实闭环；所有可执行工具必须基于服务端 resolved Artifact、真实文件和质量门禁产出结果。

## 2. 关键用例

### 2.1 工具注册

- `asset_image_generate` 是 implemented provider tool，输入 `asset_brief_generate`，输出 `asset_image_generate`。
- `concat_only_assemble` 是 implemented package tool，输入 `video_segment_generate`，输出 `concat_only_assemble`。
- `final_package` 是 implemented package tool，输入 `requirement_spec`、`lesson_plan`、`ppt_design_draft`、`pptx_artifact`、`image_prompts`、`concat_only_assemble`，输出 `final_delivery`。
- OpenAI function schema 不暴露 provider、storage、token、路径等工程词。

### 2.2 resolved Artifact 门禁

- provider/package 工具缺 resolved Artifact 时返回 `needs_input`。
- 裸 `artifactRefs`、跨项目 Artifact、未批准 Artifact、kind/nodeKey 不匹配 Artifact 均不得执行。
- 同类 Artifact 多版本时只使用传入 resolved 列表中最新已批准版本。

### 2.3 资产图

- 基于 `asset_brief_generate` 调用图片 provider。
- 成功结果保存为 `asset_image_generate`，包含 `storage.imageAsset`、bytes、sha256、mime、sourceArtifactId。
- 失败或无效图片不得保存为成功 Artifact。

### 2.4 只拼接视频

- 只接受已批准 `video_segment_generate` Artifact。
- 按 artifact version / 更新时间稳定排序拼接。
- 输出必须是可校验 MP4，保存为 `concat_only_assemble`，包含 `storage.videoAsset` 和 sourceArtifactIds。
- 片段缺失、无效、路径越界或拼接后校验失败时返回失败。

### 2.5 最终材料包

- 必须包含真实 PPTX、课堂图片、最终导入视频、final-delivery.md、manifest metadata。
- 缺 PPTX、图片或视频任一项时失败。
- 下载 Route 优先读取已保存的 `final_delivery.storage.packageAsset`；旧临时组包不能绕过缺材料门禁。

## 3. 回归命令

```powershell
npx vitest run tests/tool-registry.test.ts tests/tool-router.test.ts tests/provider-tool-adapter.test.ts tests/package-tool-adapter.test.ts --maxWorkers=1
node --test tests/artifact-package-download.test.mjs
npm test
npm run build
git diff --check
graphify update .
```

## 4. 不通过即阻断

- 任一工具成功但缺 `artifactTruth` 或 `qualityGate`。
- 最终包缺 PPTX、图片或视频仍返回成功。
- Route 直接根据 final_delivery 清单临时拼出“完整包”。
- 教师可见结果中出现工程词、绝对路径、token 或 provider 内部字段。
