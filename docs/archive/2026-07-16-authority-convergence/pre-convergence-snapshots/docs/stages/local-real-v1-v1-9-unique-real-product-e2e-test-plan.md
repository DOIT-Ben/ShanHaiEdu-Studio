# V1-9 唯一真实产品 E2E 测试计划

更新时间：2026-07-16

状态：`A23 new unique run authorized; immutable baseline and read-only preflight tests in progress`

## 1. 原则

- 先离线红绿，后扩大回归，最后才消耗唯一真实 Provider 全链路。
- 不断言固定 Tool 顺序；断言当前合格 Tool 可发现、模型自主选择、Observation 后继续或 Replan。
- runner 只从教师 UI 发起一次任务并观察，不调用内部 Tool/Artifact/审批/生成 API。
- V1 前只运行 `chromium-desktop`，不运行新的 390px 黑盒。
- fixture 只能证明合同和执行器，不得写成真实 Main Agent、产品 E2E 或 V1-9 通过。

## 2. Contract 层红测试

| ID | 场景 | 预期 |
|---|---|---|
| V1-9-C01 | 一句话 PPT 与完整材料包 TaskBrief | 产生不同版本绑定预算；完整包上限覆盖标准页数和标准镜头范围，不再固定为 3 |
| V1-9-C02 | 超出 TaskBrief 预算 | 产生一次 typed `budget_upgrade`；升级确认原子写回 IntentGrant，下一调用不重复同一门 |
| V1-9-C03 | Skill 配置缺失、半配置或双来源 | V1-9 preflight 在任务和 Provider 调用 0 时失败关闭 |
| V1-9-C04 | Skill projection 内容被篡改 | lock `contentDigest` 校验失败，返回稳定 reasonCode |
| V1-9-C05 | 业务 Tool/Skill binding 缺失或 inactive | preflight 失败，不允许静默无 Skill 执行 |
| V1-9-C06 | eligible 的内部质量通过 Artifact | Provider/Package Adapter 可作为下游输入，但 `teacherSignoff` 仍为 false |
| V1-9-C07 | 未验证、review repair/blocked 或仅 R5 候选 Artifact | 下游媒体生产失败关闭 |
| V1-9-C08 | 15-29 秒最终视频 | V1-9 版本包合同拒绝；30-90 秒接受 |
| V1-9-C09 | PPT 页数与 TaskBrief 不一致 | 最终包拒绝，不用固定 12 页替代任务目标 |
| V1-9-C10 | Main Agent Tool 注册表 | 暴露课堂视觉图高层 Tool，不暴露裸 Provider、数据库、审批或状态提升 Tool |
| V1-9-C11 | start/resume run manifest | 同一 runRoot/DB/project/task/checkpoint；身份冲突时拒绝创建第二任务 |
| V1-9-C12 | selected Agent Brain channel | preflight与实际Runtime选择同一primary/third/fallback通道；未知通道、缺Base URL/model/credential或provider lock不一致均失败关闭，请求数0 |
| V1-9-C13 | 任意、过期或错配健康证据ID | preflight读取API台账证据并核对ID、provider、channel、model、endpoint category、reasoning effort、credential source、config digest、成功状态和时序；任一不符均请求数0且不恢复 |
| V1-9-C14 | 专用健康探针 | 复用产品`pickOpenAICompatibleConfig`；请求前匹配冻结provider lock；只发一次严格结构化Responses，`maxRetries=0/retryCount=0`，成功证据不可覆盖地写回API台账且不含credential/Base URL |
| V1-9-C15 | 项目env与台账私有真源不一致 | 原子同步器只更新明确选择的Agent Brain channel字段，不打印值、不覆盖第三通道或其他Provider；同步后公开/私有台账校验通过 |
| V1-9-C16 | Provider或合同发生实质升级 | 当前run终止且manifest/hash保持不变；只有显式后继run可绑定新锁，禁止同run追加lock history后继续 |
| V1-9-C17 | 未命名项目但TaskBrief含年级/学科/课题 | 对话入口与Tool执行边界共同解析为TaskBrief语义；不得把项目UI标题当课题导致可信候选被拒绝 |

## 3. Executor 层红测试

