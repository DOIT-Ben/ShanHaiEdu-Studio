# ShanHaiEdu V1-1 编排归因审计收尾

更新时间：2026-07-13

状态：`done`

## 1. 本阶段完成内容

- 从教师消息入口追踪到Main Agent、Control Resolver、Guard、ToolRouter、Adapter、Observation、Artifact和Finish。
- 形成逐节点当前主体、目标主体、实现状态和职责差距矩阵。
- 明确外部Codex未进入产品请求运行时；当前代替Main Agent编排的是固定DeliveryPlan、规则Resolver和人工离线决策。
- 明确三个Agent Tool、同轮Replan、Video Critic、课程锚点硬门、逐镜头运行时和版本化最终包主链仍缺失。
- 冻结V1-2最小改动范围和测试入口。

详细证据：`docs\stages\local-real-v1-v1-1-orchestration-attribution-audit.md`。

## 2. 验收对照

| V1-1退出物 | 状态 | 证据 |
|---|---|---|
| 真实调用路径图 | 完成 | 审计第1、3节 |
| 决策归因矩阵 | 完成 | 审计第4节 |
| 外部Codex代做点清单 | 完成 | 审计第1、5、6节 |
| 缺失或重复职责清单 | 完成 | 审计第5、6节 |
| V1-2最小改动范围 | 完成 | 审计第8节 |
| 对应测试入口 | 完成 | 审计第9节 |

## 3. 新鲜验证

执行：

```text
npx vitest run tests/model-main-conversation-agent.test.ts tests/main-conversation-agent.test.ts tests/conversation-turn-service.test.ts tests/agent-world-state.test.ts tests/react-observation-replan.test.ts tests/tool-registry.test.ts tests/tool-router.test.ts tests/human-gate.test.ts tests/plan-guard.test.ts tests/quality-decision-engine.test.ts tests/video-production-contract.test.ts tests/agent-runtime/runtime-factory-native-tool-loop.test.ts
```

结果：12个测试文件通过，135/135项通过，失败数0。

`git diff --check`在文档落地后执行。

## 4. 未执行与边界

- 未调用真实图片、视频或PPT Provider。
- 未制作新交付包。
- 未修改产品代码。
- 未宣称Main Agent自主编排已完成。
- 现有`v1`与`v1.1.0-alpha`标签保持不动。

## 5. 下一阶段

进入V1-2 Tool与Agent Tool注册。先写阶段实施与测试计划，再做最小代码切片；V1-2不得提前把固定DeliveryPlan改造、生成强度UI或真实Provider E2E混入同一阶段。
