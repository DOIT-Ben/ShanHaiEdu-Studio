# 产品优先深度重构续作交接

更新时间：2026-07-20 15:10 +08:00

## 1. 交接结论

当前唯一活动阶段仍是`product-first-deep-refactor`。阶段A、阶段B、阶段C以及阶段D的D1至D17已经完成离线合同与工程回归；D13发现真实单镜头血缘缺口并完成最小拆分，D14完成Ops源码合同治理，D15完成M67和V1-9 Runner源码合同治理，D16完成检测器增强和复杂度保留项复评，D17完成剩余源码合同行为化迁移并清零source-contract债务。下一步进入阶段E最终验证。

复杂度门当前报告11个登记项，但风险治理ADR的“应拆”队列已经清空。11是阈值命中登记数，不是11个必须拆分的“屎山文件”。稳定注册表、协议映射、同一资源路由和内聚UI可以保留；只有职责混杂、重复控制权、测试边界不清或变更风险实际升高时才拆。D13视频route已因测试边界失效和单镜头血缘缺口完成最小拆分。

## 2. Git与工作区现场

| 项目 | 当前事实 |
|---|---|
| 工作目录 | `E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main` |
| OS / Shell | Windows / PowerShell |
| 分支 | `main` |
| HEAD | `dd146f4ab5ae4a07ab59ba475e33323dd256f8f6` |
| upstream | `origin/main` |
| 领先 / 落后 | 领先14，落后0 |
| 工作区 | D1-D16未提交改动全部保留；以实时`git status --short`为准 |
| Entire | 已启用，`manual-commit`；当前分支checkpoint为0 |
| 提交与远端 | D1-D13尚未提交；本交接未commit、未push |

当前文件系统和Git diff是唯一可恢复现场。不要把HEAD误认为D12结果，也不要因为Entire没有checkpoint而重置工作区。

禁止执行`git reset`、`git checkout --`、`git clean`、rebase、批量格式化或任何清理操作。未经用户另行授权，不commit、不push、不切换分支。

## 3. 当前目标与验收边界

本阶段目标是收敛为一套生产控制面：教师提交需求后，由产品Main Agent形成任务边界、自主选择原子Tool，Tool结果原子持久化为Invocation、Validation、Observation、事件与允许的Artifact，再投影到教师工作台。兼容层、Runner、固定计划、Skill和Provider adapter不得取得第二编排权。

当前只允许证明离线`contract`和`executor`事实，不能越级上推：

| 层级 | 当前状态 | 说明 |
|---|---|---|
| contract | partial | D1-D17合同治理和行为回归通过；增强扫描下source-contract报告为0，但真实Provider与产品链路仍未验 |
| executor | partial | 原子提交、权限、队列、恢复和任务隔离已有仓内证据；真实媒体执行未验 |
| model orchestration | partial | 没有本轮真实Provider连续性证据 |
| product E2E | partial | 未创建唯一V1-9新run，未做教师真实全链路签收 |
| release | not started | 未部署、未发布；离线延期不被release接受 |

真实Provider请求必须保持0。不得创建V1-9 runId，不得生成图片、视频、PPTX或ZIP，不得部署、签收或发布。

## 4. D1-D13现场摘要

- D1-D5关闭repository、Artifact重做、staged promotion和workbench service的高风险边界。
- D6把消息与教师事件合同拆为独立职责模块，旧导出路径保持兼容。
- D7治理TaskAggregate、external-audit ingress、Agent Tool授权、Provider结果合同和视频镜头请求。
- D8治理Skill runtime执行与结果校验边界。
- D9拆分Agent策略、Provider结果和Package职责，保留唯一Tool Router边界。
- D10拆分OpenAI Runtime请求/输出/schema/错误/结果职责和ReAct合同/回合辅助职责。
- D11拆分Feedback reconciliation与共享终态提交合同，保留内聚repository、controller和Dialog。
- D12拆分workbench controller与composer附件生命周期，保留内聚布局和项目行状态机。
- D13发现视频route单镜头输入与GenerationJob血缘缺口，拆分HTTP边界与视频执行协调，保留GET/POST资源与共享Envelope/commit语义。

