# V1-9G 最终包真实 Runtime 来源门计划

更新时间：2026-07-13

状态：`accepted / in progress`

## 1. 背景

内部文本能力保留 `FallbackAgentRuntime`：OpenAI Runtime失败时可生成明确标记为`deterministic_draft`的兼容草稿。该能力允许教师继续查看、修改或重试，但V1目标禁止把deterministic fallback或degraded工件冒充真实完成。

当前 `prepareVersionedFinalPackageInput()` 只验证源工件已批准、同项目、文件真实、审查通过和版本一致，没有验证需求规格、教案、PPT逐页设计和视频脚本是否由真实OpenAI Runtime生成。若模型执行失败后教师批准了兼容草稿，现有最终包门仍可能把它打入真实ZIP。

## 2. 目标

- 最终包阶段对四类语义源执行真实Runtime来源门：`requirement_spec`、`lesson_plan`、`ppt_design_draft`、`video_script_generate`。
- 每个语义源必须同时满足：`generationMode=model_generated`、`providerStatus=real`、`runtimeKind=openai`。
- 任一字段缺失、deterministic、degraded或不一致时，在读取/打包文件前fail-closed，不生成最终ZIP。
- PPTX、图片和视频继续使用各自文件真实性、Provider、Critic、HumanGate与Quality Gate证据，不强行要求模型来源字段。

## 3. 边界

- 不删除`DeterministicRuntime`，不改变测试兼容路径，也不禁止教师查看或修改草稿。
- 不阻断中间草稿保存；只阻止其被标记为真实最终交付。
- 不以模型来源替代PPT、图片、视频的真实文件和质量审查。
- 不调用真实Provider，不越过当前教师HumanGate。

## 4. 风险与回退

- 风险：旧历史工件缺少来源字段。处理：最终交付必须fail-closed；教师可从对应节点用真实Runtime重新生成，不迁移旧数据伪造来源。
- 风险：来源字段被模型自行声明。处理：字段来自Capability Runner服务端封装，不读取模型正文中的自报值。
- 回退：移除FinalPackageInputContract单一断言即可恢复上一行为；历史工件和文件不改写。

## 5. 退出标准

- 四个真实模型语义源可正常成包。
- 任一源为`deterministic_draft`、非`real`、非`openai`或字段缺失时稳定阻断，ZIP创建次数为0。
- 现有PPT、视频、版本、hash、HumanGate和Quality Gate测试不回归。
- 专项、完整测试、生产构建与diff检查通过。
