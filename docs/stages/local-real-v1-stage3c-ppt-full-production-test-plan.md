# V1 Stage 3C：PPT 全量生产、渲染审查与页级返修测试计划

日期：2026-07-12

状态：accepted

## 1. 全量生产入口

| ID | 场景 | 通过标准 |
|---|---|---|
| 3C-01 | 当前 design + full manifest + 当前样张批准 | 允许进入 composer |
| 3C-02 | 缺批准、批准绑定旧 sample/design digest | 稳定拒绝，不调用全量生产 |
| 3C-03 | full manifest 缺任一 page/asset | 返回精确 asset/page locator |
| 3C-04 | key_samples manifest 冒充 full_production | scope 门失败 |

## 2. Composer 与可编辑性

| ID | 场景 | 通过标准 |
|---|---|---|
| 3C-05 | 合法 12 页设计包 | 生成真实 PPTX，slideCount=12 |
| 3C-06 | 任一 AI asset 文件缺失或 hash 不符 | 不生成 deck candidate |
| 3C-07 | 精确文字和数学层 | PPTX 中保持原生文本层；candidate 标记 rasterizedExactContent=false |
| 3C-08 | pageId 不连续、重复或 composition 越界 | composer 前合同门失败 |

## 3. 多格式与 Delivery Critic

| ID | 场景 | 通过标准 |
|---|---|---|
| 3C-09 | PPTX 转 PDF/PNG | PPTX、PDF、PNG 均为 12 页 |
| 3C-10 | 缺渲染页、重复 pageId 或 hash 无效 | production candidate 失败 |
| 3C-11 | contact sheet | 独立真实文件，覆盖全部 pageId |
| 3C-12 | 任一页 D/V/P/readability 失败或 findings 非空 | 不形成 final-eligible production package |

## 4. 页级返修

| ID | 场景 | 通过标准 |
|---|---|---|
| 3C-13 | 修改单页文字/布局 | 仅目标 pageId 及其 render/report 失效 |
| 3C-14 | 修改单页资产 | 仅目标 pageId、assetId 及依赖报告失效 |
| 3C-15 | 修改叙事/objective/evidence | 按 Stage 3A impact 分析回上游，不伪装单页修复 |
| 3C-16 | 修复后重新封装 | 新 digest/version；未受影响页 hash 保持不变 |

## 5. 集中验证

```powershell
npm test
npx tsc --noEmit
npm run build
npm run db:init
npm run db:init
git diff --check
```

真实 12 页 Provider 资产、教师批准和实物审查属于 Stage 3C 完成证据，不得由 fixture 替代。
