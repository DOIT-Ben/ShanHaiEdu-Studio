# V1 Stage 3B：PPT 关键样张、正式资产与来源证据 Closeout

日期：2026-07-12

状态：implementation verified / production input invalidated

关联需求：`RQ-024 PPT Quality 纵向闭环`

## 1. 结论

Stage 3B 的工程实现、真实 Provider 资产、真实去背、来源 manifest、PptxGenJS 样张组装、LibreOffice/Poppler 渲染、三份独立总览和 D/V/P 审查已经验证。教师已明确授权当前样张 digest，但后续复核发现该 digest 所绑定的 `design-package.json` 与 `tests\support\ppt-quality-fixture.ts` 一致，属于工程 fixture 设计输入。因此该批准记录和真实图片调用只能证明链路，不具备真实公开课正式资产投产资格。

## 2. 已完成能力

- `PptAssetRequestBatch`、`PptAssetManifest`、`PptKeySampleCandidate`、`PptKeySampleSet` 和 `PptSampleApproval` 合同落地。
- `ppt_sample_assets`、`ppt_key_samples` Capability 及 `assemble_ppt_key_samples` Package Tool 落地。
- 真实 PptxGenJS 可编辑样张、LibreOffice 转 PDF、Poppler 逐页 PNG 和三份独立 contact sheet 落地。
- D/V/P 失败产生返修版本，通过后产生验收版本；教师批准后审查控件只读，返修进入新版本。
- Provider Prompt、模型、文件哈希、尺寸、透明策略、source-to-target 去背处理链和 storage ref 可校验。
- 修复负向 Prompt 误判：`不得出现公式、答案` 不再被误判为请求生成精确内容，真实数字和公式仍被拒绝。

## 3. 真实验收证据

真实生成资产：3 张 1920×1080 场景图、3 张 1024×1024 单体素材。单体素材经过 OpenCV 去背，边界透明率为 1.0，处理链保留源图与成品 sha256。第一版 `page_05` 因灰色背景光晕被人工拒绝，随后通过真实 Provider 重生成青绿色观察框版本并重新去背。

真实图片 Provider 调用及样张组装：`page_02`、`page_05`、`page_10`。第二轮 D/V/P 均为 passed，未解决 findings 为空；当前 `sampleSetDigest` 为：

```text
c95b64fbcf001c1b9b7b320dae3daab425b733488071b46b01d9c11ee7c4422d
```

## 2026-07-12 教师授权

教师已明确批准当前样张 digest，并授权生成真实 12 页正式资产。该授权记录只适用于以上 digest 绑定的当前设计与样张；任何设计或样张变化必须重新进入 HumanGate。

### 2026-07-12 生产资格复核

复核发现该 digest 绑定的设计包与 `tests\support\ppt-quality-fixture.ts` 一致：逐页标题、叙事、场景 brief、素材 brief 和数学层均为工程测试占位文本。真实 Provider 文件不改变输入为 fixture 的事实。为避免将真实计费产物包装成真实公开课交付，当前批准记录不得用于 `full_production`；必须先以真实课程证据建立新的 `PptDesignPackage`、重新生成关键样张并取得新的 digest 批准。

后续已补生产入口硬门：`ppt_full_assets` 在调用图片 Provider 前，逐项解析 `PptDesignPackage.evidenceBindings[].sourceArtifactId`。每项必须对应同项目、已批准的实际工件；任一证据未解析即以质量门失败并停止，不能依靠样张批准或结构校验绕过。

验收运行产物位于忽略目录：

```text
.tmp\stage3b-real-provider-skill\
.tmp\stage3b-real-acceptance\
```

这些运行产物不进入 Git；合同、实现、测试和本 closeout 属于正式仓库事实。

## 4. 新鲜门禁

```text
npm test
Node: 259/259 passed
Vitest: 624/624 passed

npx tsc --noEmit
exit 0

npm run build
exit 0

npm run db:init
连续两次 exit 0

git diff --check
exit 0
```

## 5. 未关闭项

1. 当前批准 digest 绑定工程 fixture，不能作为正式全量生产授权；真实课程设计包、关键样张和新的教师批准仍待完成。
2. 图片 Provider wrapper 未返回外部 request id，证据中保持 `providerRequestId=null`，不伪造；本地 client request evidence、Prompt、模型、结果记录与文件哈希已保留。
3. `RQ-024` 仍为 `in_progress`；Stage 3C 需完成至少 12 页真实可编辑 PPTX、逐页渲染、Delivery Critic 和页级返修闭环。

## 6. 下一步

先从真实教材证据、教案和逐页课堂设计建立非 fixture 的 `PptDesignPackage`，再重新执行关键样张、人审批准和全量 Provider 批次。Stage 3C composer、全量资产合同、逐页 QA 和局部返修可复用，不得以当前 fixture digest 作为生产输入。
