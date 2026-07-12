# V1 Stage 3B：PPT 关键样张、正式资产与来源证据测试计划

日期：2026-07-12

状态：accepted

## 1. 资产请求合同

| ID | 场景 | 通过标准 |
|---|---|---|
| 3B-01 | 从合法 12 页设计包提取样张资产请求 | 只提取样张页需要的 AI_SCENE/AI_ASSET；每项绑定 assetId、pageIds、Prompt、画幅、安全区和 promptDigest |
| 3B-02 | 同一 assetId 被多页复用且合同一致 | 合并 pageIds，不重复调用 Provider |
| 3B-03 | 同一 assetId 对应不同 Prompt、角色或生成策略 | 稳定拒绝 asset_contract_conflict |
| 3B-04 | 数字、公式、答案或精确数量进入图片 Prompt | 硬门失败，要求回 PageSpec 可编辑层 |
| 3B-04A | “不得出现公式、答案”等负向约束 | 允许进入请求合同；不得把禁止语义误判为要求生成精确内容 |

## 2. 来源 manifest

| ID | 场景 | 通过标准 |
|---|---|---|
| 3B-05 | 完整真实资产 manifest | 文件、sha256、尺寸、mime、Provider/model/task、inputHash、promptDigest、页面绑定和处理链全部通过 |
| 3B-06 | placeholder/stand-in/mock/temp 或本地绘制主体 | 来源门失败，不得进入样张 |
| 3B-07 | 缺 Provider task、hash、尺寸、storage ref 或 pageId | 返回精确 asset locator |
| 3B-08 | 后处理只包含允许操作 | 去背、裁切、缩放、轻色彩校正、格式转换、别名和实例复制通过；重画主体失败 |
| 3B-09 | manifest 与请求 promptDigest/inputHash 不一致 | 稳定拒绝，不能以同 assetId 冒充原请求结果 |

## 3. 关键样张与批准

| ID | 场景 | 通过标准 |
|---|---|---|
| 3B-10 | 完整三总览和 3-4 个正式样张页 | 场景、小素材、正式组装三总览引用独立；样张页与 SamplePlan 一致 |
| 3B-11 | 缺任一总览、三总览指向同一文件或只有文件名 | 样张门失败 |
| 3B-12 | 样张页使用未登记资产或把数学层栅格化 | 对应 page/asset locator 失败 |
| 3B-13 | 任一页 D/V/P 未通过或存在 unresolved finding | 整个样张包不得批准 |
| 3B-14 | 批准绑定当前 sampleSetDigest | 当前包通过；包内容变化后旧批准失败 |
| 3B-15 | 模糊“继续”或无批准动作来源 | 不生成有效 PptSampleApproval |

## 4. Provider 请求证据

| ID | 场景 | 通过标准 |
|---|---|---|
| 3B-16 | 单资产请求 | inputHash、幂等键、assetId、pageIds、Prompt、negative prompt、画幅和安全区稳定 |
| 3B-17 | 请求要求参考图 | 证据包含实际发送的 referenceAssetIds 和引用摘要；只写 Prompt 不算实传 |
| 3B-18 | Provider 返回与当前 inputHash/intentEpoch 不一致 | staging 结果隔离，不进入 manifest |

## 5. 集中验证

```powershell
npx vitest run tests/ppt-asset-request-contract.test.ts tests/ppt-asset-manifest.test.ts tests/ppt-key-sample-gate.test.ts tests/ppt-asset-provider-request.test.ts tests/ppt-asset-batch-run.test.ts tests/ppt-asset-image-generation-run.test.ts tests/ppt-key-sample-composer.test.ts tests/ppt-key-sample-renderer.test.ts tests/ppt-sample-approval-persistence.test.ts --maxWorkers=1
npm test
npm run build
npm run db:init
git diff --check
```

3B 通过只能声明样张、资产和来源证据链完成。2026-07-12 已补齐真实 PptxGenJS 样张、LibreOffice/Poppler 渲染、三份独立 contact sheet 和 D/V/P 审查；真实教师明确批准仍待完成，`RQ-024` 保持 `in_progress`。
