# V1 Stage 3B：PPT 关键样张、正式资产与来源证据计划

日期：2026-07-12

状态：implementation verified / real teacher approval pending

关联需求：`RQ-024 PPT Quality 纵向闭环`

## 1. 目标

在 Stage 3A `PptDesignPackage` 上建立关键样张和正式资产的可执行事实，使系统能够回答：

1. 每个 `AI_SCENE` / `AI_ASSET` 为什么生成、服务哪些 pageId、使用什么 Prompt 和构图安全区。
2. 资产是否真实来自图片 Provider，文件、hash、尺寸、透明策略、任务身份和允许的后处理链是否完整。
3. 关键样张是否同时提交场景总览、小素材总览和正式组装样张总览，并且每个样张页 D/V/P 均通过。
4. 教师批准是否精确绑定当前样张包 digest；设计、资产或样张变化后旧批准是否失效。
5. 批量生产是否只使用已批准样张规则和 manifest，而不是重新自由发挥。

## 2. 当前源码事实

- Stage 3A 已有结构化设计包、稳定 pageId/assetId、样张计划和页级影响分析。
- 当前 `image_asset` 只从整份 `ppt_draft` 生成一张 1024×1024 low 方图，Prompt 仍是通用百分数导入页描述。
- 当前图片 Artifact 记录文件 sha256、mime 和 sourceArtifactId，但没有 pageId/assetId、Provider task、prompt digest、尺寸、透明策略或处理链 manifest。
- 当前 `approveArtifact` 只有布尔批准，没有针对样张容器的包 digest、批准动作来源和失效条件。
- 当前 Coze 只消费文本设计稿，不能证明批准样张或正式资产进入 PPTX；3B 不改造 Coze 为质量 composer。

## 3. 业务依据

- 用户提供的 PPT V8 手册与项目内 PPT 生产工艺设计。
- `textbook-ppt-workflow` 的 `key_samples`、`backgrounds`、`assets` 阶段纪律。
- 关键样张必须包含三份独立总览：场景与主教具、关键小素材微批次、正式组装样张。
- D/V/P 分别证明设计遵循、视觉质量和来源真实性；任一失败都不能批准。
- 具象物件只能来自真实生图；本地只允许去背、裁切、缩放、轻色彩校正、格式转换、别名和实例复制。

## 4. 子阶段

### 3B-1 资产请求与来源合同

新增：

- `PptAssetRequestBatch`：从批准的 `PptDesignPackage` 确定性提取场景和小素材请求。
- `PptAssetManifest`：每个 assetId 绑定 pageIds、角色、文件、sha256、尺寸、透明策略、Provider/model/task、inputHash、promptDigest 和处理链。
- `PptAssetLineageValidator`：阻断 placeholder、stand-in、mock、临时替代、本地绘制主体、未知来源、hash 缺失和非法处理链。

场景和素材共享 assetId 时必须具有同一权威 Prompt/角色；冲突时阻断，不静默覆盖。

### 3B-2 关键样张容器与三总览门

新增 `PptKeySampleSet`：

- 样张页必须精确来自 `PptSamplePlan`，覆盖 3-4 页、至少两个 layout family 和一个高风险页。
- 三份总览必须是三个独立、真实、可读取的输出引用，不能合并成一张或只给文件列表。
- 每个组装样张页绑定真实 manifest assetId 和可编辑层摘要，不允许 rasterize 精确文字/数学内容。
- 每页 D/V/P 均为 passed，且 findings 为空，样张包才可进入教师批准。

### 3B-3 样张批准与失效

- `PptSampleApproval` 精确绑定 sampleSetDigest、designPackageDigest、批准动作来源和时间。
- 只有当前包通过确定性 validator 后才能写批准；“继续”不等于样张批准。
- page/asset/视觉系统/叙事变化导致 sampleSetDigest 改变时，旧批准自动失效。
- 批量背景/素材生成必须携带当前批准证据，不允许只凭 `isApproved=true` 或旧 actionId 继续。

### 3B-4 Provider 请求证据

- 图片请求必须按 assetId 独立形成 inputHash 和幂等键，绑定 pageIds、Prompt、negative prompt、画幅与安全区。
- 需要参考图时记录 `referenceAssetIds` 和实际发送的引用摘要；不能只在 Prompt 里说“参考某图”。
- Provider 返回后先 staging，再验证真实文件、mime、尺寸和 sha256，最后进入 manifest。
- 本阶段只在计划明确的 smoke 中调用真实 Provider；没有真实文件时保持未完成，不制造假 manifest。

## 5. 代码边界

预计新增：

```text
src\server\ppt-quality\ppt-asset-types.ts
src\server\ppt-quality\ppt-asset-request-builder.ts
src\server\ppt-quality\ppt-asset-validator.ts
src\server\ppt-quality\ppt-sample-validator.ts
tests\ppt-asset-request-contract.test.ts
tests\ppt-asset-manifest.test.ts
tests\ppt-key-sample-gate.test.ts
```

后续按红测需要修改：

```text
src\server\ppt-quality\ppt-quality-types.ts
src\server\ppt-quality\ppt-design-validator.ts
src\server\tools\tool-registry.ts
src\server\tools\provider-tool-adapter.ts
src\server\image-generation\image-generation-run.ts
src\server\workbench\repository.ts
```

不得把样张、manifest、单资产全部扩成顶层固定 DAG 节点；它们是 PPT Tool/Artifact 内可展开子工件，Main Agent 仍按 WorldState 和教师意图选择动作。

## 6. 非目标

- 不在 3B 生成或宣称完成最终精品 PPTX。
- 不使用旧文本 PPTX builder 或 Coze 证明质量路径完成。
- 不在没有真实图片文件时制造通过的 provenance。
- 不实现最终 composer、PDF/逐页 PNG/contact sheet 和全套 Delivery Critic；这些属于 3C。
- 不允许模糊“继续”直接批准样张或授权未披露的 Provider 批次。

## 7. 完成标准

- 3B 测试计划全部通过。
- 资产请求能从 PageSpec 确定性提取，assetId 冲突稳定失败。
- 完整 manifest 通过；缺 hash/task/input、非法本地来源、placeholder、非法处理链和未绑定 pageId 稳定失败。
- 三总览、样张页、D/V/P、可编辑数学层和 manifest 绑定全部通过后才可批准。
- 批准精确绑定 digest；任一相关输入变化后旧批准失效。
- Provider 请求证据能证明实际发送的 assetId、Prompt、参考资产和 inputHash。
- `npm test`、`npm run build`、SQLite 连续初始化和 `git diff --check` 通过。

## 8. 后续阶段

```text
3C：质量 composer、真实 PPTX、PDF/PNG/contact sheet、Delivery Critic、页级返修和 12 页试点
```
