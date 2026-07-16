# M60 异步队列、渐进展示与视频工作流测试计划

## 1. 测试目标

本测试计划用于验证 M60 阶段是否真正解决三类问题：生成中可继续输入并排队、后端同项目串行且可恢复、视频生成前置链路完整且不把未达标产物冒充完成。

通过标准：所有测试必须以真实状态、真实数据库记录、真实 API 响应、真实 artifact 文件或真实浏览器行为为依据；不能用 mock 成功态、placeholder 文件、目标页数或前端本地猜测替代验收。

## 2. 测试范围

### 2.1 覆盖范围

- ConversationTurnJob 队列模型与状态机。
- `POST /messages` 入队返回。
- 同项目串行、多项目可并行。
- 幂等防重复发送。
- running 超时、失败记录与重试入口。
- 前端生成中可输入、可发送、可显示排队中。
- 前端节点级渐进展示。
- 教师界面工程词过滤。
- PPT 逐页设计稿门禁与真实 slideCount 复验。
- 视频工作流 contract：知识锚点、主题、脚本、分镜、资产、provider profile、segment jobs、只拼接最终视频。

### 2.2 不覆盖范围

- 不做生产部署验收。
- 不验证未接入 provider 的首尾帧能力。
- 不验证复杂剪辑、转场、滤镜、字幕后期或混音。
- 不以 Evolink smoke 视频代表最终 60 秒视频交付。
- 不对外部 provider 并发上限作未证实承诺。

## 3. 状态机验收

### 3.1 ConversationTurnJob 状态流转

用例：创建一个项目，连续发送三条消息。

期望：

```text
job1: queued -> running -> succeeded
job2: queued -> running -> succeeded
job3: queued -> running -> succeeded
```

断言：

- 同一时间同一项目最多一个 `running`。
- job 执行顺序与创建顺序一致。
- 每个 job 都有 `teacherMessageId`。
- 成功 job 有 `finishedAt`。
- 失败 job 有教师可理解 `errorMessage`，不暴露 provider、node_id、storage、local path。

建议测试：

```shell
node --test "tests/m60-conversation-turn-queue.test.mjs"
```

### 3.2 幂等防重复发送

用例：用相同 `idempotencyKey` 对同一项目重复发送同一条消息。

期望：

- 只创建一条 teacher message 或只绑定一个有效 turn job。
- API 返回同一个 job 或明确说明重复请求已接收。
- 不会生成两个重复 assistant turn。

### 3.3 running 锁超时恢复

用例：人为构造一个 `running` 且 `lockedUntil` 已过期的 job，再触发 drain。

期望：

- 系统识别该 job 可恢复或标记 failed。
- 不允许永久占用项目锁。
- 后续 queued job 可以继续推进。

### 3.4 单项目串行与多项目并行

用例：项目 A 连续三条消息，项目 B 同时发送一条消息。

期望：

- 项目 A 内部严格 FIFO。
- 项目 B 不被项目 A 的队列阻塞，除非全局资源限制明确配置。

## 4. API 验收

### 4.1 `POST /messages` 入队返回

用例：发送一条需要长时间生成的消息。

期望响应：

```text
HTTP 202 或等价 accepted 状态
包含 teacher message
包含 turn job id
turn job status = queued 或 running
不等待完整 assistant 结果才返回
```

失败条件：

- 请求阻塞到完整生成结束才返回。
- 只返回本地前端状态，没有后端 job 记录。
- API 响应泄露 provider、token、local path 或 debug 字段。

### 4.2 snapshot 队列状态

用例：发送两条消息后立即请求 snapshot。

期望：

- snapshot 包含 teacher messages。
- snapshot 能表示至少一条 running 或 queued job。
- 前端可从 snapshot 还原队列状态，刷新页面不丢。

### 4.3 失败与重试入口

用例：让一个 provider 调用失败或构造不合格 artifact。

期望：

- job status 为 `failed` 或 `blocked`。
- 保存失败原因。
- 可针对失败 job 或失败节点重试。
- 重试不重复执行已成功的无关节点。

## 5. 前端浏览器验收

### 5.1 生成中可输入

步骤：

1. 打开工作台项目。
2. 发送一条会触发长流程生成的消息。
3. 在其运行中点击输入框并输入第二条消息。
4. 发送第二条消息。

期望：

- textarea 在第一条运行中仍可输入。
- 第二条可发送。
- 第二条显示“排队中”。
- 不出现“上一条还在回复，请稍等片刻”这类硬阻断。

### 5.2 多条队列展示

步骤：

1. 连续发送三条消息。
2. 观察对话区和队列提示。

期望：

- 第一条显示“正在生成”或等价教师文案。
- 后两条显示“排队中”。
- 第一条完成后第二条自动变为“正在生成”。
- 刷新页面后状态仍能从后端恢复。

### 5.3 节点级渐进展示

步骤：

1. 触发完整交付计划。
2. 观察右侧节点栏和对话区。

期望：

- 节点逐步从排队中、正在生成、待确认、已完成或未达标变化。
- 不等所有 artifact 完成才一次性展示。
- 失败节点显示“未达标原因”和“下一步建议”。

### 5.4 工程词过滤

检查区域：

- 对话区；
- 节点栏；
- artifact 阅读侧栏；
- 下载按钮与错误提示；
- 移动/窄屏布局。

禁止出现：

```text
schema
manifest
provider
node_id
storage
API
debug
local path
capabilityId
runtimeKind
providerStatus
placeholder
```

注意：源码和测试名可以包含工程词；本项只约束教师可见 UI。

## 6. PPT 门禁验收

### 6.1 范围合并页拒绝

输入包含：

```text
第 4-8 页
第 9-12 页
第 3-12 页四层延展规则
```

