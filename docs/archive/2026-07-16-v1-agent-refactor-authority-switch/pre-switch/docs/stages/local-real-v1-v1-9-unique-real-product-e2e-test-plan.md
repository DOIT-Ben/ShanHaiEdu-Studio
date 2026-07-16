# V1-9 仓内执行完整性与用户验收测试计划

更新时间：2026-07-16

状态：`REPOSITORY GO / PRODUCT E2E NOT VERIFIED`

## 证据规则

- 每项结果标记 `contract`、`executor`、`model orchestration`、`product E2E` 或 `release`。
- 每个缺陷先有真实红测，再做最小修复和对应绿测；不以代码阅读或旧测试计数冒充关闭。
- 仓内阶段不调用真实图片、视频、PPTX、ZIP或整包Provider。
- R5不重跑；V1发布前不新增390px真实黑盒。

## Go/No-Go测试

| Gate | 必须通过的断言 | 证据层 |
|---|---|---|
| T1 仓内权威与历史不可变 | 活动基线一致；旧manifest、run-state、active pointer、SQLite、Artifact和Skill lock字节不变；本轮不创建新manifest/runId且Provider请求数0 | contract |
| T2 Frozen路径红绿 | existing ancestor junction、ownerRoot/baseRoot reparse、跨根realpath、staging/final逃逸均被拒绝；至少覆盖Windows junction和symlink可用路径 | contract / executor |
| T3 缓存与停止红绿 | 伪造marker digest失败时缓存witness保持；signal、timeout、taskkill失败均等待进程树退出并执行post-stop；失败证据不可被completed覆盖 | executor |
| T4 Installed-tree红绿 | 正常lock-backed、hoisted、nested、scoped和允许optional extraneous分别经仓外junction均失败；合法`.bin`与npm cache不误判；解析失败时Next/Provider请求0 | contract / executor |
| T5 控制面扩大回归 | ExecutionEnvelope、ActionPolicy、原子Observation、checkpoint、Main Agent单一编排、assistant-ui恢复、Skill绑定、无fallback及双用户隔离通过 | contract / executor |
| T6 仓内资格门 | V1-9 runner/preflight、TypeScript、单worker全量测试、生产构建、API台账公开/私有校验和`git diff --check`新鲜通过；无残留测试进程 | contract / executor |
| T7 用户唯一桌面产品E2E | **本轮不执行、不计入仓内GO**；用户后续在独立环境以`workers=1`、`deterministic=false`运行，mutation ledger只含登录、新建项目、一次UI消息和最终下载，外部Codex编排介入0 | model orchestration / product E2E |
| T8 用户真实产物验收 | **本轮不执行、不计入仓内GO**；用户后续验收PPTX实际slideCount、图片、MP4完整解码/音轨/字幕/30至90秒、唯一锚点、ClassroomRunSpec、正式package asset和ZIP反向摘要一致 | product E2E / release |

## 本轮已新增并通过的红测

1. `ancestor junction accepted`必须先复现为红，再证明完整祖先链失败关闭。
2. 同run identity正确但frozen digest伪造时，`.next-m67`和`.tmp`见证文件必须保持不变。
3. signal与外层timeout必须证明整棵进程树停止后才返回，并无条件执行post-stop摘要复核。
4. lock-backed依赖与允许optional extraneous分别指向仓外junction时，真实installed-tree probe必须返回false。
5. 更高plan revision即使带有更早的审查时间，也必须成为同一任务的最新语义快照。
6. 同项目、同IntentEpoch的其他task高revision快照不得污染Main Agent恢复上下文。
7. 外部审查证据首次提交后若项目已改道提升IntentEpoch，旧幂等重放必须失败关闭。

## 执行顺序

```text
完整性与恢复单点红测
-> 对应最小绿测
-> Runner/installed-tree交叉回归
-> 控制面扩大回归
-> TypeScript / 单worker全量 / build / ledger / diff
-> 残留测试进程检查
-> repository GO
-> 向用户交付真实运行与验收入口
```

任一T1至T6失败都保持repository NO-GO。T1至T6已通过后当前Codex任务结束；T7和T8由用户后续执行，在新证据产生前保持`not verified`。