| ID | 场景 | 预期 |
|---|---|---|
| V1-9-X01 | 资格过滤或参数校验前失败 | Provider 调用台账不增加 |
| V1-9-X02 | Provider 请求已真实提交 | 调用事件与 ToolInvocation/Observation 原子持久化，跨 service 重建仍可读取 |
| V1-9-X03 | MiniMax TTS | 通过显式 Provider Tool/Adapter 执行并计入同一预算，不藏在 Package Tool 内 |
| V1-9-X04 | 同一幂等单元恢复 | 不重复提交 Provider；复用原 GenerationJob、providerTaskId 或 `submission_unknown` 状态 |
| V1-9-X05 | 一个内部段达到轮次上限 | TaskAggregate checkpoint、plan revision、SemanticSnapshot 和 event sequence 原子更新 |
| V1-9-X06 | 进程重启续段 | 同一 taskId/IntentEpoch 自动续跑，不要求教师例行确认，不新建完整任务 |
| V1-9-X07 | 同一 Tool 同原因连续失败两次 | 保存 `repeated_failure` 恢复入口并停止，不循环、不产 fallback |
| V1-9-X08 | 可信 needs_review 媒体中间产物 | 可以组装下游；教师批准状态不被伪造 |
| V1-9-X09 | 最终视频 Critic 通过 | 内部质量证据可供成包，`teacherSignoff=false` 仍保持独立 |
| V1-9-X10 | 最终包无正式 package asset | 下载与成功状态均失败关闭，不现场拼 ZIP |
| V1-9-X11 | Main Agent Responses失败 | phase、稳定reasonCode、retryability和脱敏summary进入Assistant Message、AgentObservation、TurnJob及恢复证据 |
| V1-9-X12 | 有新通道健康证据且TurnJob仍有预算 | 同一teacherMessageId/taskId/IntentEpoch/TaskBrief digest/幂等键恢复；不新增消息、项目或任务提交 |
| V1-9-X13 | 无新健康证据、相同证据再失败或预算耗尽 | 不自动重排、不循环调用、不产fallback；保存typed恢复入口 |
| V1-9-X14 | 仓内合同修复后尝试恢复旧TurnJob | 源码/合同摘要漂移时请求数0并拒绝；修复只能进入显式后继run，旧run及上游Artifact保留审计，不伪装成原run继续 |
| V1-9-X15 | 模型生成声音偏好与台账 MiniMax 音色不同 | Provider 请求只使用 API 台账 `MINIMAX_TTS_VOICE_ID`；脚本 digest 不变，Provider evidence 分别保留请求偏好和实际音色 |
| V1-9-X16 | TTS 请求前、提交后或响应校验失败 | Observation 保留稳定 reasonCode、脱敏阶段和 `providerSubmitted`；已提交调用进入同一预算台账 |
| V1-9-X17 | TTS 音色/响应合同或字幕 timing 无效 | 返回 Main Agent `fix_inputs` 或 Replan，不默认 `ask_teacher`，不生成无字幕或 fallback 音频成果 |
| V1-9-X18 | TTS 网络、限流或服务暂不可用 | 只产生 `wait_for_provider`；零 SDK 重试探针不循环，失败保存恢复入口 |

## 4. Model orchestration 层测试

| ID | 场景 | 预期 |
|---|---|---|
| V1-9-M01 | 完整材料包离线受控模型序列 | 轨迹可超过 8 Tool 且由同一 Main Agent 分段继续；不要求 runner 发送“继续” |
| V1-9-M02 | 每轮 Tool 集合刷新 | 新 Artifact 产生后下游 Tool 可发现；没有可信目标时 Director/Critic 不暴露 |
| V1-9-M03 | Tool 失败 | Main Agent 读取具体 Observation/reasonCode，修输入、换合法 Tool 或 Replan |
| V1-9-M04 | 预算或真实副作用门 | 只有真实 HumanGate 停止；标准范围内内部与外部生产不逐 Tool 确认 |
| V1-9-M05 | Skill 增强 | 仅加载 Main Agent 当前选择 Tool 对应 Skill；Skill 结果不能选择下一 Tool |
| V1-9-M06 | 课程锚点 | 视频先是脱离教材仍成立的独立创意短片，再以唯一最小锚点回接，不固定儿童、教师、教室或课堂活动 |
| V1-9-M07 | PPT候选语义失败 | Observation包含具体scope或validator issue，Main Agent据此修输入/换路径；不同失败不得因泛化signature被误判为等价重复 |
| V1-9-M08 | Main Agent 调用专项业务 Tool | 专项 Runtime 使用 Tool call 的非空 `userInstruction`，只投影该 Tool `requiredArtifactKinds` 的可信 Artifact；完整 TaskBrief 仍保留，不把全部历史成果重复塞入 prompt |
| V1-9-M09 | 分镜专项 Runtime 健康验证 | 离线先证明请求上下文有界，再只发一次零重试结构化分镜请求；超时必须记录模型、通道、推理强度、输入规模和阶段，不通过提高超时掩盖 |
| V1-9-M10 | 分镜模型输出责任 | 模型只生成严格 `videoStoryboardManifest`；服务端计算 digest、校验并从同一事实源渲染教师 Markdown，不要求 JSON 字符串套 JSON，不用 deterministic 内容补全失败字段 |