期望：

- `ppt_design_draft` 标记 blocked 或 validation failed。
- 不进入 Coze PPTX 生成。
- 教师界面说明“PPT 设计稿未逐页完整”。

建议测试：

```shell
node --test "tests/m59-ppt-design-coze-gate.test.mjs"
```

### 6.2 真实 PPTX slideCount

用例：构造目标 12 页但真实 slideCount 为 2 的 PPTX。

期望：

- artifact 不得标记为可验收 12 页 PPTX。
- status 为 failed 或 blocked。
- summary 说明真实 2 页、目标 12 页未达标。

继续使用已有 vitest：

```shell
npx vitest run "src/server/pptx/artifact-pptx.test.ts" "src/server/coze-ppt/__tests__/coze-ppt-artifact-adapter.test.ts" --maxWorkers=1
```

## 7. 视频工作流 contract 验收

### 7.1 节点顺序

完整视频交付计划必须包含：

```text
knowledge_anchor_extract
creative_theme_generate
creative_theme_confirm
video_script_generate
storyboard_generate
asset_brief_generate
asset_image_generate
video_segment_plan
video_segment_generate
concat_only_assemble
final_video_validate
```

期望：

- 缺知识锚点不能生成主题。
- 缺确认主题不能生成脚本。
- 缺脚本不能生成分镜。
- 缺分镜和资产不能调用视频 provider。

建议测试：

```shell
node --test "tests/m60-video-workflow-contract.test.mjs"
```

### 7.2 知识锚点输出

输入：结构化教案。

输出必须包含：

- 关键知识点；
- 学生易错点；
- 生活关联点；
- 可创意化表达点；
- 课堂回落问题。

失败条件：

- 只复述教案。
- 没有导入视频可用的冲突、悬疑或任务点。

### 7.3 创意主题输出

每个主题必须包含：

- 标题；
- 一句话故事；
- 创意类型；
- 绑定知识锚点；
- 课堂适配原因；
- 风险。

失败条件：

- 主题只是课程标题改写。
- 主题讲完了完整知识点，失去“导入”作用。

### 7.4 脚本与分镜输出

分镜必须包含：

- 分镜 ID；
- 时长；
- 镜头目标；
- 场景；
- 画面动作；
- 镜头运动；
- 旁白或字幕；
- 角色、道具、场景资产；
- 关键帧要求；
- 连贯性说明。

失败条件：

- 只有一段视频 prompt。
- 没有每镜头时长。
- 没有关键帧或资产约束。

### 7.5 Provider profile

Evolink profile 断言：

- T2V 模型为 `grok-imagine-text-to-video-beta`。
- I2V 模型为 `grok-imagine-image-to-video-beta`。
- `image_urls` 支持 1-7 张参考图。
- 单次时长 6-30 秒。
- 首尾帧能力为未证实，不得在 planner 中当作已支持。
- 结果 URL 有时效，必须下载入 artifact storage。

失败条件：

- 把多图参考当成首尾帧。
- 未下载 provider 结果，只保存外部短期 URL。
- 未配置并发保守上限就批量高并发。

### 7.6 分镜视频与拼接

用例：60 秒目标，规划 6 个 segment。

期望：

- 每段都有独立 job。
- 每段有输入 prompt、参考图列表、目标时长。
- 单段失败不删除其他成功片段。
- 拼接只使用通过校验的真实 segment 文件。
- 最终视频 metadata 标明来自哪些 segment。

失败条件：

- 直接拿一句 prompt 生成整条视频。
- 用 smoke 视频或占位视频当最终视频。
- 拼接阶段重排、加特效或重写内容。

## 8. 集成与回归命令

阶段完成前至少运行：

```shell
node --test "tests/m60-conversation-turn-queue.test.mjs"
node --test "tests/m60-video-workflow-contract.test.mjs"
node --test "tests/m59-ppt-design-coze-gate.test.mjs"
npx vitest run "src/server/pptx/artifact-pptx.test.ts" "src/server/coze-ppt/__tests__/coze-ppt-artifact-adapter.test.ts" --maxWorkers=1
npm run build
git diff --check
```

若运行 `npm test` 因 Windows 资源限制或外部 provider 环境不可用失败，需要记录：

- 已运行的分组命令；
- 失败测试名；
- 是否与本阶段变更相关；
- 下一步最小修复动作。

## 9. 浏览器验收记录要求

阶段结束报告必须包含：

- 桌面宽屏截图或描述：生成中可输入、排队状态、节点渐进。
- 窄屏截图或描述：输入框、队列、节点栏不遮挡关键控件。
- 教师界面工程词检查结果。
- 至少一次刷新页面后队列状态仍正确的证据。
- 若无法打开浏览器，必须说明原因，并以 API + 组件测试替代，同时标记残余风险。

## 10. 通过/阻断判定

### 10.1 通过条件

- 后端队列测试通过。
- 前端浏览器验收通过。
- 视频 contract 测试通过。
- PPT 门禁回归通过。
- build 通过。
- 教师界面无工程词泄露。
- 无 placeholder、smoke、fallback 冒充真实成果。

### 10.2 阻断条件

- 同一项目可并发运行多个 turn。
- 生成中仍无法输入或发送。
- 刷新后排队状态丢失。
- 视频缺少知识锚点、主题、脚本、分镜、资产任一前置节点却调用 provider。
- PPTX slideCount 不达标仍显示成功。
- 教师界面泄露 provider、local path、storage、debug 或 token。

## 11. 阶段出口

Stage：`products-writing-plans`

Gate：`continue`

下一步：先做工程审查，确认 schema、队列状态机、API 兼容和视频 provider profile 无明显风险；审查通过后再执行测试先行与实现。
