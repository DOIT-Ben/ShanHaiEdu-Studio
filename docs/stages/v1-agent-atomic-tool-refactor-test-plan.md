# V1.0 Main Agent唯一编排与原子Tool控制面整改测试计划

日期：2026-07-17

状态：REMEDIATION IN PROGRESS / GO GATE RED

## 1. 测试原则

- 8项P1和7项P2全部进入Go/No-Go，不再只检查旧P1-01至P1-06。
- 每个缺陷先运行会失败的特征测试，再做最小实现和直接依赖回归。
- 断言控制权、持久事实、身份绑定和教师可见行为，不断言固定Tool顺序。
- Vitest使用显式隔离SQLite、单worker；Node/Playwright按仓库脚本或最多2 workers运行。
- fixture只证明contract或executor；真实模型、产品E2E和release分别取证。
- 不调用真实图片、视频、PPTX、ZIP或整包Provider，不运行390px。

## 2. 问题级验收矩阵

| ID | 必须通过的负向与正向断言 |
|---|---|
| RMD-P1-01 | native HumanGate先持久化PendingDecision/actionId/checkpoint；教师确认绑定同一action并恢复同一task；无action时不得伪恢复 |
| RMD-P1-02 | 在长Tool运行期间提交暂停/取消/改道，控制事实先落库；暂停保持task/digest/epoch并保存恢复点，取消/实质改道提升epoch/revision；旧Envelope结果只能审计、不能提升 |
| RMD-P1-03 | 教案、PPT大纲、视频锚点/脚本可在TaskBrief已充分时直接成为首个Tool；Registry不要求固定`requirement_spec`前置 |
| RMD-P1-04 | PPT大纲、逐页设计、视频分镜、资产说明等局部requested output各自可完成；不得自动要求PPTX、成片、图片或整包 |
| RMD-P1-05 | N次Provider子调用消耗N次预算并各有submission/invocation/result事实；中途失败保留已提交事实且恢复不重复调用 |
| RMD-P1-06 | quick reply原样确认可绑定当前action；编辑后必须移除旧`confirmedActionId`并作为普通教师输入处理 |
| RMD-P1-07 | 同turn自然文本delta、Tool started、Observation、Artifact和终态按真实序列稳定投影，刷新后顺序一致 |
| RMD-P1-08 | Tool失败与最终run失败按事件/原因身份去重；旧Tool失败不能遮蔽不同reasonCode的终态失败 |
| RMD-P2-01 | 普通等待只显示中性回复文案和真实耗时；未持久化前不得显示“正在理解/选择/组织”等动作 |
| RMD-P2-02 | 当前turn仍等待时，历史completed projection不能隐藏等待；当前turn出现真实活动或终态后才切换 |
| RMD-P2-03 | Dispatcher blocked返回的Observation ID等于持久化ID，并能从存储读取相同reasonCode和invocation绑定 |
| RMD-P2-04 | 失败Tool的ValidationReport先持久化，返回模型的digest可反查同一报告；提交失败时不得返回悬空digest |
| RMD-P2-05 | invocation开始前比较持久化IntentGrant/预算版本/范围；旧Envelope在grant变更后调用Executor和Provider均为0 |
| RMD-P2-06 | Provider未配置的native intake形成教师安全、可恢复的结构化失败和唯一恢复入口，不抛裸内部错误 |
| RMD-P2-07 | health检查当前schema依赖的关键表、列和控制面表；缺列/表返回non-ready，完整隔离库返回ready |

## 3. 阶段回归

### 阶段A：控制与授权

状态：**GO（局部）**。红证据为首次定向运行`58/65`、7项失败；实现中间态为`61/65`、4项失败。绿证据使用隔离库`.tmp/stage-a-precommit-3.db`、单worker，于2026-07-17执行：

- 11个阶段A及直接依赖Vitest文件：`167/167`。
- assistant-ui与composer Node合同：`11/11`。
- `npx tsc --noEmit`：通过。
- `git diff --check`：通过（仅Git行尾转换提示）。

