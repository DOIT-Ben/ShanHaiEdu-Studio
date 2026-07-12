# V1 Stage 3C：PPT 全量生产、渲染审查与页级返修计划

日期：2026-07-12

状态：implementation in progress / review and page-repair engine verified

关联需求：`RQ-024 PPT Quality 纵向闭环`

## 1. 目标

在 Stage 3A 结构化 `PptDesignPackage` 和 Stage 3B 真实样张/资产合同之上，建立不依赖旧 Coze 文本 builder 的精品 PPT 全量生产路径：生成至少 12 页真实可编辑 PPTX，并产出 PDF、逐页 PNG、contact sheet、页级质量报告和可局部返修的稳定 locator。

## 2. 强制入口门

- 全量生产必须消费当前 `PptDesignPackage`、`PptAssetRequestBatch(scope=full_production)` 和完整 `PptAssetManifest`。
- Provider 全量资产批次必须获得与当前 design/sample digest 一致的真实 `PptSampleApproval`；工程测试可使用显式 fixture，但不得作为真实验收证据。
- 旧 Coze、文本 fallback、页面截图整页栅格化和缺资产降级路径不能证明 Stage 3C 完成。
- 每页精确文字和数学内容必须保留为 PPTX 原生可编辑层。

## 3. 子阶段

### 3C-1 全量生产合同

- 新增全量 deck candidate/accepted package 合同。
- 绑定 designPackageDigest、full requestBatchDigest、full manifestDigest 和 sample approval digest。
- 完整覆盖连续 pageId；缺页、重复页、错 asset/page 绑定或 stale approval 均失败。

### 3C-2 12 页 composer

- 从 PageSpec 的显式 composition 按 zIndex 组装每一页。
- AI_SCENE/AI_ASSET 只读取 manifest 注册文件；EDITABLE_TEXT/EDITABLE_MATH 写入原生文本层。
- 输出真实 PPTX zip、真实 slideCount、文件 sha256、字节数和逐页编辑层摘要。

### 3C-3 多格式渲染与硬门

- LibreOffice 将 PPTX 转 PDF；Poppler 将 PDF 转逐页 PNG。
- PPTX slideCount、PDF pageCount、PNG count 和 PageSpec count 必须一致。
- contact sheet 为独立真实文件；每个输出记录 storage ref、sha256 和 pageId。

### 3C-4 Delivery Critic 与局部返修

- 每页输出 design/visual/provenance/readability 结果和 unresolved findings。
- 任一页失败时只定位到 pageId/assetId/layerId，不允许整套无差别重跑。
- 页级修复生成新 deck version；未受影响页的 render/asset hash 应保持不变。整套 PPTX/PDF 作为包含改页的聚合交付物会生成新版本，不得将它们误记为未变更页的重复渲染。
- 所有页通过后才可形成 final-eligible PPT production package。

## 4. 完成标准

1. 12 页真实 PPTX、PDF、12 张 PNG 和 contact sheet 页数/哈希一致。
2. 所有 PageSpec 的文字、数学层和批准资产均可追溯并真实嵌入。
3. Delivery Critic 能阻断至少一种页面问题并精确指向 pageId/layerId。
4. 单页返修只失效目标页和相关报告，其他页不重生成。
5. 完整测试、TypeScript、生产构建、SQLite 连续初始化和浏览器关键路径通过。
6. 至少一套真实 12 页 Provider 资产 deck 通过实物审查后，`RQ-024` 才能关闭。

## 5. 当前外部依赖

当前真实样张已有 D/V/P 通过证据，但尚无教师针对当前 `sampleSetDigest` 的明确批准。因此可以完成 3C 工程实现和 fixture 验证；真实全量 Provider 批次必须等待该 HumanGate。

## 6. 2026-07-12 工程检查点

已完成：

- `ppt_full_assets` Provider Capability/Tool：只有当前样张明确批准有效时才允许 `full_production` 批次。
- `ppt_full_deck` Package Capability/Tool：生成等待 Delivery Critic 的候选，不自我批准。
- 通用逐页 composer：样张与全量 deck 共用 PageSpec/composition 组装语义。
- 12 页 PPTX 真伪与 slideCount 门、PDF/PNG 页数一致门、contact sheet 和页级 render hash。
- `PptFullDeckCandidate`、`PptFullDeckPackage` 和 D/V/P/readability 全通过门。
- 完整交付 Planner 已从旧 Coze 单步切换为样张资产、样张组装、全量资产、完整 deck 四步质量路径；旧 Coze 工具仍保留为非 V1 质量主线兼容能力。

工程 fixture smoke 已真实调用 PptxGenJS、LibreOffice、pdfinfo 和 Poppler，得到 12 页 PPTX、12 页 PDF、12 张 PNG 和一张覆盖 12 页的 contact sheet。该证据明确标记为 `engineering_fixture_only_not_real_provider_acceptance`，不能关闭 `RQ-024`。

仍待完成：

1. 教师针对当前真实样张 digest 明确批准。
2. 真实 Provider 生成 12 页完整资产批次并组装真实 deck。
3. 将页级返修执行器注册为 Main Agent 可调用的受控 Tool，并让自然语言局部修改经 PlanGuard 解析为明确的 `pageId` 修复目标。

## 7. 2026-07-12 新鲜验证：审查与局部返修

- 浏览器隔离库验证：失败逐页审查生成“完整 PPT 页级返修包”且确认入口保持受阻；全页通过生成“完整 PPT 交付验收包”，逐页控件只读且确认入口解锁。
- 1366px 与 390px 覆盖 12 页、48 个审查项；390px `scrollWidth=clientWidth=390`，无横向溢出；本轮浏览器控制台无运行时 error。
- `repairPptFullDeckPages` 已将完整 PPTX/PDF 重新封装为新版本，只写入目标 `pageId` 的新 PNG 证据，其他页复用原始 render ref/hash；contact sheet 由复用页和改页重建。
- 自动化证明 `page_06` 变化后候选、PPTX/PDF 和目标页 hash 改变，其他 11 页 render ref/hash 不变。