## 5. Runner authority 与恢复测试

| ID | 场景 | 预期 |
|---|---|---|
| V1-9-R01 | runner start | 独立 SQLite、artifact root、Next app root、动态端口、单 worker、desktop-only、deterministic 强制关闭 |
| V1-9-R02 | mutation ledger | 只记录登录、新建一个项目、一次 UI 消息提交和最终下载；无 `page.route`、Artifact 写、Tool 调用、批准或生成 endpoint |
| V1-9-R03 | orchestration count | 由 ledger 推导为 0，禁止常量硬编码 |
| V1-9-R04 | runner resume | 绑定同一 run manifest、SQLite、projectId、taskId、IntentEpoch 和 checkpoint；不再次发送完整目标 |
| V1-9-R05 | typed PendingDecision | runner 停止留证，不自动确认、不选择选项 |
| V1-9-R06 | Provider/进程恢复 | 只恢复同一任务和受影响单元，不新建第二个完整项目 |
| V1-9-R07 | 显式新运行 | 只有`start-new + predecessorRunId`精确匹配历史active pointer时才创建新run；默认入口仍拒绝隐式替换 |
| V1-9-R08 | 历史证据不可变 | 新run创建前后旧manifest SHA-256一致；历史runRoot/SQLite/Artifact/Observation/Skill lock不改写 |
| V1-9-R09 | 启动基线冻结 | manifest一次写入main HEAD、运行源码、需求、Registry、Projection、Binding Policy、活动Skill和全部Provider非敏感摘要；preflight只读 |
| V1-9-R10 | 运行中合同漂移 | 任一冻结摘要变化时请求数0并失败关闭；必须终止旧run后另建显式后继，不能同run迁移 |
| V1-9-R11 | 任务合同一次绑定 | 首次TaskBrief/IntentGrant/预算/强度/初始plan绑定后不可改写；plan revision只允许单调推进 |
| V1-9-R12 | manifest与运行状态分离 | `run-manifest.json`创建后字节和SHA-256不变；project/task/checkpoint/mutation/recovery/packageAcceptance只写`v1-9-run-state.v2` |
| V1-9-R13 | 最终包等待外部验收 | 下载正式package后状态为`package_ready_for_external_acceptance`；审核报告绑定run/manifest/package Artifact/version/SHA，不能只信任调用方给出的digest |
| V1-9-R14 | 首轮外部审核发现P0 | report以不可变round落盘，run-state进入`external_acceptance_repair_required`并保持active pointer；open finding IDs、责任层、设计/漏洞反馈和affected units均持久化 |
| V1-9-R15 | external-audit evidence ingress与启动恢复 | 只把report/handoff写成同task/IntentEpoch的Observation、checkpoint、SemanticSnapshot/Event引用，并恢复同一TurnJob；启动时从v2 pointer/manifest/run-state/handoff验证同一queued Job后仅drain一次，不要求Provider健康证据；错actor/task/epoch/checkpoint/handoff digest均失败关闭，教师消息新增0、业务Tool调用0、Provider调用0 |
| V1-9-R16 | 新package定点复验 | 新Artifact版本与ZIP SHA形成后，下一round只接受上一轮open finding IDs及其affected units；旧package/未受影响版本不覆盖、不重生成 |
| V1-9-R17 | 最终关闭 | 当前round P0=0且全部历史P0有closure evidence后才completed；state提交后pointer关闭失败可幂等恢复，manifest与历史round字节不变 |
| V1-9-R18 | 审核提交与锁恢复 | ingress提交后响应丢失可从不可变report/handoff前滚；历史report改写、同round不同字节和currentRepair漂移均失败关闭；live lock拒绝，dead或明确超时的损坏锁可接管且不删除期间被替换的新锁 |
| V1-9-R19 | fixture baseline与frozen app实际运行闭包 | root `fixtures/`进入`baselineLock.runtimeSourceDigest`；冻结树覆盖`src/`、`public/`、`config/`、运行所需`fixtures/`与根配置，并至少包含`package-lock.json`、实际requested V1-9 observer spec、`tests/e2e/support/feedback.ts`及其相对依赖`tests/e2e/support/redline.ts`、`scripts/lib/v1-9-e2e-contract.mjs`、evidence sanitizer和最终包选择器；闭包随真实import增减，修改任一root fixture使preflight在请求0时漂移失败，Playwright从冻结spec绝对路径运行 |
| V1-9-R20 | fresh复制期一致性 | 同一次freeze的`source-before`、`source-after`与staging copy digest完全相等；生成专用Next配置后的完整frozen digest另行绑定，复制期间修改源码不得发布final |
| V1-9-R21 | owned staging原子发布 | staging位于同一canonical runRoot、父目录显式创建、marker以`wx`写入且完整校验后才原子rename；复制/marker/rename失败只清本次staging，不新建半成品final，既有final与其他run文件字节不变 |
| V1-9-R22 | marker与显式恢复身份 | outer runner传`V1_9_E2E_RUN_ID`与`V1_9_E2E_MANIFEST_SHA256`；`m67-frozen-app.v3`只含合同字段并绑定同一runId、manifest SHA、source/copy/full-tree digest；`start-new`拒绝既有final，`resume`只由显式`V1_9_RUN_MODE`与合法run-state进入，不以SQLite存在推断 |
| V1-9-R23 | Windows canonical containment | runRoot、staging、final及闭包祖先任一junction/symlink/reparse或realpath逃逸均拒绝；创建前词法owned-child与创建后canonical containment都必须通过 |
| V1-9-R24 | 启动前与停服后冻结树复核 | 每次启动Next前、Playwright结束且Next停服后均重算marker/tree；任一次漂移都使证据无效并阻止继续，resume同样执行双复核 |
| V1-9-R25 | frozen cwd、唯一dist cache与observer隔离 | configured frozen模式的Next child `cwd`为frozen app，`process.cwd()`只能读取冻结`config/fixtures`；`.next-m67`每次启动前清空，不复用仓库或其他run的`.next`；observer及support从冻结树加载，修改仓库原文件不改变本run逻辑 |
| V1-9-R26 | V1-9恢复authority根 | outer runner显式传`SHANHAI_V1_9_REPOSITORY_ROOT`；V1-9 startup recovery仅从该canonical根解析active pointer/manifest/state，错误根失败关闭；普通非V1环境未设置时仍兼容`process.cwd()` |
| V1-9-R27 | installed-tree健康门 | `node_modules`不复制；preflight有界执行并严格解析`npm ls --all --json`。仅允许lockfile中同版本、`optional/devOptional`且有`integrity/inBundle`证据的extraneous，并只记录脱敏计数；未锁/版本错/非optional extraneous、missing、invalid、peer、超时/启动错误、非法JSON或`problems`结构、非0退出均在Next和Provider请求0时失败关闭；运行期间禁止install/update |
| V1-9-R28 | installed-tree P1残余边界 | `package-lock.json`由manifest runtime source与frozen闭包共同锁定且R27健康门通过，但不宣称`node_modules`文件字节级不可变；closeout明确记录shared installed tree残余 |

