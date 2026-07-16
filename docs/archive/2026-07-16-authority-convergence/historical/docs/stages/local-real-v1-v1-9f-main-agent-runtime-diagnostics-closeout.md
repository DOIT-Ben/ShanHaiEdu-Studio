# V1-9F Main Agent 运行诊断与恢复收尾

更新时间：2026-07-13

## 1. 结论

V1-9F 已关闭真实教师需求在 Main Agent 首轮理解阶段统一失败的问题。修复后，产品自己的 OpenAI Main Agent 在真实 UI 中形成 19 步完整交付计划，并持久化待确认的 `requirement_spec` HumanGate；外部 Codex 没有代替 Main Agent 规划、批准内容或调用媒体 Tool。

## 2. 根因

服务端脱敏诊断稳定指向 `agent_tool_loop / adapter_failed / 502 Upstream request failed`。递增真实协议探测结果：

- Responses、reasoning、严格 JSON Schema 与简单 function tool 组合通过。
- `ppt_director_plan_or_repair` 单工具通过。
- `video_director_plan_or_repair` 单工具通过。
- `delivery_critic_review` 单工具稳定返回 502。
- 将 Critic 输入中的九分支 locator `oneOf` 临时替换为 artifact locator 后通过。

因此责任层是当前 OpenAI-compatible Provider 对 function-tool 复杂 `oneOf` 输入 Schema 的兼容缺陷，不是 Main Agent 模型、上下文体量、ReAct continuation 或业务 Tool 执行。

## 3. 修复

- ReAct 结果保留 Adapter 已脱敏诊断，Main Agent按 `direct_response`、`agent_tool_loop`、`output_parse` 分类输出服务端结构化事件。
- direct response显式阻断 adapter failure 与空输出，教师端继续只显示安全通用文案。
- OpenAI Tool transport 将 `delivery_critic.review` 的模型可见目标收敛为一个真实 artifact locator。
- 内部 canonical Critic 输入与输出仍保留 artifact、input、tool、page、asset、shot、track、timeline、frame-range 九类 locator；Router校验与细粒度返修能力未降级。

## 4. 真实证据

真实本地项目：`cmriug8jg000xboez28i1azl5`。

- 修复前 TurnJob：`failed`，Agent Tool与媒体 Provider调用均为0。
- 修复后 TurnJob：`succeeded`。
- 最新助手消息：`runtimeKind=openai`。
- 持久化 pending plan：`status=pending`，`capabilityId=requirement_spec`，`requiresConfirmation=true`。
- DeliveryPlan：19步，当前步骤 `requirement_spec`，状态 `awaiting_confirmation`，服务端 actionId存在。
- 教师可见计划保留12页可编辑PPT、30-60秒完整导入视频、独立创意短片、结尾唯一最小课程回接和不提前解释答案等约束。

## 5. 验证

- TypeScript：`npx tsc --noEmit` 通过。
- 专项测试：27/27 通过。
- 全量测试：Node 259/259、Vitest 837/837，`npm test` exit 0。
- 构建：`npm run build` exit 0，13/13 页面完成；保留5条既有Turbopack动态文件匹配警告。
- 真实浏览器：通过，计划已显示并由 snapshot API证明持久化。

## 6. 下一步与边界

V1-9F 到此结束。下一步从当前 `requirement_spec` HumanGate继续产品内真实E2E；真实教师确认后，由产品 Main Agent自主推进 Agent Tool、业务 Tool、Critic、HumanGate、Quality Gate和Replan。外部 Codex继续只做工程证据审计与最终成包后的黑盒审核，不替产品选择PPT样张、视频创意、课程锚点或返修范围。
