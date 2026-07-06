你接手 `ShanHaiEdu-Studio` 的 `E2E Verification` 主线，进入目标模式持续推进，直到本主线完成、验证通过、提交并给出可合并结论；不要只写计划后停止。

工作目录：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\e2e-verification`
本地分支：`feature/mvp-e2e-verification`
远程分支：`origin/feature/mvp-e2e-verification`

先执行并确认：
`git status --short --branch`
`git branch -vv`

先读：
1. `AGENTS.md`
2. `REQUIREMENTS_DECISION_V1.md`
3. `docs\mvp-to-production-agent-architecture.md`
4. `docs\mainlines\README.md`
5. `docs\mainlines\e2e-verification.md`

可用私有资料：
- 本地 API 台账见 `docs\private-api-ledger.md`。需要确认真实 API 验收边界或 provider 能力时可查，但不得提交、摘录或泄露其中的密钥和敏感配置。

主线目标：
- 建立可持续 E2E 验收体系，证明本地 MVP 真实可用。
- 覆盖新建项目、输入需求、生成 artifact、右侧节点显示、详情查看、用户确认、刷新恢复。
- 验证两个项目互不串，用户可见界面无工程词。
- 失败时能输出可定位证据，并推动对应主线修正。

执行规则：
- 先把整条主线拆成阶段，原则上不超过 20 个阶段。
- 每个阶段都按：阶段规划文档 -> 阶段测试文档 -> 集中开发 -> 集中测试 -> 修复复测 -> 阶段收尾 -> 提交。
- 阶段内可以做必要快速检查，但阶段验收必须等该阶段开发完成后集中执行。
- 一个阶段完成并提交后，再进入下一阶段。
- 不堆补丁；必要时先重构。
- 不污染 `main`。
- 不把 mock / placeholder / deterministic 输出伪装成真实完成。

推荐第一阶段：
完成 E2E 主线阶段拆分，并先落地 Stage 1：调研当前测试工具和运行脚本，产出 `docs\stages\e2e-stage1-plan.md` 和 `docs\stages\e2e-stage1-test-plan.md`，随后继续完成 Playwright/脚本/测试数据/验收报告模板的开发、验收和提交。

边界：
- 不实现业务功能。
- 不替其他主线修代码，除非是测试代码问题。
- 不把小 smoke 当阶段通过。
- 不把 mock 链路当真实 MVP 验收。
- 跨主线问题只记录接口需求或阻塞，不越界重写。

停止条件：
- 本主线目标全部完成、测试通过、已提交，并说明是否可合并到 `main`。
- 或同一外部阻塞连续三轮无法绕过，并写清事实、阻塞、尝试、下一步。