工作区改动主要分为以下几组，具体文件以`git status --short`为准：

| 改动组 | 目的 |
|---|---|
| `config\development-gates.json`、`scripts\development-gates\*`、阶段文档 | 单调收缩复杂度基线，绑定离线Provider延期和当前阶段事实 |
| `src\lib\conversation-message-*`、`src\lib\teacher-agent-event-*` | 拆分消息与事件合同、投影、时间线和合并职责 |
| `src\server\conversation\*`、`src\server\agent-runtime\*` | 拆分TaskAggregate、external audit、ReAct与Runtime职责 |
| `src\server\tools\*`、`src\server\skills\*` | 拆分授权、结果、Provider、Package和Skill执行职责 |
| `src\server\feedback\*` | 拆分后台reconciliation和共享终态提交 |
| `src\hooks\*`、`src\components\conversation\*` | D12前端controller、composer和附件生命周期治理 |
| `tests\*` | 冻结旧公开入口、任务隔离、原子提交、恢复与前端投影合同 |

### D12新增职责模块

- `src\hooks\useWorkbenchProjectState.ts`
- `src\hooks\useWorkbenchProjectSync.ts`
- `src\hooks\useWorkbenchProjectActions.ts`
- `src\hooks\useWorkbenchComposerController.ts`
- `src\hooks\workbench-composer-submission.ts`
- `src\hooks\workbench-composer-contracts.ts`
- `src\hooks\useWorkbenchArtifactNavigation.ts`
- `src\hooks\useWorkbenchArtifactOperations.ts`
- `src\components\conversation\composer\useComposerAttachments.ts`

`useWorkbenchController.ts`仍是唯一公开组合入口；`PromptComposer.tsx`仍是唯一输入面。`MediaWorkbench.tsx`和`ProjectListItem.tsx`分别作为工作台布局组合与单行项目编辑状态机保留。

## 5. 已有验证证据

D12完成时已经实际运行并记录：

- 定向前端Node合同：`34/34`
- 全量Node：`423/423`
- Vitest隔离分片：`776/776 + 796/796`
- TypeScript：通过
- ESLint：`0 error / 0 warning`
- 生产构建：通过
- standalone：`missing=[] / forbidden=[]`
- development gate：`passed-with-offline-refactor-defer`
- Provider：`passed=false`，真实请求数为0

D13完成后本轮新鲜复核：

- `npm test`：Node `425/425`；Vitest 隔离分片 `776/776 + 797/797`
- `npm run typecheck`、`npm run lint -- --max-warnings 0`、`npm run build`：通过；standalone `missing=[] / forbidden=[]`
- `npm run gate:development`：`passed-with-offline-refactor-defer`；`complexity` 通过且为11个登记项，`source-contracts` 通过且登记13个债务文件
- `npm run gate:provider:impact`：`offlineRefactorOnly=true`；未执行真实 Provider 请求

交接前重新只读核对：

- complexity报告为11个登记项；D13视频route从baseline移出，没有新增或扩大债务。
- source-contract gate通过，仍登记13个债务文件；wrapper、alias、解构、参数默认值、闭包与完整传播留给D16。
- Entire当前分支checkpoint为0。
- D17完成后source-contract报告为0；源码合同baseline为空数组。

这些结果不能证明真实Provider、model orchestration、product E2E或release通过。下一位修改任何生产文件后必须在新工作树上重新验证，不能复用上述计数作为新切片完成证据。

## 6. D13视频route风险评估完成

目标文件：

`src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\video\route.ts`

原文件216行，complexity门报告2个阈值命中函数，最大函数162行。复核后发现真实缺口，已按风险治理ADR完成最小拆分：route保留HTTP/认证/下载/project lease，`video-route-generation.ts`承接执行协调与单镜头输入边界。

### 必须核对

