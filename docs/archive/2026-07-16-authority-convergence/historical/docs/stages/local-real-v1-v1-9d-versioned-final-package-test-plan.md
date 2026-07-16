# V1-9D 版本一致最终包测试计划

更新时间：2026-07-13

## 1. 合同测试

- `ClassroomRunSpecDraft` 缺字段、顺序错误、课程锚点不一致时拒绝。
- 服务端计算的 `courseVersionId`、`reviewBatchId` 为稳定 SHA-256，同一输入重复运行一致。
- 任何来源 Artifact id、version、digest 或审查证据变化都会改变对应绑定。
- `ClassroomRunSpec` 必须同时绑定 courseVersion、courseAnchor 和 reviewBatch。

## 2. 最终资格测试

- PPTX 必须存在有效 `pptFullDeckPackage`、通过的 Full Deck Review 和教师批准状态。
- 最终视频必须存在五类真实审查证据、通过的 `videoFinalReview` 和 `videoFinalApproval`。
- 图片、PPTX、PDF、视频必须来自安全存储路径，实际文件 hash 与 Artifact 证据一致。
- 教案、PPT、图片、旁白脚本和视频必须属于同一项目且均已批准。
- 任一资格不满足时返回 `quality_gate_failed`，`artifactCreated=false`，不保存最终包 Artifact。

## 3. ZIP 与 manifest 测试

- 必含 lesson plan、PPTX、PDF、image、video、`manifest.json` 和 `classroom-run-spec.json`。
- manifest 必含五种文件角色、来源 Artifact id/version/digest、bytes、SHA-256、courseVersionId、courseAnchor、reviewBatchId。
- 反向打开 ZIP 后逐文件复算大小和 SHA-256。
- PPTX 真实 slideCount、PDF pageCount 和视频 ffprobe 证据满足当前 V1 门禁。
- 包状态只能是 `integration_review_passed`；本阶段不得伪造教师最终签收。

## 4. Main Agent 与 Tool 测试

- Main Agent 输出 Schema 允许 `classroomRunSpecDraft`，其他未知字段仍拒绝。
- Main Agent 提出最终包时会被明确提示先形成课堂运行顺序，并复用当前课程锚点。
- `create_final_package` Tool Schema 和前置 Artifact 列表包含旁白脚本。
- Package Tool 成功结果持久化版本化 manifest、ClassroomRunSpec、包 digest 和 sourceArtifactIds。
- 旧 `buildFinalMaterialPackageDownload()` 不再出现在生产 `executeFinalPackage()` 调用路径。

## 5. 回归命令

```powershell
$env:VITEST_MAX_WORKERS='1'
npx vitest run tests/versioned-final-package.test.ts tests/package-tool-adapter.test.ts tests/tool-registry.test.ts tests/model-main-conversation-agent.test.ts --maxWorkers=1
npx tsc --noEmit
npm test
npm run build
git diff --check
```

完整 Vitest 使用单 worker，避免共享 SQLite 测试文件产生锁竞争和伪失败。
