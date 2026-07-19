# 产品优先深度重构测试计划

更新时间：2026-07-19

## 1. 验收层级

本阶段只可关闭`contract`与`executor`重构门。未调用真实Provider时，`model orchestration`和`product E2E`最多保持既有partial，`release`保持not started。

## 2. 必须先失败的行为合同

| ID | 场景 | 预期 |
|---|---|---|
| DR-A01 | 项目写handler在wrapper前提前返回 | orchestration gate失败 |
| DR-A02 | 非`route.ts`的Next写入口绕过registry | orchestration gate失败 |
| DR-A03 | 成员新增、改角色、删除绕过统一actor/CSRF | 请求失败且业务handler不执行 |
| DR-A04 | attempted审计写入失败 | 业务handler调用次数为0 |
| DR-A05 | terminal审计写入失败 | 不返回业务成功并保留open attempt |
| DR-A06 | Observation、Event、Invocation终态错绑 | 提交事务拒绝 |
| DR-A07 | 重复terminal或terminal先于start | 提交事务拒绝 |
| DR-A08 | Observation-only成功没有Artifact | 合法成功，不被摘要误判 |
| DR-A09 | 声称产生Artifact但缺少正式绑定 | 提交或摘要失败 |
| DR-A10 | authority summary身份、ordinal、水位或digest篡改 | readyEligible=false |
| DR-B01 | 生产路径尝试读取或执行`toolPlan`/`deliveryPlan` | 编译或行为合同失败 |
| DR-B02 | deterministic结果尝试晋升为正式Artifact | 晋升失败 |
| DR-B03 | native turn之外的组件选择下一业务Tool | 行为合同失败 |
| DR-D01 | 新增或扩大复杂度债务 | complexity gate失败 |
| DR-D02 | 债务减少但baseline尚未同步 | 报告可识别stale baseline，允许显式收缩 |
| DR-D03 | 新增源码字符串合同 | source-contract gate失败 |
| DR-D04 | 新增Lint warning | Lint失败 |
| DR-D05 | 动态路径可逃逸受限根 | 构建/路径合同失败 |

## 3. 每切片验证

```powershell
node --test --test-concurrency=1 <相关Node测试>
npx vitest run <相关Vitest测试> --maxWorkers=1 --no-file-parallelism
npm run typecheck
npm run lint -- --max-warnings 0
npm run gate:development
git diff --check
```

早期切片中若既存warning尚未清零，可运行定向ESLint并记录剩余总数；只有阶段D完成后才允许声称Lint门通过。

## 4. 删除性验收

```powershell
rg -n "WorkflowNode|toolPlan|deliveryPlan|DeterministicRuntime" src
node scripts/development-gates/complexity.mjs --report-json
node scripts/development-gates/source-contracts.mjs
```

最终预期：第一条无生产命中，复杂度报告为`[]`，源码字符串合同报告无债务。

## 5. 最终全量验证

```powershell
npm test
npm run typecheck
npm run lint -- --max-warnings 0
npm run build
npm run gate:development
npm run verify:local
npm run gate:manifest:verify
npm run desktop:smoke
```

随后从最终HEAD启动隔离本地实例，验证：health、登录、新建项目、普通讨论不触发Tool、单一需求规格只触发对应Tool、刷新后状态不漂移、失败只出现一次恢复入口。浏览器使用桌面视口。

## 6. 明确不执行

- 不运行`gate:provider:live`、Provider seal或release gate。
- 不调用图片、视频、PPTX、ZIP或整包Provider。
- 不创建V1-9 runId，不执行教师签收或部署。
- 不运行390px真实黑盒。

这些项目必须在最终报告列为“未验证/需另行授权”，不能写成通过。