1. GET下载和POST生成是否仍然是同一视频Artifact资源的两个HTTP动作。
2. GET、POST是否都只经过`withLocalWorkbenchActor`这一外层认证授权wrapper。
3. POST是否只通过`claimArtifactRouteToolExecution`取得一个有效`ExecutionEnvelope`，并只通过共享commit边界结束。
4. project、TaskBrief、IntentEpoch、source Artifact、upstream Artifact、GenerationJob和VideoShot血缘是否严格隔离。
5. 路由级确认、project execution lease、`submission_unknown`恢复、Provider失败和质量失败是否存在重复控制权或互相矛盾的终态。
6. 404、409、400以及教师安全错误文案是否保持现有语义，是否出现无法独立验证的新分支。

### D13证据与决策

- GET与POST均使用`withLocalWorkbenchActor`；POST外层只有一个project execution lease。
- `ExecutionEnvelope`由`artifact-route-tool-execution.ts`共享边界创建、校验和提交，route没有第二套Envelope实现。
- `tests\artifact-route-task-isolation.test.ts`覆盖旧IntentEpoch来源、当前任务上游Artifact和Provider前隔离。
- `tests\artifact-route-execution-envelope.test.ts`冻结三条Artifact route的共享gateway和原子结果边界。
- `tests\route-level-generation-gate.test.ts`与`tests\m61-route-level-generation-gate.test.mjs`覆盖确认动作和Provider前守门顺序。
- 红测证明成功测试mock掉Tool Router，route没有把Provider Tool要求的唯一`shotIds`传入，也没有把同一镜头写入GenerationJob `unitId`；因此真实Provider结果无法闭合，属于测试边界失效和血缘缺口，而不是单纯行数问题。
- 修复后`shotId`/`shotIds`必须是唯一、格式正确且一致的单镜头；同一值进入ExecutionEnvelope action digest、Tool input和GenerationJob `unitId`。缺失或冲突在claim、GenerationJob和Provider前失败关闭。
- Artifact直发客户端新增可选`shotId`，mapper和动作投影只展示有明确shot绑定的video action；旧无镜头action不再暴露为必然失败的按钮。GET/POST公开路径、认证wrapper、project lease、共享Envelope/commit、错误码、教师安全文案和Provider请求/响应/重试语义保持不变。
- D13决策：最小拆分并保留同一GET/POST资源边界。complexity登记项由12单调降至11。

当前风险与未来触发条件：Artifact-level旧数据若没有shot绑定将不展示视频直发动作；多镜头选择、VideoShot推进、第二认证/Envelope/commit路径、血缘校验分叉、同一失败被多处决定或新增分支无法由独立route合同覆盖时，必须重新评估helper与route边界。

## 7. D14 Ops源码合同完成

- `desktop/electron-main.mjs`和`playwright.config.ts`已删除无消费者的`NEXT_PUBLIC_WORKBENCH_DATA_SOURCE`注入，环境拼装统一由结构化 helper 生成。
- container runtime、video smoke、desktop installer、deploy demo、auth preflight和production preflight已改为可注入探针、结构化配置或行为断言；相关6条源码合同债务已从baseline移除。
- D14定向Ops Node合同`55/55`；全量`npm test`通过Node`425/425`、Vitest`776/776 + 797/797`；TypeScript、ESLint `0 error / 0 warning`、生产构建和standalone `missing=[] / forbidden=[]`通过。
- complexity保持11个登记项，source-contract债务由19个文件降至13个；Provider仍为`passed=false`且真实请求数为0。

## 8. D15 Runner源码合同完成

- `run-m67-e2e.mjs`仍是唯一CLI入口；环境、冻结、Next child、共享shutdown、端口、证据脱敏、manifest/state ledger和冻结baseline的可注入操作迁入`m67-e2e-runner-operations.mjs`。
- `tests/m67-e2e-runner.test.mjs`不再读取或动态编译runner源码；冻结闭包由生产marker/digest验证，M67与shared shutdown定向回归`39/39`通过。
- `tests/v1-9-e2e-runner.test.mjs`改为直接调用既有生产runner导出，V1-9与shared shutdown定向回归`40/40`通过；未运行`run-v1-9-e2e.mjs`、未创建runId。
- source-contract债务由13个文件降至11个；真实Provider请求数保持0，未生成媒体、部署、签收或发布。

