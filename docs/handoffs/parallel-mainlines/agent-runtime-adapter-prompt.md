你接手 `ShanHaiEdu-Studio` 的 `Agent Runtime Adapter` 主线，进入目标模式持续推进，直到本主线完成、验证通过、提交并给出可合并结论；不要只写计划后停止。

工作目录：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\agent-runtime-adapter`
本地分支：`feature/mvp-agent-runtime-adapter`
远程分支：`origin/feature/mvp-agent-runtime-adapter`

先执行并确认：
`git status --short --branch`
`git branch -vv`

先读：
1. `AGENTS.md`
2. `REQUIREMENTS_DECISION_V1.md`
3. `docs\mvp-to-production-agent-architecture.md`
4. `docs\mainlines\README.md`
5. `docs\mainlines\agent-runtime-adapter.md`

主线目标：
- 建立可替换的 `AgentRuntime` 输入输出合同。
- 先完成 `DeterministicRuntime`，无 key 时也能稳定生成 artifact draft。
- 建立 `OpenAIRuntime` 服务端接入边界，但不把 OpenAI SDK 放进 React 组件。
- 覆盖需求规格、教材证据、教案、PPT 大纲、视频方案、最终交付清单等文本节点任务。

执行规则：
- 先把整条主线拆成阶段，原则上不超过 20 个阶段。
- 每个阶段都按：阶段规划文档 -> 阶段测试文档 -> 集中开发 -> 集中测试 -> 修复复测 -> 阶段收尾 -> 提交。
- 阶段内可以做必要快速检查，但阶段验收必须等该阶段开发完成后集中执行。
- 一个阶段完成并提交后，再进入下一阶段。
- 不堆补丁；必要时先重构。
- 不污染 `main`。
- 不把 mock / placeholder / deterministic 输出伪装成真实完成。

推荐第一阶段：
完成 Runtime 主线阶段拆分，并先落地 Stage 1：调研 OpenAI SDK / Responses API / Agents SDK 与项目运行边界，产出 `docs\stages\agent-runtime-stage1-plan.md` 和 `docs\stages\agent-runtime-stage1-test-plan.md`，随后继续定义 `AgentRuntime` 合同、deterministic 输出结构、contract 测试、验收和提交。

边界：
- 不持久化业务状态，状态由后端主线负责。
- 不暴露 provider key。
- 不做 PPTX、视频、图片文件生成。
- 失败恢复信息要面向教师，不暴露 provider、schema、debug 等工程词。
- 跨主线问题只记录接口需求或阻塞，不越界重写。

停止条件：
- 本主线目标全部完成、测试通过、已提交，并说明是否可合并到 `main`。
- 或同一外部阻塞连续三轮无法绕过，并写清事实、阻塞、尝试、下一步。
