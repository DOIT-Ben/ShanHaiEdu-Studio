# V1-9F Main Agent 运行诊断与恢复测试计划

更新时间：2026-07-13

## 1. 专项用例

| 编号 | 场景 | 预期 |
|---|---|---|
| V1-9F-01 | direct response adapter failed | 不进入 JSON parse，记录 `direct_response/adapter_failed` |
| V1-9F-02 | ReAct 首请求 adapter failed | 结果保留脱敏 diagnostic，记录 `agent_tool_loop/adapter_failed` |
| V1-9F-03 | ReAct continuation adapter failed | 保留已使用轮次与同一失败原因，不伪装完成 |
| V1-9F-04 | adapter succeeded 但 output_text 为空 | 记录 `empty_output`，教师端仍为通用失败 |
| V1-9F-05 | diagnostics 包含 URL、Bearer、路径或密钥形态 | 日志事件中全部脱敏且长度受限 |
| V1-9F-06 | 正常 Main Agent 输出 | 既有计划、ReAct、HumanGate行为不变 |
| V1-9F-07 | Critic canonical locator 含九类 `oneOf` | 内部合同保持九类；模型可见调用投影为单一 artifact locator，不向 Provider 发送 `oneOf` |
| V1-9F-08 | 同一真实教师需求修复后重试 | TurnJob成功，持久化 OpenAI Main Agent计划、actionId 与合法 HumanGate；媒体 Provider调用为0 |

## 2. 验证命令

```powershell
$env:VITEST_MAX_WORKERS='1'
npx vitest run tests/model-main-conversation-agent.test.ts tests/agent-runtime/main-agent-controlled-react-loop.test.ts tests/gpt-protocol-adapter.test.ts tests/agent-tools/agent-tool-registry.test.ts --maxWorkers=1
npx tsc --noEmit
```

专项通过后重启当前 `3110` 产品实例，从同一教师 UI 项目重试真实请求并只读取服务端脱敏诊断。