## 9. D16检测器增强与复杂度复评

- `source-contracts.mjs`现可追踪读取wrapper、`node:fs`导入别名、对象解构、参数默认值、闭包返回、路径常量表和对象属性传播；词法遮蔽、结构化JSON/YAML、属性名/JSX名称及赋值时序例外保持有效。
- 检测器回归`15/15`通过。循环对象投影和深层AST均稳定结束，不会栈溢出；真实报告没有产生新增漏项，保持11个既有债务文件、98次命中。
- 因没有真实修复，`sourceStringContracts.baseline`未改动；不得删除有效测试、放宽扫描、增加排除或把D16称为源码合同清零。
- 复杂度11项已逐项登记当前职责、风险和复评触发条件；没有“应拆”项。具体表格见`product-first-deep-refactor-plan.md`的D16记录。

## 10. D17源码合同迁移完成

- Artifact route ExecutionEnvelope测试删除重复源码扫描，保留数据库行为合同；assistant-ui waiting、M44、M47和M74分别改为渲染、接口、运行时和纯函数合同。
- `sourceStringContracts.baseline`从5个文件、88次命中单调收缩为空数组；`node scripts\development-gates\source-contracts.mjs --report-json`返回`[]`。
- 定向替代回归`10/10`通过；权威`npm test`通过Node`411/411`、Vitest`780/780 + 801/801`；TypeScript、零warning Lint、生产构建、standalone、development gate、verify:local、manifest verify和desktop smoke均通过。
- 复杂度保持11个登记项；Provider保持`passed=false`且真实请求数为0，未创建V1-9 runId、未生成媒体、未部署、签收或发布。
- 全量`npm test`通过Node`425/425`与Vitest`776/776 + 797/797`；`typecheck`、零warning Lint、生产构建和development gate通过，standalone为`missing=[] / forbidden=[]`。
- 未运行真实Provider、M67/V1-9 E2E、媒体生成、部署、教师签收或发布。

## 11. D13验证与完成口径

先定向复核以下测试：

- `tests\artifact-route-task-isolation.test.ts`
- `tests\artifact-route-execution-envelope.test.ts`
- `tests\route-level-generation-gate.test.ts`
- `tests\m61-route-level-generation-gate.test.mjs`
- 与视频Provider、GenerationJob恢复和VideoShot血缘直接相关的现有测试

依赖数据库的权威测试入口仍是`npm test`，不要裸跑并复用真实数据库。D13产生代码或合同变更后执行：

```powershell
npm test
npm run typecheck
npm run lint -- --max-warnings 0
npm run build
npm run gate:development
node scripts\development-gates\complexity.mjs --report-json
node scripts\development-gates\source-contracts.mjs
git diff --check
```

完成报告必须分别写明：

- D13决策：已完成最小拆分，保留GET/POST同一资源边界，以及证据。
- complexity：登记项由12单调收缩至11，不能称为“屎山文件数量”。
- contract / executor：哪些行为由测试证明。
- Provider：必须保持`passed=false`且真实请求数为0。
- product E2E：仍为partial，除非另有新鲜真实产品证据。
- release：仍为not started。

## 12. 后续顺序

1. 阶段E：在最终HEAD重新执行全量工程验证；真实Provider连续性、V1-9、教师签收和release仍需另行授权与证据。

## 13. 回退边界

route文件和D13 helper现在属于本轮工作区改动。若需要回退，只手工撤销D13新增的精确route/helper、client、mapper、测试和文档改动，不得使用会覆盖D1-D12现场的仓库级回退命令。

若状态与本文件冲突，以实时`AGENTS.md`、活动需求基线、当前主线状态、已接受ADR、活动阶段机器合同、Git和实际测试结果为准，并同步修正本handoff，不得从archive恢复旧流程。
