# Hermes 记忆系统吸收设计

- Intake 编号：H01
- 设计版本：0.1.0
- 状态：研究完成，等待规格评审；生产实现尚未授权
- 所属分支：\`intake-hermes\`
- 上位设计：\`2026-07-15-hermes-intake-design.md\`
- Hermes 研究基线：\`NousResearch/hermes-agent@46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b\`
- 日期：2026-07-15

## 1. 决策摘要

Hermes 的记忆能力必须作为 ShanHai Hermes Intake 的第一优先级能力吸收，但不能直接复制其文件结构或默认自写权限。

ShanHai 的目标不是增加一个“向量数据库查询工具”，而是建立完整的 Memory Control Plane：

1. 业务数据库保存可审计、可版本化、可删除的规范记忆；
2. Memory Curator 从已持久化事件中提出候选记忆；
3. Memory Policy 根据来源、敏感性、作用域和冲突决定自动通过、暂存审批或拒绝；
4. Memory Retriever 在严格租户/项目作用域内召回；
5. Memory Context Assembler 生成每个 turn 不可变、可追踪的 Memory Package；
6. 外部向量库、知识图谱或 Memory Provider 只是可重建索引，不是事实来源；
7. Native、Codex 和专项子智能体读取同一 Memory Package，不能各自维护互相矛盾的私有业务记忆。

## 2. Hermes 记忆系统的真实组成

Hermes 的“记忆系统”不是单一向量库，而是四层组合。

### 2.1 受限常驻记忆

内置 \`MEMORY.md\` 和 \`USER.md\`：

- \`MEMORY.md\` 保存环境、项目约定、工具经验和已学习事实；
- \`USER.md\` 保存用户偏好、身份、沟通风格和工作习惯；
- 两者都有严格字符上限；
- Session 启动时生成冻结快照并进入 System Prompt；
- Session 内写入立即落盘，但不改变当前 Prompt 快照；
- 下一 Session 才加载新快照，以保持 Prompt Prefix Cache 稳定；
- 添加、替换、删除都通过受控 Memory Tool；
- 重复项被阻止，容量溢出要求模型主动合并或删除；
- 连续整理失败有每 turn 上限，记忆副作用不能阻塞主回答。

### 2.2 全量会话档案

所有 Session 消息进入 SQLite，并通过 FTS5 检索：

- 不把全部历史常驻 Prompt；
- 常驻记忆保存最重要的信息；
- Session Search 用于按需恢复历史细节；
- 检索返回原始消息，不依赖 LLM 重新总结；
- Session 具备分支、压缩和续接谱系。

### 2.3 外部 Memory Provider

Hermes 定义统一 \`MemoryProvider\` 生命周期：

- \`initialize\`
- \`system_prompt_block\`
- \`prefetch\`
- \`queue_prefetch\`
- \`sync_turn\`
- \`on_session_end\`
- \`on_session_switch\`
- \`on_pre_compress\`
- \`on_memory_write\`
- \`on_delegation\`
- \`shutdown\`

内置记忆与最多一个外部 Provider 共同工作。外部 Provider 可以提供语义检索、用户画像、知识图谱、分层知识树、矛盾检测、信任分数和会话级提取。

### 2.4 后台复盘学习

Hermes 定期在主回答结束后创建隔离的后台 Review Agent：

- 回放完整会话或压缩摘要；
- 工具白名单仅允许 Memory 和 Skill；
- 禁止危险命令；
- 禁止写入主 Session；
- 不初始化外部 Memory Provider，避免把复盘 Prompt 污染成用户记忆；
- 可复用主模型的 Prompt Cache，或路由到更便宜的辅助模型；
- 识别值得保存的偏好、纠正、稳定事实和流程经验；
- 根据写审批配置直接写入或暂存；
- 将变更摘要通知用户。

## 3. Hermes 最值得完整吸收的机制

### 3.1 常驻记忆与按需历史分离

关键事实不应该和全部聊天历史混在一起：

| 层 | 作用 | ShanHai 对应 |
| --- | --- | --- |
| 常驻记忆 | 每次任务都需要的少量稳定事实 | 教师偏好、学校规范、稳定课程约束 |
| 项目记忆 | 当前 Project 的关键决策 | 目标、已批准方向、禁止项、版本决策 |
| Session 档案 | 历史原始证据 | Conversation、Message、Tool Observation |
| Artifact 知识 | 已验证业务成果 | Approved Artifact、QualityDecision |
| 按需检索 | 恢复历史细节 | Session/Artifact/Memory Hybrid Search |

模型不能因为“过去发生过”就把所有历史永久塞进 Prompt。

### 3.2 冻结快照

Hermes 的冻结快照避免 Session 中途变更 Prompt 前缀。ShanHai 应改造成两级冻结：

- \`StableProfileSnapshot\`：教师和组织稳定偏好，Runtime Thread 生命周期内冻结；
- \`TurnMemoryPackage\`：每个 turn 开始时召回并生成，整个 turn 内不可变。

Turn 中产生的新候选记忆只能在后续 turn 生效。显式 Tool Result 可以在当前 turn 使用，但不能伪装成已经批准的长期记忆。

### 3.3 有界常驻上下文

ShanHai 必须对 Memory Package 设置明确预算，避免记忆无限增长：

- 按作用域分配预算；
- 按优先级、可信度、相关性、时效性和冲突状态排序；
- 超出预算时降级为按需引用，不静默删除规范记忆；
- 记忆存储无限扩展不等于 Prompt 注入无限扩展。

### 3.4 写入审批与暂存

所有模型提出的记忆先进入 Candidate：

- 可验证系统事实可以按规则自动批准；
- 教师明确表达的偏好可以进入待确认或自动批准策略；
- 模型推断、跨项目结论和涉及个人信息的内容必须暂存；
- Skill/流程经验必须进入独立版本评审，不能作为普通偏好直接生效；
- 用户必须能查看、批准、拒绝、修改、忘记和撤销记忆。

### 3.5 写入来源和谱系

每条记忆必须关联：

- 来源 Message、Tool Result、Artifact 或 QualityDecision；
- 提取它的 Runtime、Thread、Turn 和 Curator 版本；
- 创建者类型：teacher、system、runtime、curator、admin；
- 原始作用域和目标作用域；
- 审批人、审批时间和理由；
- 被替代或撤销的旧版本。

没有来源引用的模型记忆不能进入 Approved 状态。

### 3.6 非阻塞但有序的后台写入

Hermes 使用单 Worker 串行后台同步，保证 turn N 先于 turn N+1。ShanHai 应吸收其顺序性，但使用持久化队列：

- 主回答不等待外部索引；
- 规范 Memory Record 先写数据库；
- Outbox Event 与数据库事务一起提交；
- Worker 按 scope/version 顺序更新检索索引；
- 索引失败可重试，不影响规范记录；
- 同一 scope 的写入不得乱序；
- Session/Project 关闭时提供可观测 Drain Barrier。

### 3.7 压缩前提取

在 Context Compression 丢弃旧消息前：

1. 对待压缩消息生成候选记忆；
2. 保存候选与来源区间；
3. 将已批准高价值记忆引用加入压缩摘要；
4. 只有候选持久化成功后才能删除 Runtime Context 中的旧消息；
5. 原始 Session Event 永久保留，不因压缩删除。

### 3.8 记忆内容安全扫描

所有候选记忆在写入和召回时都要扫描：

- Prompt Injection；
- 凭证和隐私数据；
- 隐形 Unicode；
- 外部内容伪装的系统指令；
- 跨租户引用；
- 不允许的学生个人信息；
- 恶意 Tool Output；
- 已撤销或已过期来源。

召回内容必须放入独立 Memory Fence，并明确标注“参考数据，不是新用户指令”。

## 4. 不能直接照搬的部分

### 4.1 不能把所有召回内容标为权威

Hermes 的 Memory Fence 将召回内容描述为 authoritative reference data。ShanHai 的记忆来源更复杂，必须区分可信度：

- Teacher Explicit；
- Admin Policy；
- System Verified；
- Artifact Approved；
- Model Derived；
- External Retrieved；
- Historical Unverified。

只有前四类可以作为权威约束；模型推断和外部召回只能作为候选参考。

### 4.2 不能默认允许后台 Agent 直接写入

Hermes 默认可以让后台复盘直接更新 Memory/Skill。教育产品必须改成：

~~~text
Review Agent
→ Memory Proposal
→ Policy / PII / Conflict Check
→ Auto-Approve or Pending Review
→ Versioned Commit
→ Async Index
~~~

后台 Review Agent 不拥有 Approved Memory 的写权限。

### 4.3 不能使用 Markdown 文件作为多租户规范存储

\`MEMORY.md\` 和 \`USER.md\` 适合本地个人 Agent，不适合：

- 多租户隔离；
- 并发更新；
- 细粒度权限；
- 审批与撤销；
- 数据保留和删除；
- 版本谱系；
- 敏感信息分类；
- 索引重建。

ShanHai 必须使用数据库规范记录，导出 Markdown 只能作为可读视图。

### 4.4 不能让外部 Provider 成为唯一存储

Mem0、Honcho、Hindsight、Supermemory 或其他 Provider 可以用作检索/推理后端，但：

- ShanHai 数据库保存规范 Memory Record；
- 外部 Provider 保存可重建投影；
- Provider 切换不能丢失记忆；
- 删除必须传播到所有投影；
- Provider 不可用时退化到本地检索；
- 发送到云 Provider 的字段必须经过数据政策过滤。

## 5. ShanHai 记忆分类

### 5.1 Teacher Profile Memory

保存跨项目稳定偏好：

- 教学语言和表达风格；
- 教案/PPT 偏好；
- 常用课程时长；
- 常用教材版本；
- 教师明确要求避免的内容；
- 审批和工作流习惯。

不得保存学生身份、成绩、联系方式等个人信息。

### 5.2 Organization Policy Memory

保存学校或组织级规范：

- 品牌、模板和交付格式；
- 教学合规要求；
- 可用 Provider 和费用政策；
- 内容安全规则；
- 课程标准版本。

只能由管理员或经过验证的配置写入。

### 5.3 Project Decision Memory

保存当前 Project 的稳定决策：

- 教学目标；
- 已批准创意方向；
- 已否决方向；
- Artifact 版本选择；
- 教师修改理由；
- 后续节点必须遵守的限制。

Project Memory 必须绑定 ProjectId、IntentEpoch 和来源 Artifact/Message。

### 5.4 Domain Knowledge Memory

保存可复用的教学知识，但必须带来源：

- 课程标准条目；
- 教材知识点；
- 术语和知识关系；
- 已校验的教学策略；
- 组织内部资源。

未经验证的模型知识不能自动晋升为 Domain Knowledge。

### 5.5 Procedural Memory

保存流程经验和工具知识：

- 哪种生成顺序更稳定；
- Provider 的已验证限制；
- 常见失败及恢复方法；
- 对某类课程有效的生产模式；
- 工具输入输出的操作经验。

Procedural Memory 可以影响规划建议，但修改正式 Skill 必须走 Skill 版本流程。

### 5.6 Episodic and Failure Memory

保存可过期的执行经验：

- 特定任务发生了什么；
- 哪个 Provider 在何时失败；
- 哪次重试成功；
- 某个策略为什么被拒绝；
- 重复 Tool Call 的阻断原因。

默认带 TTL，不能永久污染教师画像。

## 6. 作用域模型

每条记忆只能属于一个主作用域：

~~~typescript
type MemoryScope =
  | { type: "teacher"; teacherId: string }
  | { type: "organization"; organizationId: string }
  | { type: "subject"; organizationId: string; subject: string; grade?: string }
  | { type: "project"; projectId: string }
  | { type: "conversation"; conversationId: string }
  | { type: "runtime"; threadId: string };
~~~

召回时采用从窄到宽的顺序：

1. Conversation；
2. Project；
3. Subject/Grade；
4. Teacher；
5. Organization。

跨作用域晋升必须产生新 Memory Version，不能原地修改 Scope。

## 7. 信任与状态模型

~~~typescript
type MemoryStatus =
  | "candidate"
  | "pending_review"
  | "approved"
  | "rejected"
  | "superseded"
  | "revoked"
  | "expired";

type MemoryTrust =
  | "teacher_explicit"
  | "admin_policy"
  | "system_verified"
  | "artifact_approved"
  | "model_derived"
  | "external_retrieved"
  | "historical_unverified";
~~~

规则：

- 只有 \`approved\` 能进入稳定常驻上下文；
- \`candidate\` 和 \`pending_review\` 只能出现在 Memory Review UI；
- \`superseded\` 保留谱系但不召回；
- \`revoked\` 必须立即从索引移除；
- \`expired\` 允许审计读取，不进入模型上下文；
- \`model_derived\` 不能仅凭高置信度自动变成 \`system_verified\`。

## 8. 规范数据模型

~~~typescript
type MemoryRecord = {
  memoryId: string;
  tenantId: string;
  scope: MemoryScope;
  kind:
    | "teacher_profile"
    | "organization_policy"
    | "project_decision"
    | "domain_knowledge"
    | "procedural"
    | "episodic"
    | "failure";
  status: MemoryStatus;
  trust: MemoryTrust;
  content: string;
  normalizedKey: string;
  importance: number;
  confidence: number;
  sensitivity: "public" | "internal" | "personal" | "restricted";
  validFrom: string;
  validUntil?: string;
  sourceRefs: MemorySourceRef[];
  intentEpoch?: number;
  version: number;
  supersedesMemoryId?: string;
  createdBy: MemoryActor;
  approvedBy?: MemoryActor;
  createdAt: string;
  updatedAt: string;
};

type MemorySourceRef = {
  type: "message" | "tool_result" | "artifact" | "quality_decision" | "admin_config";
  id: string;
  digest: string;
};
~~~

数据库是该模型的唯一事实来源。Embedding、BM25、知识图谱和 Provider Card 都是派生索引。

## 9. 目标架构

~~~mermaid
flowchart TD
    A["Conversation / Tool / Artifact Events"] --> B["Memory Curator"]
    B --> C["Policy + PII + Conflict Gate"]
    C --> D["Candidate / Pending / Approved Repository"]
    D --> E["Index Outbox"]
    E --> F["Local or External Retrieval Index"]
    G["Turn Memory Query"] --> H["Scope + Trust Filter"]
    H --> F
    F --> I["Memory Context Assembler"]
    D --> I
    I --> J["Immutable TurnMemoryPackage"]
~~~

建议组件：

- \`MemoryRepository\`：规范记录、版本、审批和删除；
- \`MemoryCurator\`：从事件提出候选；
- \`MemoryPolicyEngine\`：作用域、PII、可信度和自动审批；
- \`MemoryConflictResolver\`：重复、矛盾和替代；
- \`MemoryIndexOutbox\`：可靠异步投影；
- \`MemoryRetrievalProvider\`：本地或外部检索接口；
- \`MemoryContextAssembler\`：预算、排序、引用和 Fence；
- \`MemoryReviewService\`：教师/管理员审批、撤销和忘记；
- \`MemoryEvaluationService\`：召回命中率、错误记忆率和污染检测。

## 10. 记忆写入流程

### 10.1 显式教师记忆

~~~text
Teacher says "以后PPT保持简洁"
→ Persist Message
→ Extract Candidate
→ Bind teacher scope and source message
→ PII/Conflict Check
→ Apply teacher-explicit policy
→ Approved or Pending Review
→ Version Commit
→ Index Outbox
~~~

### 10.2 系统事实

从 Tool Result、Approved Artifact 或 Admin Config 提取时：

- 必须验证来源 digest；
- 必须确认来源仍有效；
- 必须标注 \`system_verified\` 或 \`artifact_approved\`；
- 来源 Artifact 被撤销时，相关记忆自动进入重新评估。

### 10.3 后台复盘

后台复盘只能调用：

- \`propose_memory\`
- \`propose_memory_supersession\`
- \`propose_procedural_learning\`

不能调用：

- \`approve_memory\`
- \`publish_skill\`
- \`promote_artifact\`
- \`change_project_intent\`

### 10.4 删除与忘记

删除必须：

1. 将记录标记为 Revoked；
2. 保存撤销事件；
3. 从稳定快照移除；
4. 向全部索引发布删除 Outbox；
5. 清除 Provider 投影；
6. 使依赖该记忆的未完成 Runtime Context 失效；
7. 保留最小审计元数据，不保留被要求删除的敏感正文。

## 11. 召回流程

每个 turn 的查询由服务端构造，不由模型自由指定租户或 Scope：

~~~text
TaskBrief + Current Intent + Project State
→ Server-bound MemoryQuery
→ Tenant/Scope/Status/Sensitivity Filter
→ Hybrid Retrieval
→ Conflict and Freshness Check
→ Budgeted Ranking
→ Source Validation
→ Immutable TurnMemoryPackage
~~~

排序建议：

~~~text
score =
  relevance
  × trust_weight
  × freshness_weight
  × scope_weight
  × importance
  × source_validity
~~~

任何一项来源失效或租户不匹配，最终分数强制为 0。

## 12. Memory Package

~~~typescript
type TurnMemoryPackage = {
  packageId: string;
  projectId: string;
  conversationId: string;
  intentEpoch: number;
  createdAt: string;
  contentDigest: string;
  tokenBudget: number;
  memories: Array<{
    memoryId: string;
    version: number;
    kind: MemoryRecord["kind"];
    trust: MemoryTrust;
    content: string;
    sourceRefs: MemorySourceRef[];
  }>;
};
~~~

要求：

- turn 开始后不可修改；
- Native、Codex 和 Subagent 使用同一个 Package；
- PackageId 和 Digest 进入 Checkpoint；
- Runtime 输出关联 PackageId；
- Memory 被撤销或 IntentEpoch 变化时，正在执行的 turn 必须中断或结果失效；
- Memory Fence 不能被持久化为新的用户消息，避免递归记忆污染。

## 13. 重复、冲突和替代

### 重复

- 同一 Scope 下 \`normalizedKey + contentDigest\` 相同则拒绝重复；
- 语义近似但来源不同则合并 SourceRef，不复制正文；
- 跨 Scope 的相同内容保持独立记录。

### 冲突

冲突记录不能同时作为权威上下文：

- Teacher Explicit 高于 Model Derived；
- Admin Policy 高于 Project Suggestion；
- 新 IntentEpoch 的 Project Decision 高于旧 Epoch；
- Approved Artifact 高于未批准 Draft；
- 无法自动判定时进入 Pending Review。

### 替代

更新不覆盖旧记录：

~~~text
Memory v1 approved
→ Candidate v2
→ Review
→ v2 approved, supersedes v1
→ v1 status = superseded
~~~

这样可以回滚、解释和评估错误记忆的影响。

## 14. Privacy 与教育数据边界

默认禁止进入长期记忆：

- 学生姓名、联系方式和账号；
- 单个学生成绩、评语和行为记录；
- 未成年人图像、生物特征和语音身份；
- API Key、Cookie、Token 和内部凭证；
- 未经授权的版权材料全文；
- Tool Output 中的本地绝对路径和环境秘密；
- 外部网页中的 Prompt 指令。

Teacher Profile 只保存教师主动表达且与产品体验直接相关的偏好。任何云 Memory Provider 接入前必须完成字段级数据出境评审。

## 15. Memory Provider 抽象

ShanHai 不直接复制 Hermes 的“一个外部 Provider 保存全部记忆”，而采用：

~~~typescript
interface MemoryRetrievalProvider {
  readonly kind: "local" | "external";
  healthCheck(): Promise<MemoryProviderHealth>;
  upsert(records: MemoryIndexDocument[]): Promise<void>;
  remove(memoryIds: string[]): Promise<void>;
  search(query: MemorySearchQuery): Promise<MemorySearchHit[]>;
  rebuild(records: AsyncIterable<MemoryIndexDocument>): Promise<void>;
}
~~~

规则：

- 一个 Scope 在一个环境中只有一个主检索 Provider；
- 本地规范数据库始终存在；
- Provider 可以切换和重建；
- Provider Tool Schema 不直接暴露给模型；
- 模型只调用 ShanHai 的 \`search_memory\` 或接收预组装 Package；
- Provider 凭证不进入 Codex；
- Provider 返回内容重新经过 Scope 和 Source Validation。

## 16. 与 Codex Runtime 的关系

Codex 不拥有独立业务记忆库。

Codex turn 输入包括：

- TaskBrief；
- TurnMemoryPackage；
- AllowedTools；
- ApprovedArtifactRefs；
- Budget；
- ExecutionEnvelope。

Codex 可以调用：

- \`search_memory\`：服务端绑定 Scope 的只读搜索；
- \`propose_memory\`：产生 Candidate；
- \`report_memory_conflict\`：报告冲突。

Codex 不能调用：

- 直接写 Approved Memory；
- 修改 Teacher Profile；
- 修改 Organization Policy；
- 删除规范记忆；
- 更改 Scope；
- 将 Codex Thread 自动晋升为长期记忆。

## 17. 分阶段吸收路线

### HM-0：研究与规格

交付本设计、Hermes 源码映射、ShanHai 数据边界和硬性不变量。生产行为不变。

### HM-1：规范 Memory Repository

只建立数据模型、版本、作用域、状态、来源和 Repository 测试。不做 LLM 提取，不做向量检索。

### HM-2：显式 Memory 管理

实现教师可查看、添加、修改、批准、拒绝、撤销和忘记。所有写入仍由明确用户操作触发。

### HM-3：Turn Memory Package

实现 Scope 过滤、预算组装、不可变 Package、Checkpoint 绑定和 Native Runtime 注入。先使用数据库关键词/规则检索。

### HM-4：Curator Candidate Pipeline

后台 Curator 从已完成 turn 提出 Candidate。只进入 Pending Review，不自动批准。验证不污染 Conversation，不阻塞主回答。

### HM-5：本地混合检索与压缩前提取

加入 FTS/BM25 和可选 Embedding，完成重复、冲突、TTL、压缩前候选提取和索引 Outbox。

### HM-6：Codex 只读接入

Codex 接收同一 TurnMemoryPackage，并可调用受限 \`search_memory\` 和 \`propose_memory\`。不开放直接生效写入。

### HM-7：受控自动批准

只对明确规则可验证的低敏感记忆开放自动批准。Model Derived、Teacher Profile 推断和跨项目晋升继续需要审批。

### HM-8：外部 Provider 评估

在本地系统通过验收后，再比较 Honcho、Mem0、Hindsight、OpenViking、Supermemory 或其他 Provider。外部 Provider 只作为可替换索引。

每个 HM 阶段单独设计、单独实现、单独测试、单独提交。上一阶段未验收时不进入下一阶段。

## 18. 硬性验收标准

### 安全与治理

- 跨租户召回数量为 0；
- 未经批准进入稳定上下文的 Model Derived 记忆数量为 0；
- 无 SourceRef 的 Approved Memory 数量为 0；
- 被 Revoked/Expired/Superseded 记忆进入 Runtime Context 的数量为 0；
- 后台 Curator 直接修改 Approved Memory 的数量为 0；
- 学生个人信息进入长期记忆的数量为 0；
- Codex 直接修改规范 Memory Repository 的数量为 0。

### 一致性与恢复

- 同一 Scope 的 Memory Version 单调递增；
- Outbox 重放不产生重复索引记录；
- Provider 完全丢失后可从规范 Repository 重建；
- Memory 撤销后所有在线快照在下一个 turn 前失效；
- IntentEpoch 变化后旧 Project Memory 不进入新 turn；
- Compression 前候选提交失败时不删除待压缩 Runtime Context。

### 产品质量

使用固定测试集评估：

- Relevant Memory Recall@K；
- Unsupported Memory Rate；
- Contradiction Injection Rate；
- Memory Pollution Rate；
- Pending Review Acceptance Rate；
- Teacher Correction Rate；
- Prompt Token Overhead；
- P50/P95 Recall Latency；
- Index Lag；
- Delete Propagation Latency。

外部 Provider 只有在硬性安全不变量全部满足，并且 Relevant Memory Recall 不低于本地基线时才允许灰度。

## 19. 后续实现边界

后续实现预计新增独立 \`src/server/memory/\` 边界，至少拆分：

- \`memory-types.ts\`
- \`memory-repository.ts\`
- \`memory-policy-engine.ts\`
- \`memory-curator.ts\`
- \`memory-conflict-resolver.ts\`
- \`memory-context-assembler.ts\`
- \`memory-retrieval-provider.ts\`
- \`memory-index-outbox.ts\`
- \`memory-review-service.ts\`

同时与现有以下边界集成：

- Conversation/Message 持久化；
- Main Agent Context Builder；
- ReAct Checkpoint；
- Agent Runtime Input；
- Tool Observation；
- Artifact 和 QualityDecision；
- ExecutionEnvelope 和 IntentEpoch。

本规格不授权立即创建这些生产文件。每个 HM 阶段需先形成实施计划和测试范围。

## 20. 版本控制规则

- 所有 H01/HM 阶段工作只进入 \`intake-hermes\`；
- 一个阶段至少包含独立规格提交、实现提交和验证提交；
- 不把多个 HM 阶段压成一个实现提交；
- 阶段未验收前不重写或强推分支历史；
- Commit Message 使用阶段编号，例如：
  - \`docs(memory): add H01 Hermes memory intake\`
  - \`test(memory): add HM-1 repository contract tests\`
  - \`feat(memory): implement HM-1 repository\`
  - \`docs(memory): record HM-1 verification evidence\`
- 每个阶段在 Intake Ledger 中记录设计版本、Commit SHA、状态、验收证据和下一阶段入口条件；
- 合入 main 前保留阶段提交历史，除非项目负责人明确批准压缩历史。

## 21. 明确非目标

本设计提交不：

- 修改 Prisma Schema；
- 新增生产 API；
- 接入向量数据库；
- 调用外部 Memory Provider；
- 自动提取教师记忆；
- 修改 Main Agent Prompt；
- 向 Codex 暴露 Memory Tool；
- 修改现有 Conversation 或 Artifact 数据。

## 22. 参考源码

- Hermes Persistent Memory：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/website/docs/user-guide/features/memory.md>
- Hermes Memory Providers：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/website/docs/user-guide/features/memory-providers.md>
- Hermes Memory Tool：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/tools/memory_tool.py>
- Hermes MemoryManager：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/agent/memory_manager.py>
- Hermes MemoryProvider：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/agent/memory_provider.py>
- Hermes Background Review：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/agent/background_review.py>
- Hermes Turn Context：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/agent/turn_context.py>
- Hermes Turn Finalizer：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/agent/turn_finalizer.py>