`V1-9-R19`至`V1-9-R27`是新唯一运行必须关闭的仓内P0：所有pre-start分支失败时Next与Provider请求均不得开始；`V1-9-R24`的post-stop复核失败则使本轮证据无效，并阻止后续resume、外部验收或Provider返修。`V1-9-R28`是不得隐去的仓内P1残余，不在本轮临时扩张为完整`node_modules`物化，但不得把它误报为已隔离。

## 6. 唯一真实桌面 Product E2E

冻结输入后只执行一次：

```text
一名受邀教师
一个新项目
一条完整材料包目标
标准强度
已披露并绑定的TaskBrief预算profile
真实Main Agent Responses通道
真实Skill projection
真实图片/视频/PPT生产Provider
```

验收：

| ID | 预期 |
|---|---|
| V1-9-E01 | Main Agent Tool 暴露与选择轨迹动态、完整，外部 Codex 编排介入 0 |
| V1-9-E02 | 结构化教案真实模型来源、证据和版本绑定正确 |
| V1-9-E03 | 可编辑 PPTX 真实 slideCount 与 TaskBrief 目标一致，页面/素材/字体和血缘可验证 |
| V1-9-E04 | 课堂视觉图是真实文件，来源、hash、版本和用途绑定正确 |
| V1-9-E05 | MP4 为 30-90 秒完整成片，ffprobe、完整解码、音轨、字幕、时间线和采样帧证据齐全 |
| V1-9-E06 | 独立创意短片脱离教材仍成立，只有一个最小课程锚点回接 |
| V1-9-E07 | `ClassroomRunSpec` 顺序、课程锚点和 Artifact 角色一致 |
| V1-9-E08 | ZIP 含正式 package asset；manifest/hash/版本/审查批次反向验证一致 |
| V1-9-E09 | 失败只返修受影响页面、镜头或版本，未受影响 Artifact 不重生成 |
| V1-9-E10 | 无 mock、placeholder、deterministic fallback 或 degraded 成果冒充完成 |

