# 产品优先深度重构计划

更新时间：2026-07-19

## 1. 目标

把当前“旧实现仍在、靠拒绝门防止复活”的状态改成只有一套生产控制面，并把已经登记的复杂度、源码合同、Lint和构建追踪债务实际清零。

成功后的代码必须直接服务教师主链路：教师提交需求，Main Agent形成任务边界，自主选择原子Tool，结果原子持久化并投影为文本、Tool、Observation和Artifact；兼容层、Runner、旧计划和deterministic路径均不能再次决定下一步。

## 2. 当前事实

已经实现：

- assistant-ui是生产对话入口。
- TaskBrief、IntentGrant、IntentEpoch、ExecutionEnvelope、ToolInvocation、ValidationReport、Observation、Artifact和事件已经存在。
- native function-call已承担主控制循环；局部真实文本回合曾成功保持单Tool范围。
- SQLite、Provider ledger、验证manifest和release receipt具有基础合同。

确认存在的问题：

- `WorkflowNode`、`toolPlan`、`deliveryPlan`和deterministic runtime仍存在于生产源码，当前只是失去部分执行权，没有真正删除。
- Tool终态允许Observation、Event、Invocation和审计结果互相矛盾；权威摘要也未完整重算该关系。
- succeeded被错误等同于必须产生Artifact，合法的Observation-only成功会被误判。
- 部分项目写入口可以绕过统一actor/CSRF/orchestration wrapper，入口门只检查“出现过调用”，不能证明最外层统一包裹。
- 31个复杂度债务文件和22个源码字符串合同债务文件仍是活动事实；Lint与构建动态追踪warning已清零并锁入门禁。
- `conversation-turn-service.ts`、`main-agent-tool-loop-config.ts`、workbench repository等巨型模块同时承载多项职责。
- 当前状态文档保存了大量阶段流水账，掩盖当前事实。

尚未实现：

- 真实Provider连续多轮稳定性、唯一V1-9产品全链路、教师签收和release。
- 多实例数据库部署能力；SQLite仍只支持本地或单实例。
- 本轮不补造缺失的PPTX、图片、视频或整包交付样本。

已经废弃：

- 固定宏节点推进、外层计划执行下一Tool、生产deterministic draft/fallback。
- 用baseline登记债务代替偿还债务。
- 用Gate、manifest或文档齐全上推产品完成。

## 3. 唯一修复主线

### 阶段A：合同正确性

目标：先堵住会产生错误业务事实的出口。

修改范围：

- 统一项目写操作registry、route wrapper和AST门。
- 建立Observation、Event、Invocation、authority audit的唯一终态矩阵。
- 为需要Artifact与Observation-only结果建立显式`resultMode`或等价服务端事实。
- authority summary独立重算身份、顺序、状态和结果绑定。

验收：行为负例覆盖绕行、状态错绑、重复终态、错误Artifact要求和摘要篡改；定向测试、TypeScript和开发门通过。

### 阶段B：删除竞争控制面

目标：生产源码只剩Main Agent原子Tool控制循环。

修改范围：

- 迁移并删除`WorkflowNode`、`toolPlan`、`deliveryPlan`消费者。
- 删除生产deterministic runtime及其fallback出口。
- 保留仍有产品价值的数据投影，但改为从Task/Invocation事实派生，不能执行下一步。
- 删除只证明旧行为的测试；保留并改写为新合同行为测试。

验收：`src`中旧控制面符号和生产deterministic入口为0；没有第二个Tool选择器；全量合同测试通过。

### 阶段C：拆分两个核心巨型模块

目标：让turn协调和Tool执行各自只做一件事。

`conversation-turn-service.ts`拆为：输入与任务边界、turn协调、流式事件投影、持久化提交、失败恢复。

`main-agent-tool-loop-config.ts`拆为：Tool目录、参数归一化、ExecutionEnvelope准备、单Tool执行、结果归一化、观察与重试策略。

验收：原文件删除或降到500行以内；所有新函数150行以内；公开接口保持最小且行为测试不依赖源码字符串。

### 阶段D：清零剩余工程债务

目标：31项复杂度债务和22项源码字符串债务全部归零。

修改范围：按职责拆分其余前端、workbench、skills、tool adapters和共享合同；清理无用变量、未处理Promise和不稳定依赖；把动态文件追踪改为显式受限根与静态入口。

验收：

- `complexity.baseline=[]`，实际债务为0。
- `sourceStringContracts.baseline=[]`，测试只验证行为、接口、schema或运行时事实。
- ESLint为0 error、0 warning，政策`maxWarnings=0`。
- 生产构建无动态追踪warning。

### 阶段E：最终产品验证

目标：证明重构没有破坏教师主链路。

验收：全量Node/Vitest、TypeScript、Lint、生产构建、development gate、SHA manifest、本地启动、health和桌面浏览器核心流程全部在最终HEAD重新执行。

真实Provider仍是独立阻塞：没有授权就保持0请求，不能用离线验证冒充连续性通过。

## 4. 删除原则

- 先迁移消费者，再删除旧实现；同一切片结束时不能留下两个可执行入口。
- 仅为兼容外部持久数据保留的解析器必须只读、不可执行，并明确迁移删除条件。
- 新模块按业务职责命名，不用`v2`、`final`、`latest`或`new`制造竞争版本。
- 拆分不得改变Provider选择、费用、真实产物晋升或教师授权语义。
- 总体代码行数应下降；新增文件只承接从巨型模块迁出的稳定职责。

## 5. 提交边界

1. 文档口径、阶段合同和Provider离线重构门。
2. 合同正确性与统一写入口。
3. 旧控制面和deterministic生产路径删除。
4. 两个核心巨型模块拆分。
5. 其余复杂度、源码合同、Lint和构建追踪清零。
6. 最终验证与状态收口。

每个提交必须包含对应行为测试和实际验证结果；失败不得通过放宽阈值、增加fallback或删除有效测试处理。