问题级证据：RMD-P1-01覆盖PendingDecision/actionId、blocked invocation、语义快照与授权checkpoint重绑定；RMD-P1-02覆盖pause/cancel/redirect事务抢先、epoch/revision推进及真实在途迟到结果零提升；RMD-P1-06覆盖原样确认、编辑、action不匹配、输入/附件/引用/项目变化；RMD-P2-05覆盖持久grant不一致时Tool router、executor和Provider路径不进入。

- HumanGate checkpoint/PendingDecision/action恢复集成测试。
- 消息入口在in-flight turn期间的抢先控制测试。
- quick reply编辑合同测试。
- 持久化IntentGrant与Envelope不一致的Gateway负向测试。
- 直接依赖：控制面持久化、turn queue、双用户隔离、迟到结果。

### 阶段B：任务语义与Tool边界

状态：**GO（局部）**。红证据为conversation定向运行`61/64`，失败3项；修复确认语义和暂停恢复状态合同后，conversation + ToolRouter为`86/86`。阶段B合并绿证据使用隔离库`.tmp/stage-b-precommit-20260717.db`、单worker，于2026-07-17执行：

- 14个阶段B及直接依赖Vitest文件：`284/284`。
- TaskBrief/语义快照/conversation/Tool暴露补充回归：`107/107`。
- 自然语言确认与纯图片范围补充回归：`99/99`。
- `npx tsc --noEmit`：通过。
- `git diff --check`：通过（仅Git行尾转换提示）。

- Tool Registry无固定DAG资格测试。
- TaskBrief局部output schema和完成合同表驱动测试。
- Main Agent只完成请求范围的Tool轨迹测试。
- Provider子调用预算、submission_unknown和部分失败恢复测试。
- 直接依赖：artifact真实性、package边界、费用披露。

### 阶段C：Observation与消息投影

状态：**GO（局部）**。阶段C合并绿证据使用隔离库`.tmp/stage-c-precommit-final-2-20260717.db`、单worker，于2026-07-17执行：

- 9个阶段C及直接依赖Vitest文件：`141/141`。
- assistant-ui event route与M58 Node合同：`5/5`。
- 后端Observation/ValidationReport身份定向：`46/46`。
- `npx tsc --noEmit`：通过。
- `git diff --check`：通过（仅Git行尾转换提示）。

- Dispatcher/ValidationReport身份原子性测试。
- stream projection与assistant-ui adapter顺序测试。
- 等待态生命周期与固定伪文案静态合同。
- 多原因失败去重和唯一恢复入口测试。
- 直接依赖：MessagePart持久化、event cursor、刷新恢复。

### 阶段D：健康与恢复

- Provider未配置的route/service集成测试。
- 使用完整schema和缺表/缺列schema的health readiness测试。
- 直接依赖：startup recovery与生产preflight。

### 阶段E：最终验证

按顺序执行：

1. Node合同全量。
2. 显式隔离SQLite、单worker Vitest全量。
3. `npx tsc --noEmit`。
4. `npm run lint`（仅当脚本存在）。
5. `npm run build`。
6. `git diff --check`、敏感信息和残留worker检查。
7. 从当前HEAD启动本地服务，验证health和桌面核心流程。

## 4. 最终Go/No-Go

Go必须同时满足：

- RMD-P1-01至RMD-P1-08全部有红绿证据。
- RMD-P2-01至RMD-P2-07全部有红绿证据。
- 只有Main Agent拥有业务编排权，Registry无固定DAG，局部TaskBrief不扩张范围。
- HumanGate、抢先控制、持久授权复核和旧结果隔离通过。
- 每个Provider子调用按真实次数计预算并持久化。
- Observation、ValidationReport、Artifact和事件身份一致且原子提交。
- 同turn顺序、等待态、失败去重和刷新恢复通过。
- Provider未配置安全失败与schema readiness通过。
- 全量测试、TypeScript、适用Lint、生产构建和diff检查通过。
- 当前HEAD桌面核心流程通过；没有把fixture上推为真实产品或release证据。

任一项缺失均为No-Go。No-Go必须保留具体ID、责任层和恢复入口，不恢复旧方案，不进入V1-9。
