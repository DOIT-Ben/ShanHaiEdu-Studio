# ADR：按风险治理复杂度债务

## 状态

accepted

## 日期

2026-07-20

## 背景

项目复杂度门以单文件约500行、单函数约150行为检测阈值，并将既有超限项登记到baseline。历史阶段计划进一步把`complexity.baseline=[]`作为最终目标，容易把“需要评估的复杂度信号”误读为“所有文件都必须拆分”。

仓库中存在几类合理的大文件：稳定的静态Skill注册表、同一资源的路由、协议适配器和内聚的UI组件。机械拆分这些文件会增加转发层和跳转成本，却不一定降低故障风险。

## 决策

1. 复杂度阈值是评估触发器，不是自动拆分命令。
2. 只有同时满足职责混杂、变更风险高、测试边界不清或存在重复控制权等条件时，才把文件列入“应拆”队列。
3. 稳定且内聚的大文件可以保留，但必须在阶段记录中说明保留理由、当前风险和未来触发条件。
4. 复杂度门继续执行单调ratchet：不得新增债务、扩大既有债务、提高阈值或扩大排除目录；实际修改文件时应收缩其债务或证明没有新增风险。
5. 阶段完成不再以所有复杂度baseline为空作为唯一条件，而以高风险职责完成治理、保留项完成登记、行为合同和构建门通过为准。

## 当前分类

### 应拆

- 当前没有尚未治理的“应拆”项；后续只在职责重新混杂或出现第二控制权时新增。

### 已治理

- `src/server/skills/business-tool-skill-runtime.ts`（保留公开门面、配置运行时和预检入口；执行、结果校验和辅助合同职责已迁出）
- `src/server/tools/agent-tool-router.ts`（保留通用路由；视频Director/Critic结果策略已迁出）
- `src/server/tools/package-tool-adapter.ts`（保留公开分发门面；PPT、视频和最终包职责已迁入独立模块）
- `src/server/tools/provider-tool-adapter.ts`（保留Provider调用边界；成功投影和失败分类已迁出）
- `src/server/feedback/service.ts`（保留反馈提交、管理查询和公开工厂；后台reconciliation已迁入独立模块）
- `src/server/conversation/main-agent-controlled-react-loop.ts`（保留唯一ReAct状态机入口；合同、完成修复、Tool回合和checkpoint/telemetry辅助已迁出）
- `src/server/agent-runtime/openai-runtime.ts`（保留Runtime门面和native Tool loop边界；请求、输出、schema、错误和结果映射已迁出）
- `src/hooks/useWorkbenchController.ts`（保留公开组合入口；项目快照、项目动作、composer提交和产物动作已迁入独立职责模块）
- `src/components/conversation/PromptComposer.tsx`（保留唯一输入面；附件读取与异步取消生命周期已迁入`useComposerAttachments.ts`）
- `src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/video/route.ts`（D13保留HTTP认证、下载和project lease边界；视频单镜头执行、输入校验和原子提交迁入同资源helper，并补齐`shotIds`/GenerationJob `unitId`血缘）

### 修改时再评估

- `src/server/conversation/control-plane-store.ts`
- `src/server/conversation/external-audit-evidence-ingress.ts`
- `src/server/conversation/model-main-conversation-agent.ts`
- `src/server/feedback/repository.ts`
- `src/hooks/useFeedbackController.ts`

### 可保留，除非职责继续增长

- `src/components/feedback/FeedbackDialog.tsx`
- `src/components/layout/MediaWorkbench.tsx`
- `src/components/layout/ProjectListItem.tsx`
- `src/server/tools/tool-router.ts`（唯一Tool前置校验、适配器分发和后置校验边界；只有出现第二编排权、重复校验或适配器私有语义回流时才拆分）
- `src/server/skills/skill-registry.ts`（稳定的版本化Skill注册表；只有注册、完整性校验和投影职责继续增长或变更边界模糊时才拆分）
- `src/server/skills/business-tool-skill-bindings.ts`（稳定的业务Tool绑定映射；只有绑定规则与运行时执行职责重新混杂时才拆分）
- `src/server/skills/business-tool-skill-output-contract.ts`（稳定的正式输出协议映射；只有协议定义与校验执行再次混杂时才拆分）

## 后果

- 复杂度数字不再单独代表“项目不可维护程度”。
- 高风险核心模块获得明确治理顺序，稳定大文件不被为了达标而碎片化。
- baseline仍会存在，但每个保留项必须有事实理由，不能用baseline掩盖职责混杂。
- 未来新增功能若触碰保留项，必须重新评估是否达到拆分触发条件。
- D13发现视频route原有成功测试mock掉了Tool Router，未覆盖Provider工具要求的单镜头`shotIds`和GenerationJob `unitId`绑定；现已把HTTP边界与视频执行协调分开，并在route合同中失败关闭缺失或冲突镜头输入。当前Artifact直发按钮仅在服务端提供明确`shotId`时展示，避免暴露必然失败的动作；未来若引入多镜头选择、VideoShot状态推进或第二条视频提交/恢复路径，必须重新评估该helper与route边界。

## 替代方案

### 强制清空baseline

拒绝。它容易把静态数据、协议映射和内聚组件拆成低价值碎片，并把复杂度门从风险控制变成数字竞赛。

### 放宽阈值或删除复杂度门

拒绝。阈值仍然是有效的早期预警，删除门禁会允许新的职责堆积和既有文件继续增长。
