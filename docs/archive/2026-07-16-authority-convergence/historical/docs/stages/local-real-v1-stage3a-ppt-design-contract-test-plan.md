# V1 Stage 3A：PPT 工艺合同与页级返修测试计划

日期：2026-07-12

状态：accepted

## 1. 结构化合同

| ID | 场景 | 通过标准 |
|---|---|---|
| 3A-01 | 合法 12 页 PptDesignPackage | schema、evidence、目标覆盖、页码、三层责任和样张计划全部通过 |
| 3A-02 | 重复 pageId 或 pageNumber 不连续 | ValidationReport failed，locator 精确到 page |
| 3A-03 | `第4-8页` 等范围合并 | 稳定拒绝，不把范围描述算作逐页设计 |
| 3A-04 | pageSpecCount、narrativePageCount、targetSlideCount 不一致 | 稳定拒绝并指出 count mismatch |
| 3A-05 | 已批准 objective 没有页面承接 | 稳定拒绝，返回缺失 objective reason |
| 3A-06 | 精确数字、公式、答案被放入 AI_SCENE/AI_ASSET | 稳定拒绝，要求移入 EDITABLE_MATH |
| 3A-07 | 页面缺教学动作、学生动作、主视觉、备注或 acceptance checks | 对应 page failed，不允许进入样张 |
| 3A-08 | 样张只选一种简单页型或不含高风险页 | sample plan failed |

## 2. 页级返修

| ID | 场景 | 通过标准 |
|---|---|---|
| 3A-09 | 修改单页文字/布局 | 只失效目标 pageId，不失效其他页面和资产 |
| 3A-10 | 修改单页主视觉资产 | 失效目标 assetId、所属 pageId 和对应样张，不重做整套 |
| 3A-11 | 修改相邻叙事转折 | 只失效目标页及前后必要页，保留无关页 |
| 3A-12 | 修改课程目标或教材证据 | 返回 repair_upstream，失效受影响页面、样张批准和下游报告 |
| 3A-13 | 修改后输入 hash 不变 | 幂等返回相同影响集，不创建新版本噪声 |

## 3. Runtime 与主链兼容

| ID | 场景 | 通过标准 |
|---|---|---|
| 3A-14 | OpenAI PPT Director 返回结构化 package | structuredContent 完整运输到 ArtifactDraft，digest 稳定 |
| 3A-15 | PPT quality 输出缺 structuredContent | PostValidator failed，不保存为质量设计稿 |
| 3A-16 | 非 PPT Runtime 任务 | 现有 Markdown 输出和测试保持兼容 |
| 3A-17 | deterministic PPT 草稿 | 明确 draft/preview，不得满足 quality contract 或进入最终包 |

## 4. 集中验证

```powershell
npx vitest run tests/ppt-quality-design-contract.test.ts tests/ppt-page-repair-impact.test.ts --maxWorkers=1
npx vitest run tests/contract-validation.test.ts tests/agent-runtime/openai-runtime.test.ts tests/capability-runner.test.ts --maxWorkers=1
npm test
npm run build
git diff --check
```

3A 通过只能声明 PPT 设计和返修底座完成；没有真实资产、真实 PPTX、PDF/PNG/contact sheet 和真实 render Critic 时，`RQ-024` 仍为 `in_progress`。
