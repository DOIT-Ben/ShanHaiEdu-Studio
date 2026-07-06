# 目标模式 Hand off：Agent Runtime Adapter

你现在接手 `ShanHaiEdu-Studio` 的 Agent Runtime Adapter 主线。请进入目标模式，而不是只做一次性回复。

## 目标模式

如果当前环境支持 goal / 目标工具，第一步请创建目标：

```text
完成 ShanHaiEdu-Studio Agent Runtime Adapter 主线的 MVP 可合并版本：建立可替换的 AgentRuntime 接口，先用 DeterministicRuntime 跑通稳定文本产物，再接 OpenAI Runtime 的服务端边界，并通过 runtime contract 验收。
```

如果当前环境没有 goal 工具，也要在回复开头明确这个目标，并持续推进到目标完成。不要写完规划就停；规划只是第一步。只有满足以下任一条件才允许结束：

- 本主线目标完成，测试和构建通过，变更已提交，且给出可合并说明。
- 出现同一个外部阻塞连续三轮无法绕过，已写清已知事实、阻塞点、已尝试动作、下一步最小动作。

## 工作目录

```powershell
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\agent-runtime-adapter
```

进入该 worktree 后先执行：

```powershell
git status --short --branch
```

## 必读材料

1. `AGENTS.md`
2. `REQUIREMENTS_DECISION_V1.md`
3. `docs\mvp-to-production-agent-architecture.md`
4. `docs\mainlines\README.md`
5. `docs\mainlines\agent-runtime-adapter.md`

## 主线目标

建立可替换的 Agent Runtime：

- `AgentRuntime` 输入输出合同。
- `DeterministicRuntime`，无 key 时可稳定生成 artifact draft。
- `OpenAIRuntime` 服务端接入边界。
- 节点任务模式：需求规格、教材证据、教案、PPT 大纲、视频方案、最终交付清单。
- 失败恢复信息必须是教师可理解的，不暴露 provider、schema、debug 等工程词。

## 执行协议

严格按项目准则执行：

```text
调研 OpenAI SDK / Responses API / Agents SDK 和项目既有边界
-> 写阶段规划文档
-> 写 runtime contract 测试文档
-> 按规划开发
-> 按测试文档集中验收
-> 审查与修正
-> 收尾记录
-> 提交本主线变更
```

第一阶段必须先产出：

- `docs\stages\agent-runtime-stage1-plan.md`
- `docs\stages\agent-runtime-stage1-test-plan.md`

写完规划和测试文档后继续开发。先完成 deterministic runtime 和接口合同，再接真实 OpenAI；不要因为真实模型接入未完成而停住整条主线。

## 边界

- 不把 OpenAI SDK 放进 React 组件。
- 不持久化业务状态，状态由后端主线负责。
- 不暴露 provider key。
- 不做 PPTX、视频、图片文件生成。
- 不把 deterministic 输出伪装成真实模型生成。

## 阶段验收

阶段完成前必须证明：

- 无 key 时 deterministic runtime 可生成稳定 artifact draft。
- 输出结构可被后端保存、前端展示。
- 失败时返回用户可理解恢复信息。
- runtime contract 测试通过。
- `npm run build` 通过。

## 收尾要求

完成后提交本 worktree 的变更，提交信息使用中文格式：

```text
类型: 简要描述 | 版本号 | YYYY-MM-DD HH:MM
```

最终回复要说明：完成了什么、关键文件、验证命令和结果、剩余风险、是否可以合并到 `main`。
