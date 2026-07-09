# M61 Agent OS 上下文契约与门禁闭环收尾记录

日期：2026-07-09

状态：已完成阶段性实现与验证；仍有 M62 后续项

## 1. 阶段目标

M61 目标是把山海智教工作台从“线性对话 + 产物生成”推进到 Agent OS 的最小可信骨架：

- 用 `ContextPackage`、上下文预算、摘要校验和节点契约约束模型输入边界。
- 用 `PlanGuard` / `HumanGate` 防止教师确认被误用或伪造。
- 用 route-level generation gate 防止真实 PPTX、图片、视频生成绕过源产物审批。
- 用 conversation turn queue 支持异步排队、幂等和失败恢复。
- 保持真实交付边界：未生成的 PPTX、图片、视频、最终包不得显示为已完成。

## 2. 已完成内容

### 2.1 上下文与契约基础

- 新增 `context-budget.ts`，提供 token 粗估和预算模式。
- 新增 `context-package.ts`，定义模型输入包边界。
- 新增 `session-compactor.ts` 与 `summary-validator.ts`，防止摘要把未完成产物写成已完成。
- 新增 `conversation-context-builder.ts`，将真实 project、messages、nodes、artifacts 编译为 `ContextPackage`，并接入 `conversation-turn-service.ts` 的主控模型调用。
- 新增 `NodeContractRegistry` 与 `config\node-contracts\*.json`，形成文件化节点契约入口。

### 2.2 HumanGate / PlanGuard

- 新增 `human-gate.ts`，统一 actionId 格式与精确确认。
- 新增 `plan-guard.ts`，对需要确认的能力强制校验：服务端期望 actionId、当前教师确认 actionId、能力 ID 必须一致。
- 主对话链路将 pending plan actionId 持久化到 assistant message metadata；queued turn 从 teacher message metadata 读取 `confirmedActionId`。

### 2.3 route-level generation gate

- 新增 `route-level-generation-gate.ts`。
- `coze-ppt`、`image`、`video` 三条真实生成 route 在创建 job / save artifact 前执行门禁。
- `approveArtifact(...)` 会给可真实生成的已确认源产物写入 `structuredContent.routeGenerationActions`。
- 前端 mapper、真实生成按钮和 API client 已串通：从后端 actionId 到 POST body `confirmedActionId`。

### 2.4 队列与可靠性

- 新增 conversation turn queue，支持消息入队、幂等、串行 drain、失败保留、默认 executor。
- 修复 maxAttempts exhausted job 被返回给 executor 的风险：drain 跳过非 running job，并继续处理后续 queued job。
- 更新 SQLite 初始化脚本和 Prisma schema，支持 turn job 表。

### 2.5 真实素材节点修正

- 修复 image route：真实课堂视觉图保存为 `image_prompts`，不再覆盖源 `ppt_draft`。
- 外部生成产物均保持 `needs_review`，不自动 approve 上游或生成结果。

## 3. 验证记录

已通过以下验证：

```powershell
npx tsc --noEmit
```

结果：exit 0。

```powershell
npm run build
```

结果：Next.js 编译、TypeScript、静态页面生成均通过，exit 0。

```powershell
node --test tests/workbench-api.test.mjs tests/m47-composer-api-wiring.test.mjs tests/m60-video-workflow-contract.test.mjs
```

结果：28 tests passed，0 failed。

```powershell
npx vitest run tests/context-budget.test.ts tests/summary-validator.test.ts tests/session-compactor.test.ts tests/node-contract-registry.test.ts tests/plan-guard.test.ts tests/human-gate.test.ts tests/conversation-context-builder.test.ts tests/model-main-conversation-agent.test.ts tests/capability-registry.test.ts tests/capability-runner.test.ts --maxWorkers=1
```

结果：10 files passed，64 tests passed。

```powershell
npx prisma generate; node scripts/init-sqlite-schema.mjs; npx vitest run tests/route-level-generation-gate.test.ts tests/conversation-turn-service.test.ts src/server/workbench/__tests__/stage60-conversation-turn-queue.test.ts --maxWorkers=1
```

结果：3 files passed，38 tests passed。

## 4. 残余风险与后续项

- `ContextPackage` 已进入主控模型调用，但 `SessionContextSnapshot` / `ContextBuildLog` 尚未持久化，M62 需补齐。
- `NodeContractRegistry` 已有基础读取和测试，但尚未成为所有 artifact save / quality gate 的硬约束。
- `HumanGate actionId` 仍是确定性字符串。当前在本地项目访问控制内可接受；未来公网多用户环境应升级为不可猜 nonce + 一次性消费。
- `asset_image_generate` 仍被标记为真实外部能力且不保存占位成果；M62 应用 ToolObservation 和 capability availability 处理不可用能力，而不是继续扩展硬编码分支。
- route-level generation action 依赖 artifact approval 写入；旧数据若没有 `routeGenerationActions`，直接真实生成会被 403，需要后续迁移或重新确认源产物。

## 5. 提交边界建议

纳入：M60/M61 相关代码、测试、契约配置和架构/阶段文档。

排除：

- `.playwright-cli\**`
- `*.bak`
- `API台账系统\**`
- `.env*`
- `docs\qa-audits\**\*.mp4`

提交前必须再次确认没有密钥、token、账号、个人敏感信息进入 staged diff。
