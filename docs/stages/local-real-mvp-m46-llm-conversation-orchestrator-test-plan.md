# 本地真实 MVP M46 真实 LLM 对话编排器测试计划

日期：2026-07-08

## 单元测试

新增 `tests/conversation-orchestrator.test.ts`：

- fake OpenAI 对 “你好” 返回 `clarify`，断言不生成 artifact。
- fake OpenAI 对 “五年级百分数公开课，生成教案和 PPT 大纲” 返回 `start_requirement`，断言启动需求规格。
- fake OpenAI 抛出包含敏感词的错误，断言 fallback 回复不泄露 provider、key、baseURL、debug。
- request payload 不包含凭证值，只包含用户消息、项目上下文和 JSON schema。
- `pickOpenAICompatibleConfig` 支持 primary、third、fallback ledger channel。

## 路由合同测试

扩展 `src/server/workbench/__tests__/stage7-mainline-contract.test.ts`：

- greeting 路由继续只保存 assistant 澄清，不生成 artifact。
- 明确备课需求仍生成 `requirement_spec`。
- 响应 envelope 保持 `message`、`assistantMessage`、`artifact`。

## 集中验收命令

```powershell
npx vitest run tests/conversation-orchestrator.test.ts --maxWorkers=1
npx vitest run src/server/workbench/__tests__/stage7-mainline-contract.test.ts --maxWorkers=1
node --test tests/*.test.mjs
npm test
npm run build
node scripts/openai-smoke.mjs
```

说明：`node scripts/openai-smoke.mjs` 只有在本机环境已配置真实 OpenAI-compatible 凭证时才要求成功；无凭证时不得把 deterministic fallback 说成真实模型可用。

## 浏览器/API 验收

- 本地服务打开工作台。
- 新建项目。
- 输入“你好”：页面只出现自然回复，不出现需求规格产物。
- 输入明确备课需求：页面进入需求规格生成，右侧出现待审产物。
- 刷新后消息和产物仍在。

## 审查清单

- 教师可见文本不出现 API、provider、schema、debug、local path、密钥。
- OpenAI SDK 只在服务端使用。
- fallback 结构清晰，不能冒充真实模型。
- 不扩大数据库 schema。