## 7. 外部只读验收

成包后外部 Codex 只读取并生成 `ExternalAcceptanceReport`：

- 首轮P0可以大于0，但报告必须保留并转入产品内局部返修；P0大于0不得completed或关闭pointer。
- 每个 finding 必须有 artifact/page/shot/version locator。
- locator必须确定性导出affected units；finding必须带责任层、设计/漏洞反馈和建议回归用例。
- 不调用业务 Tool，不改 Artifact，不批准教师节点，不手工重打包。
- 未形成正式 package asset 时不得进入本步骤。
- 后续round只复验上一轮open finding IDs及affected units；全部历史P0关闭且当前轮P0=0才通过。

## 8. 验证顺序

```powershell
npx vitest run tests/task-budget-policy.test.ts tests/v1-9-product-preflight.test.ts tests/skill-registry-loader.test.ts tests/business-tool-skill-runtime.test.ts --maxWorkers=1
npx vitest run tests/control-plane-persistence.test.ts tests/atomic-tool-result-commit.test.ts tests/agent-runtime/main-agent-tool-loop-config.test.ts src/server/workbench/__tests__/stage60-conversation-turn-queue.test.ts --maxWorkers=1
npx vitest run tests/agent-tools/main-agent-tool-registry.test.ts tests/provider-tool-adapter.test.ts tests/package-tool-adapter.test.ts tests/versioned-final-package.test.ts --maxWorkers=1
node --test tests/m67-e2e-runner.test.mjs tests/v1-9-e2e-runner.test.mjs
npx tsx scripts/v1-9-product-preflight.ts # 内部严格解析 npm ls --all --json；只持久化允许残余的脱敏计数
npx tsc --noEmit
npm test
npm run build
node --test tests/provider-ledger-all-providers.test.ts
git diff --check
```

实际命令按仓内 runner 和测试框架最终文件名校准；全量测试必须限制 worker 并检查残留 Node/Playwright 进程。

## 9. 阶段门

历史真实桌面运行已经终止为只读失败证据。执行A23新唯一运行前必须满足：

