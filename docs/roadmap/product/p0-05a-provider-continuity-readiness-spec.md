# P0-05A真实Provider连续性与V1-9就绪规格

日期：2026-07-17
状态：accepted-candidate / activation-blocked

## 1. 决策

将原P0-05拆为严格串行的两个阶段：

1. P0-05A先证明当前Main Agent在真实Provider下连续稳定，并把现存V1-9入口校准到当前合同。
2. P0-05B再执行唯一V1-9真实全链路与产物验收。

不直接启动完整V1-9。当前已知的一次Main Agent续轮`502`属于model orchestration缺口；若同时引入图片、视频、PPTX、ZIP和整包Provider，失败来源、费用和恢复责任会混在一起，无法判断根因。

## 2. 启动假设与前置条件

- 当前项目开发门禁阶段已形成一个经审查的clean提交。
- required CI的`verify:ci`生成`dirty=false`、HEAD匹配、5项检查完整通过的验证manifest。
- `quality-gates`已设为受保护分支required check，或有等价且可核验的阻断设置。
- P0-05A激活时以该clean提交作为新的`baselineSha`，替换而不是并存于当前`active-stage.json`。
- 用户在任何真实调用前批准Provider通道、总费用上限和最大调用次数；规划阶段不推断金额。
- Provider只从显式ledger root和显式channel解析，禁止ambient env静默切换。
- 首先确认现有持久事实能否权威提供每次上游Provider调用的原始HTTP状态、timeout和关联ID。若不能，当前门禁关闭前必须批准一个精确、一次性、到期的`provider-evidence-capture-bootstrap`机制；它只允许增加脱敏调用轨迹和测试，返回`passed=false`，不能冒充连续性receipt。

任一前置条件缺失时，P0-05A保持roadmap候选，不取得执行权。

## 3. 目标

面向教师真实对话行为，证明同一候选SHA上的Main Agent能够连续完成：

- 模糊讨论时自然追问或讨论，不调用业务Tool，不提升IntentEpoch；
- “只做需求规格”时只调用`create_requirement_spec`并形成一个真实Artifact；
- 需求规格加PPT结构候选时只调用允许的两个Tool并形成对应Observation和Artifact；
- 双Tool回合的post-tool Main Agent续轮不重复Tool、不扩张范围、无5xx/timeout且终态可恢复；该证据必须绑定场景C相同的`teacherMessageId`和`turnJobId`，不能用另一轮对话冒充。

同时形成V1-9当前入口就绪矩阵，确认旧runner、preparer、preflight和observer哪些可保留、哪些必须适配、哪些不得恢复。

## 4. 交付物

1. 真实Provider连续性live harness，驱动真实产品入口，不直连Provider冒充产品验证。
2. Provider adapter/runtime边界的append-only脱敏调用轨迹，只记录correlation、channel/model摘要、原始状态、timeout、usage和时间，不记录body、header、完整URL或凭据。
3. capability-scoped preflight，只检查本阶段实际使用的Main Agent与文本Tool能力。
4. 由Provider轨迹、真实事件、ToolInvocation、Observation和Artifact事实生成的evidence文件；UI harness只能关联，不能自行声明`real-provider`或HTTP成功。
5. 与现有`shanhai-provider-continuity-manifest.v1`和receipt verifier一致的manifest/receipt生成器。
6. 连续3组完整序列的development receipt；失败、服务重启、候选变化或合同变化后计数从0重启。
7. V1-9入口就绪矩阵与P0-05B Go/No-Go建议，不创建P0-05B runId。
8. 运行手册，说明环境隔离、费用门、启动、停止、证据恢复和失败定位。

## 5. 技术边界

### 5.1 复用

- 继续使用`config/development-gates.json`中的四场景、连续次数、禁用模式和敏感路径作为唯一政策源。
- 继续使用`scripts/development-gates/provider-continuity.mjs`做纯验证，不复制第二套schema。
- 继续使用项目MessagePart、AgentEventEnvelope、ToolInvocation、Observation和Artifact持久事实。
- 现存`run-v1-9-e2e.mjs`、`prepare-v1-9-run.ts`和V1-9 observer只能作为待审计入口，不自动取得执行权。
- 复用旧runner的隔离数据库、进程监督、停机后验证和evidence sanitizer模式；不复用M67命名、历史predecessor特例或固定完整媒体preflight作为本阶段入口。

### 5.2 计划结构

```text
scripts/development-gates/provider-continuity/
  live-runner.mjs              真实产品驱动与进程生命周期
  scenario-runner.mjs          四场景顺序执行
  evidence-builder.mjs         持久事实转证据
  receipt-writer.mjs           manifest/receipt确定性写入
tests/development-gates/
  provider-continuity-live.test.mjs
tests/e2e/
  provider-continuity-real.spec.ts
docs/runbooks/
  provider-continuity-live.md
src/server/provider-ledger/
  provider-call-trace.ts          append-only脱敏逐调用事实
src/server/gpt-protocol/
  openai-responses-adapter.ts     SDK HTTP状态、request-id摘要、timeout与usage采集
src/server/conversation/
  conversation-turn-service.ts    project/task/teacher-message/turn-job身份绑定
```

