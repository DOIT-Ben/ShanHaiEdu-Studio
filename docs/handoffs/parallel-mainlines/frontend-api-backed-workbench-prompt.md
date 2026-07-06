你接手 `ShanHaiEdu-Studio` 的 `Frontend API-backed Workbench` 主线，进入目标模式持续推进，直到本主线完成、验证通过、提交并给出可合并结论；不要只写计划后停止。

工作目录：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\frontend-api-backed-workbench`
本地分支：`feature/mvp-frontend-api-backed-workbench`
远程分支：`origin/feature/mvp-frontend-api-backed-workbench`

先执行并确认：
`git status --short --branch`
`git branch -vv`

先读：
1. `AGENTS.md`
2. `REQUIREMENTS_DECISION_V1.md`
3. `docs\mvp-to-production-agent-architecture.md`
4. `docs\mainlines\README.md`
5. `docs\mainlines\frontend-api-backed-workbench.md`
6. `src\components\layout\MediaWorkbench.tsx`
7. `src\hooks\useWorkbenchController.ts`
8. `src\lib\types.ts`

可用私有资料：
- 本地 API 台账见 `docs\private-api-ledger.md`。需要确认接口能力或环境配置时可查，但不得提交、摘录或泄露其中的密钥和敏感配置。

主线目标：
- 保留当前 Codex 风格工作台，不重写 UI、不破坏纯白极简风格。
- 把项目、对话、节点、产物和确认状态从 mock 数据迁移到真实 API-backed controller。
- 支持项目列表加载、项目 snapshot 恢复、发送消息后同步对话和节点。
- 保留复制、作为输入、确认、重做、详情查看等交互，并通过桌面和窄屏检查。

执行规则：
- 先把整条主线拆成阶段，原则上不超过 20 个阶段。
- 每个阶段都按：阶段规划文档 -> 阶段测试文档 -> 集中开发 -> 集中测试 -> 修复复测 -> 自审/可开独立审查智能体 -> 阶段收尾 -> 提交 -> 推送远程分支 -> 进入下一阶段。
- 阶段内可以做必要快速检查，但阶段验收必须等该阶段开发完成后集中执行。
- 一个阶段完成、审查、提交、推送后，自动进入下一阶段；不要因为本地提交完成就停住。
- 如果本阶段需要独立审查，可以自行开审查智能体或执行等价审查；审查意见必须处理或记录为明确风险。
- 不堆补丁；必要时先重构。
- 不污染 `main`。
- 不把 mock / placeholder / deterministic 输出伪装成真实完成。

推荐第一阶段：
完成前端 API-backed 迁移的阶段拆分，并先落地 Stage 1：梳理当前组件和 controller 边界，产出 `docs\stages\frontend-api-backed-stage1-plan.md` 和 `docs\stages\frontend-api-backed-stage1-test-plan.md`，随后继续完成 API client 边界、加载态、错误态、可替换开发 adapter 的开发、验收和提交。

边界：
- 不直接在 React 组件里接 OpenAI SDK。
- 不让 mock 数据继续充当真实状态。
- 用户界面不出现工程词。
- 后端合同未完成时只做 adapter 边界和明确标注的开发态，不伪装真实能力。
- 跨主线问题只记录接口需求或阻塞，不越界重写。

停止条件：
- 本主线目标全部完成、测试通过、完成自审或独立审查、已提交并推送远程分支，并说明是否可合并到 `main`。
- 或同一外部阻塞连续三轮无法绕过，并写清事实、阻塞、尝试、下一步。