1. V1-9-C/X/M/R 全部通过。
2. Skill、Provider 台账、FFmpeg/ffprobe、LibreOffice/渲染和持久存储 preflight 全部通过。
3. 新runner manifest在创建时已冻结输入、prompt digest、源码工作树、需求基线、Registry、Projection、Binding Policy、全部Provider非敏感摘要；preflight不再补写锁。
4. `V1-9-R19`至`V1-9-R27`仓内红绿全部通过：root fixture进入baseline并有漂移请求0断言，frozen app真实闭包、三摘要一致、owned staging原子rename、marker身份、显式resume、Windows canonical containment、frozen cwd、V1-9恢复authority根、实际observer、启动前/停服后复核及installed-tree严格解析均有可执行证据；真实run仍须在停服后保存同一摘要复核证据。
5. `V1-9-R28`在manifest runtime source与closeout中如实保留：`package-lock.json`已锁定且installed-tree健康，但shared `node_modules`未做文件字节级隔离，不得写成P0已解决。
6. `deterministic fixture=false`、`projects=chromium-desktop`、`workers=1`。
7. 历史`v1-9-20260714212914-a036beb9` manifest哈希保持不变并有显式历史索引；active pointer只指向新runId，前序关系可核验。
8. TypeScript、全量测试、构建、API 台账校验和 diff check 为新鲜绿证据。
9. fresh run不复用或伪造旧恢复健康ID；只有新run后续进入`paused_recovery/failed`才要求晚于其停止点、完整匹配冻结Provider lock且`providerRequestCount=1/maxRetries=0/retryCount=0/result=succeeded`的新证据。

V1-9 通过前不得进入教师签收、部署或 V1-10。

## 10. 2026-07-15 离线绿态

| 证据层 | 结果 | 边界 |
|---|---|---|
| `contract` | Skill/预算/manifest/runner专项通过；21 个业务 Tool policy 完整；Skill 1.2 projection 与 lock digest 通过 | 不证明真实 Provider 产物 |
| `executor` | ExecutionEnvelope、原子提交、持久调用台账、显式 TTS、checkpoint/恢复、媒体信任和无现场拼包通过 | 不证明真实长任务稳定性 |
| `model orchestration` | R5 桌面已通过；离线受控序列覆盖动态 Tool、Observation/Replan、自动续段和 Skill 增强 | 唯一真实完整包轨迹仍待 V1-9 |
| `product E2E` | historical run paused / A23 new run not started | 旧任务及真实Tool、Artifact、旁白、分镜和502只保留历史证据；A23新run尚无PPTX、完整MP4、课堂图或ZIP |
| `release` | 未启动 | 教师签收、部署和切流仍受 V1-10 授权门约束 |

新鲜验证：Skill冻结、assistant-ui事件/恢复、A/B产品合同、runner与Provider ledger专项通过；Node全量`294/294`、Vitest全量`162 files / 1106 tests`、TypeScript、14页面生产构建、API台账公开/私有校验及`git diff --check`全部通过。Agents SDK仍为隔离评估且不具备生产切换资格；本轮未调用Provider。

2026-07-15新增健康门证据：证据合同专项`4 files / 28 tests`、受影响控制面`8 files / 58 tests`、Node runner/smoke`10/10`、TypeScript、全量`npm test`、14页面生产构建、API台账公开/私有校验和`git diff --check`均通过。随后专用探针对冻结`primary / gpt-5.5`只提交1次Responses请求，SDK重试0，返回`authorization`失败；证据`agent-brain-health-20260714230547-97f623bd-dd8`已双写台账与run目录。V1-9保持`paused_recovery`，未启动媒体或整包Provider。

2026-07-15恢复一致性新增证据：失败处理、checkpoint、PPT repair输入、同TurnJob合同和观察器归因先红后绿；定向`7 files / 111 tests`、Node V1-9 runner`8/8`、TypeScript、单worker全量Node`297/297`、Vitest`172 files / 1169 tests`、14页面生产构建和`git diff --check`通过。双worker全量曾出现9个SQLite锁/超时，改按V1单实例SQLite拓扑单worker复跑后全部通过，不计业务回归。真实恢复已越过checkpoint校验并进入Main Agent Responses continuation，随后上游返回502；最新TurnJob为`main_agent_provider_unavailable / after_provider_health_change`，没有业务Tool或媒体Provider新增调用。没有新健康证据前不再等价请求。

历史`generate_video_narration`音色绑定问题已由X15-X18红绿、台账音色绑定和短文本零重试探针关闭；历史`generate_video_storyboard` 180秒问题也已由Tool主指令优先、所需Artifact投影、单一事实源输出和服务端反向资产绑定关闭。这两项保留为修复证据，不再列为当前阻塞。旧run的Main Agent Responses continuation健康门同样只作历史证据；fresh A23 run在启动前验证当前台账与冻结摘要，不要求恢复健康证据，只有该新run后续进入`paused_recovery/failed`时才启用匹配的新健康证据门。
