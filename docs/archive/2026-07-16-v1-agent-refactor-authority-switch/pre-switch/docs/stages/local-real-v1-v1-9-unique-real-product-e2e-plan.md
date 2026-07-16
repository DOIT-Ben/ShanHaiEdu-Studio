# V1-9 仓内执行完整性收口与用户验收交接计划

更新时间：2026-07-16

状态：`REPOSITORY GO / PRODUCT E2E NOT VERIFIED`

## 目标

在不重跑R5、不运行390px、不复用旧run的前提下，关闭仓内Runner、installed-tree和控制面恢复完整性门，并向用户交付可重复的验证入口。真实V1-9、manifest/runId、Provider调用和产物验收由用户后续执行；Codex本轮不进入真实交付物链路。

## Go/No-Go

| Gate | Go条件 | No-Go处理 |
|---|---|---|
| G1 权威冻结 | 新运行开始前采用当时最新已验收的需求基线、Registry、Runtime Projection、Binding Policy、源码工作树和Provider非敏感摘要，并一次写入不可变manifest | **用户后续执行，not executed**；任一摘要缺失或漂移时请求数0，旧run只读保留 |
| G2 路径完整性 | ownerRoot、runRoot、staging、frozen app、observer、依赖根及全部既存祖先通过lexical、realpath、junction/symlink/reparse containment | **GO**；任一逃逸仍必须失败关闭，不创建final，不启动Next或Provider |
| G3 验证与缓存顺序 | marker、identity和全部source/copy/frozen digest先验证；验证通过后才允许清理或重建运行缓存 | **GO**；失败保持既有final、`.next-m67`、`.tmp`和其他run字节不变 |
| G4 异常停止完整性 | 正常、signal、超时、taskkill失败和父进程异常均有有界进程树停止、确认退出和post-stop摘要复核 | **GO**；未证明完全停止或摘要一致时证据无效，不允许resume |
| G5 Installed tree | 严格解析`npm ls --all --json --long=true`，并验证实际package root及祖先realpath/reparse；lock-backed与允许optional extraneous均不能逃逸 | **GO**；missing、invalid、peer、非法extraneous、非法JSON、超时、非0退出或路径逃逸全部请求数0 |
| G6 仓内Preflight | finding红绿、V1-9 runner/preflight扩大回归、TypeScript、单worker全量测试、构建、API台账和diff检查全部新鲜通过 | **GO**；只修有证据责任层，不调用Provider，不以旧绿态代替 |
| G7 唯一产品运行 | 独立SQLite、Artifact root、Next app root、动态端口、单worker、desktop、deterministic=false；一名受邀教师、一个新项目、一条完整材料包目标 | **用户后续执行，not verified**；Runner只提交一次UI消息并观察，不固定Tool顺序 |
| G8 成包与退出 | 真实教案、可编辑PPTX、课堂视觉、30至90秒MP4、唯一最小课程锚点、ClassroomRunSpec和正式ZIP通过版本/摘要/血缘验收；P0只返修受影响单元 | **用户后续验收，not verified**；未形成正式package asset不进入外部审核 |

## 运行规则

- 运行开始后合同和摘要冻结到结束。实质升级终止旧run并创建显式后继，不能同run换规则。
- Main Agent读取具体Observation，自主continue、repair、换Tool、Replan或暂停；Director/Critic不机械必经。
- 标准授权范围内零例行确认；HumanGate只处理真实选择、授权、预算、外发、权限或破坏性副作用。
- 重试预算耗尽时保存恢复入口并停止，不循环，不生成fallback或degraded成果。
- 外部验收finding必须绑定artifact/page/shot/version locator；后续只复验仍open finding及affected units。

## 本轮退出条件

G2至G6仓内资格已通过，当前Codex任务以`repository GO`、验证证据和用户自验收入口交接结束。G1新manifest、G7真实运行和G8真实产物均未执行，也不计入本轮完成；`model orchestration`、`product E2E`和`release`继续标记为`not verified`。
