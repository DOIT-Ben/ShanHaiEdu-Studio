# 目标模式 Hand off：E2E Verification

你现在接手 `ShanHaiEdu-Studio` 的 E2E Verification 主线。请进入目标模式，而不是只做一次性回复。

## 目标模式

如果当前环境支持 goal / 目标工具，第一步请创建目标：

```text
完成 ShanHaiEdu-Studio E2E Verification 主线的 MVP 可合并版本：建立端到端验收体系，证明本地 MVP 能真实完成新建项目、发送需求、生成 artifact、节点显示、确认、刷新恢复和两个项目隔离。
```

如果当前环境没有 goal 工具，也要在回复开头明确这个目标，并持续推进到目标完成。不要写完规划就停；规划只是第一步。只有满足以下任一条件才允许结束：

- 本主线目标完成，测试和构建通过，变更已提交，且给出可合并说明。
- 出现同一个外部阻塞连续三轮无法绕过，已写清已知事实、阻塞点、已尝试动作、下一步最小动作。

## 工作目录

```powershell
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\e2e-verification
```

进入该 worktree 后先执行：

```powershell
git status --short --branch
```

## 必读材料

1. `AGENTS.md`
2. `REQUIREMENTS_DECISION_V1.md`
3. `docs\mainlines\README.md`
4. `docs\mainlines\e2e-verification.md`
5. `docs\mvp-to-production-agent-architecture.md`

## 主线目标

建立可持续 E2E 验收体系，覆盖：

- 新建项目。
- 输入一句话需求。
- 生成 artifact。
- 右侧节点显示。
- artifact 详情查看。
- 用户确认。
- 刷新恢复。
- 两个项目隔离。
- 用户可见界面无工程词。

## 执行协议

严格按项目准则执行：

```text
调研当前测试工具和运行脚本
-> 写阶段规划文档
-> 写 E2E 测试文档
-> 按规划补齐测试基础设施
-> 等最小 vertical slice 出现后执行集中验收
-> 记录失败证据并推动对应主线修正
-> 收尾记录
-> 提交本主线变更
```

第一阶段必须先产出：

- `docs\stages\e2e-stage1-plan.md`
- `docs\stages\e2e-stage1-test-plan.md`

写完规划和测试文档后继续推进测试基础设施。若 backend + frontend + deterministic runtime 尚未集成，先完成 Playwright/脚本/测试数据/验收报告模板，不要替其他主线实现业务功能。

## 边界

- 不实现业务功能。
- 不替其他主线修代码，除非是测试代码问题。
- 不把小 smoke 当阶段通过。
- 不把 mock 链路当真实 MVP 验收。

## 阶段验收

阶段完成前必须证明：

- `npm run build` 通过。
- 浏览器关键路径跑通。
- 刷新恢复。
- 两个项目互不串。
- 用户可见界面无工程词。
- E2E 失败时能给出可定位证据。

## 收尾要求

完成后提交本 worktree 的变更，提交信息使用中文格式：

```text
类型: 简要描述 | 版本号 | YYYY-MM-DD HH:MM
```

最终回复要说明：完成了什么、关键文件、验证命令和结果、剩余风险、是否可以合并到 `main`。
