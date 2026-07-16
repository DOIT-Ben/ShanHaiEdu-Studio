# ShanHaiEdu 当前主线状态

更新时间：2026-07-16

## 1. 当前结论

- 当前唯一任务主线为 **Main Agent Streaming + Prompt Cache + assistant-ui Step Projection**；状态为 **REAL MAIN AGENT TEXT STREAM VERIFIED / AUTHENTICATED PRODUCT CHAT ACCEPTANCE PENDING**。
- 唯一代码主线为 `main`，当前HEAD为 `fd2521f1b558`；工作区包含大量未提交在途改动，本次文档收敛未回滚、覆盖、commit或push它们。
- R5真实桌面验收作为历史通过证据保留，不重跑；V1发布前不新增390px真实黑盒。
- A23控制面、ExecutionEnvelope、原子提交、assistant-ui和恢复合同的既有仓内证据保留，不重做。
- Frozen app祖先路径、缓存验证顺序、异常停机、installed-tree路径边界以及外部审查恢复快照隔离均已红绿关闭；二次独立代码审查未发现剩余P1/P2。
- 本轮未运行390px或真实交付物链路，未创建manifest/runId，未改旧active pointer、旧run-state、真实Artifact或Skill projection。离线fixture服务及其数据库、日志和截图已删除，不再作为验收入口。
- 业务Skill权威源仍为集合根既有 `shanhaiedu-技能系统`；A23只是一份冻结Runtime Projection。
- 当前生产原生控制面把问候、解释和ReAct终态改为普通文本真流式；TaskBrief只通过 `submit_task_brief` function call 提交，Tool参数不进入教师界面。
- 同一turn的Tool、Observation、失败和Artifact入口合并为一条实时轨迹；提交后即时唤醒SSE，刷新通过有界回放恢复在途步骤，正式消息仍只在终态提交一次。
- 真实SQLite已备份并完成加法结构迁移，核心表行数保持不变、外键问题为0、完整性检查通过；376条缺少当前审计证据的历史批准成果按既有门禁降回待复核。
- 真实 `gpt-5.6-terra` Responses smoke通过；产品 `OpenAIMainConversationAgent` 对“你好”返回12个真实流式文本块，拼接结果与终态一致。真实生产服务运行于 `http://127.0.0.1:3187`，待用户登录完成浏览器产品对话验收。

## 2. 五层状态

| 证据层 | 当前状态 | 可以声称 | 不能声称 |
|---|---|---|---|
| `contract` | repository GO | G2至G6路径、缓存、停机、依赖树、恢复绑定和无fallback合同通过仓内验证 | 新运行合同已冻结或真实模型轨迹通过 |
| `executor` | repository GO | Frozen runner、installed tree、原子checkpoint、外部审查恢复和任务隔离已形成失败关闭边界 | 真实运行环境或真实文件执行器已通过 |
| `model orchestration` | text transport verified; R5 historical pass | 真实Main Agent自然文本流已通过；R5曾证明动态Tool、Observation/Replan和双用户隔离 | 当前版本的真实业务Tool轨迹或完整材料包已通过 |
| `product E2E` | real service running; authenticated chat pending | 真实数据库、Artifact存储和Provider通道均健康 | 登录后的完整对话、真实Tool轨迹或文件产物已验收 |
| `release` | not started | 发布底座历史演练可作参考 | 教师签收、生产切流或发布完成 |

## 3. 仓内关闭证据

| 范围 | 新鲜证据 | 结论 |
|---|---|---|
| Main Agent 流式与 assistant-ui | 自然文本/function-call/缓存/步骤/恢复定向 `110/110`；独立SQLite控制面与终态提交 `66/66`；assistant-ui Node合同 `5/5`；TypeScript和生产构建通过；真实Main Agent问候12个流式块且终态一致 | `contract`与`executor`仓内通过，真实文本对话通道通过；登录后的产品对话待用户验收 |
| 真实本地数据 | 迁移前SQLite备份完整性与SHA-256通过；迁移后核心表计数不变、缺列为0、foreign_key_check为0、integrity/quick check为ok | 真实数据库可由当前代码读取，迁移前状态可恢复 |
| Frozen与缓存 | Frozen定向`28/28`；祖先junction、reparse、digest失败前缓存字节保持均通过 | G2、G3 GO |
| Installed tree | installed-tree定向`68/68`；真实本机探针`ok=true`，允许optional extraneous为1 | G5 GO |
| 停机与外层Runner | shutdown authority、Runner/baseline交叉Node测试`76/76`，verify-only失败不进入外部验收 | G4 GO |
| 恢复快照隔离 | 新增backdated revision、跨task高revision和改道后旧replay红测；直接受影响`49/49`、扩大回归`153/153` | control-plane executor GO |
| 全量资格 | TypeScript通过；Node`381/381`；Vitest`190 files / 1457 tests`；生产构建通过 | G6 GO |
| 台账与静态检查 | API台账公开、私有校验均通过；`git diff --check`通过；残留测试进程为0 | G6 GO |

## 4. 未验证与非阻塞残余

- G1不可变manifest/runId和G8真实产物验收均未执行；G7只完成真实服务、数据库、Provider和Main Agent文本流验证，登录后的产品对话仍待用户验收。
- shared `node_modules`仍未逐文件字节物化冻结；现有installed-tree路径边界关闭逃逸，但不等于发布级可复现构建。
- Next生产构建成功，同时保留13条Turbopack动态文件追踪范围警告；它们未造成编译失败，后移为构建性能与打包范围专项，不扩张当前控制面任务。
- `product E2E`和`release`没有新证据，不能从repository GO上推。

## 5. 下一动作

1. 用户使用真实账号登录 `http://127.0.0.1:3187`，先验收问候首文本，再提交一个标准文本任务观察真实Tool进度、失败位置和Artifact入口；V1前不跑390px。
2. 只有登录后的真实产品轨迹产生新证据时才修对应责任层，不再使用离线fixture冒充验收。
3. 本次体验验收通过前不创建V1-9 manifest/runId，不调用真实交付物 Provider，也不进入教师签收或V1-10。

## 6. 恢复入口

- 当前阶段：`..\stages\local-real-v1-v1-9-unique-real-product-e2e-plan.md`
- 测试门：`..\stages\local-real-v1-v1-9-unique-real-product-e2e-test-plan.md`
- 需求不变量：`..\product\current-requirements-baseline.md`
- 归档迁移证据：`..\archive\2026-07-16-authority-convergence\archive-manifest.json`
