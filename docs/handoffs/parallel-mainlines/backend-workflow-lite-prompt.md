你接手 `ShanHaiEdu-Studio` 的 `Backend Workflow Lite` 主线，进入目标模式持续推进，直到本主线完成、验证通过、提交并给出可合并结论；不要只写计划后停止。

工作目录：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\backend-workflow-lite`
本地分支：`feature/mvp-backend-workflow-lite`
远程分支：`origin/feature/mvp-backend-workflow-lite`

先执行并确认：
`git status --short --branch`
`git branch -vv`

先读：
1. `AGENTS.md`
2. `REQUIREMENTS_DECISION_V1.md`
3. `docs\mvp-to-production-agent-architecture.md`
4. `docs\mainlines\README.md`
5. `docs\mainlines\backend-workflow-lite.md`

主线目标：
- 建立真实 MVP 状态真源，覆盖 Project、ConversationMessage、WorkflowNode、Artifact、AgentRun。
- 提供项目、消息、节点、产物、确认状态的保存、读取和恢复能力。
- 提供项目 snapshot、artifact approve / regenerate 的最小闭环。
- 保证两个项目不会串数据，并为前端和 Runtime 提供稳定 API 合同。

执行规则：
- 先把整条主线拆成阶段，原则上不超过 20 个阶段。
- 每个阶段都按：阶段规划文档 -> 阶段测试文档 -> 集中开发 -> 集中测试 -> 修复复测 -> 阶段收尾 -> 提交。
- 阶段内可以做必要快速检查，但阶段验收必须等该阶段开发完成后集中执行。
- 一个阶段完成并提交后，再进入下一阶段。
- 不堆补丁；必要时先重构。
- 不污染 `main`。
- 不把 mock / placeholder / deterministic 输出伪装成真实完成。

推荐第一阶段：
完成后端状态真源与 API 合同的阶段拆分，并先落地 Stage 1：调研 Next.js API、Prisma、Postgres/SQLite 开发期方案，产出 `docs\stages\backend-workflow-lite-stage1-plan.md` 和 `docs\stages\backend-workflow-lite-stage1-test-plan.md`，随后继续完成 Stage 1 开发、验收和提交。

边界：
- 不改前端视觉。
- 不接 OpenAI。
- 不做 PPTX、视频、图片生成。
- 不把数据库、文件路径、密钥写死到业务组件里。
- 跨主线问题只记录接口需求或阻塞，不越界重写。

停止条件：
- 本主线目标全部完成、测试通过、已提交，并说明是否可合并到 `main`。
- 或同一外部阻塞连续三轮无法绕过，并写清事实、阻塞、尝试、下一步。
