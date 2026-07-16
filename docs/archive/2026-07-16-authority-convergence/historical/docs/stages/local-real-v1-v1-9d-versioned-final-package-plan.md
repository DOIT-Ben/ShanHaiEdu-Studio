# V1-9D 版本一致最终包主路径计划

更新时间：2026-07-13

## 1. 目标

把 `create_final_package` 的生产主路径从旧 `buildFinalMaterialPackageDownload()` 切换到既有 `buildVersionedFinalPackage()`，让最终 ZIP 只接受同一批准课程版本、同一课程锚点和同一审查批次的真实教案、PPTX、PDF、课堂视觉图和最终视频。

本阶段不调用真实 Provider，不生成新的完整交付包，不由外部 Codex 编写课堂运行顺序或批准任何产物。

## 2. 当前缺口

- 生产 Package Tool 仍走旧清单打包，只检查 ZIP、PPTX、图片和视频存在。
- 既有版本化打包器尚未进入主路径，也未包含课堂视觉图角色。
- `courseVersionId`、`reviewBatchId` 和来源 Artifact 版本尚未由服务端权威计算。
- `ClassroomRunSpec` 尚未由 Main Agent 提出并与当前课程锚点绑定。
- 旧路径可以在 PPT/视频审查未封闭时形成“基础校验通过”的最终包。

## 3. 设计

### 3.1 决策归属

- Main Agent：提出 `classroom-run-spec-draft.v1`，说明播放视频、提出回接问题、打开 PPT、教师组织活动和答案揭示的课堂顺序。
- 服务端合同：读取当前已批准 Artifact，计算版本、审查批次和文件 hash，校验草案课程锚点，形成最终 `ClassroomRunSpec`。
- Package Tool：只调用版本化打包器，不再调用旧材料包生成器。
- HumanGate：继续负责 `create_final_package` 的执行批准。
- 外部 Codex：只实现与验证，不提供真实 E2E 中的课堂顺序或批准。

### 3.2 权威绑定

- `courseVersionId`：由 projectId 和所有最终来源 Artifact 的 id、kind、version、digest 确定性计算。
- `courseAnchor`：取自已批准且校验通过的 `videoNarrationScript.courseAnchor`；Main Agent 草案必须精确匹配。
- `reviewBatchId`：由通过的 PPT Full Deck Package/Review、视频 Final Review/Approval 证据确定性计算。
- 每个文件记录来源 Artifact id、version、digest、真实 SHA-256 和 `final_eligible`。
- `ClassroomRunSpec` 由服务端补入 `courseVersionId` 与 `reviewBatchId` 后进入 ZIP。

### 3.3 最终文件角色

版本化 ZIP 必须且只能包含：

1. 结构化教案审阅层。
2. 已通过完整审查并由教师批准的 PPTX。
3. 与 PPTX 同一 Full Deck Package 的 PDF。
4. 已批准且真实校验通过的课堂视觉图。
5. 已通过成片 Critic 并由教师批准的最终 MP4。
6. `manifest.json`。
7. `classroom-run-spec.json`。

## 4. 实施范围

- 扩展 `versioned-final-package` 的图片角色、来源血缘和审查批次绑定。
- 新增最终包输入合同，负责从 Artifact 反向构造真实文件集和服务端绑定。
- 扩展 Main Agent `inputDraft`，允许且仅允许结构化 `classroomRunSpecDraft`。
- 更新 `create_final_package` Tool 合同，使视频旁白脚本成为课程锚点硬前置。
- 替换 `executeFinalPackage()` 旧主路径，持久化 manifest、ClassroomRunSpec、包 digest 和来源血缘。
- 保留旧 `artifact-package` 模块供历史下载路径使用，本阶段不做无关删除。

## 5. 风险与回退

- 风险：旧测试夹具没有完整审查/批准证据，将正确转为失败；只更新到真实目标合同，不放宽门禁。
- 风险：Main Agent 未提供 RunSpec 草案时最终包会阻断并产生 Observation；不得自动伪造课堂顺序。
- 风险：PDF/ffprobe 在本机不可用时保持失败，不回退到文本或占位文件。
- 回退：本阶段独立提交，可整体 revert；不修改数据库结构、历史 tag、真实 Provider 配置或部署环境。

## 6. 退出标准

- 生产 `executeFinalPackage()` 只调用 `buildVersionedFinalPackage()`。
- 错版、错锚点、错审查批次、未批准、未通过 Critic、缺文件和 hash 不符全部在最终 Artifact 保存前阻断。
- ZIP 反向校验 manifest、ClassroomRunSpec、角色、文件大小和 SHA-256 通过。
- 专项、Node、Vitest、TypeScript、生产构建和 `git diff --check` 全部通过。