入场审计已确定上述三个现存责任边界：Provider轨迹独立持久化、协议适配器只采集SDK事实、conversation service只绑定业务身份。默认不开启采集；显式development capture才写入`.tmp/provider-continuity/capture/`。任何写入缺失都会使后续campaign失败，但不得改变Provider业务结果。不得把这些职责重新堆入当前已较大的`provider-continuity.mjs`。

### 5.3 证据风格

结构化事实先于可读摘要，示意合同如下；实际字段必须由现存verifier接受：

```ts
type ContinuityScenarioEvidence = Readonly<{
  id: string;
  httpStatuses: readonly number[];
  timeOuts: readonly (false | 0)[];
  modes: readonly ["real-provider"];
  toolInvocations: readonly { name: string }[];
  observations: readonly { id: string }[];
  artifacts: readonly { artifactId: string }[];
  intentEpochBefore: number;
  intentEpochAfter: number;
  result: "passed";
}>;
```

证据不得包含凭据、完整Provider URL、原始环境变量、教师敏感信息或思维链。

## 6. 命令合同

当前已有命令：

```powershell
npm run gate:development
npm run typecheck
npm run lint -- --max-warnings 150
npm test
npm run build
npm run gate:provider:verify -- --mode development
npm run gate:manifest:verify
```

P0-05A计划新增唯一真实执行入口：

```powershell
npm run gate:provider:live -- --mode development --manifest .tmp/provider-continuity/provider-continuity.manifest.json
npm run gate:provider:seal -- --mode development
```

该命令不存在前不得用临时脚本、手工JSON或旧V1-9 runner替代。

## 7. 测试策略

- Node合同测试验证路径安全、两文件哈希、原子写、证据完整性、费用/调用预算和失败关闭。
- Vitest验证持久事实到evidence的映射，不读取源码字符串证明行为。
- Playwright desktop真实测试通过产品入口执行四场景；不得启用deterministic、mock或fallback。
- 每组运行使用新的隔离project/task、SQLite URL、Artifact root和evidence root；组内四场景按政策要求保持同一隔离task语义。
- 三组必须在同一候选SHA、tree、policy SHA、stage SHA、Provider channel和model fingerprint上连续通过。

## 8. 边界

### 始终执行

- 先写失败测试，再实现最小harness或适配。
- 记录所有原始HTTP状态和timeout，SDK重试成功不能覆盖原始失败。
- 三组必须在同一production server进程内串行执行；服务重启使整个campaign失败。
- 候选代码、prompt、policy或Provider binding变化后废弃旧receipt并从第1组重跑。
- 通过项目门禁和完整离线验证后才冻结候选并开始真实连续运行。

### 必须另取授权

- 真实Provider费用上限和最大调用次数。
- 对外网络、生产数据、部署、教师签收或不可逆操作。
- 若就绪审计需要数据库schema或公共接口变化，先更新规格并重新审查。

### 永不执行

- 不调用图片、视频、TTS、PPTX、ZIP或整包Provider。
- 不恢复旧run、旧manifest、历史predecessor或整改前固定Tool流程。
- 不用探针、fixture、手工receipt、fallback或删测试制造连续通过。
- 不把P0-05A Go称为product E2E、V1-9、R5整体或release完成。

## 9. 成功标准

- `gate:provider:verify -- --mode development`对最终候选返回`ok=true / passed=true / status=passed`和3个连续run。
- 四场景的Tool、Artifact、Observation、IntentEpoch、HTTP状态和终态全部满足当前policy。
- manifest、receipt、subject bundle和每个evidence文件SHA可独立重算，目录中无未签名额外文件。
- 完整离线门、TypeScript、Lint warning不增长、全量测试和构建通过。
- V1-9就绪矩阵对每个旧入口给出`reuse / adapt / retire / blocked`及证据；不存在未裁决的强制predecessor、第二编排者或旧宏阶段。
- Provider调用事实来自运行时边界而不是测试自报，场景C/D的message/job关联由schema和verifier强制。
- 主线状态只把`model orchestration`从partial提升为go；`product E2E`仍保持partial，`release`保持not started。

## 10. 开放决策

以下值在阶段激活前由用户确认并写入活动阶段合同，不在本spec中猜测：

- Provider ledger channel与模型指纹；
- 单组及阶段总费用上限；
- 最大真实调用次数和单组时限；
- 受保护环境标识及CI receipt artifact保留期。
