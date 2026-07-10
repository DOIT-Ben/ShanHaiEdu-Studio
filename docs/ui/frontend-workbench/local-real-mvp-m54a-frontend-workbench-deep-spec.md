# M54-A 前端聊天式工作台深度规格与图像参考验收

日期：2026-07-08

状态：正式开发规格 / 部分落地 / 第一档继续收口。

关联路线：

- `docs/ui/frontend-workbench/local-real-mvp-m54a-frontend-workbench-roadmap.md`
- `docs/ui/frontend-workbench/local-real-mvp-m54a-open-items.md`
- `docs/product/frontend-workbench-priority-requirements.md`
- `docs/stages/local-real-mvp-m54b-agentic-conversation-roadmap.md`
- `docs/ui/frontend-workbench/stage-history/local-real-mvp-m53-teacher-facing-confirmation-and-reading-plan.md`

本文件只参考当前 M54/M53 正式文档和用户提供的参考图，不参考 `docs/archive` 下的归档旧规划。

## 1. 目标

M54-A 要把当前工作台从“能用的三栏页面”推进为“教师愿意真实使用的聊天式备课工作台”。

目标不是单纯美化，而是把用户明确提出的体验诉求落成可开发、可测试、可验收的规格：

```text
清晰进入
-> 类模型聊天输入
-> 附件/截图/模型/工具入口可用
-> AI 回复有等待态和流式感
-> 回复结构清晰、有快捷下一步
-> 业务需求才出现确认卡和产物卡
-> 对话内可展开阅读
-> 右侧糖葫芦稳定追踪交付链
-> 左侧项目区有价值，未接功能不扰民
```

## 2. 参考图清单

参考图只作为交互、信息层级和视觉质感参考，不要求逐像素复刻。

原始参考图来自 2026-07-08 用户会话中的剪贴板图片，临时路径已失效，当前不再保留个人临时绝对路径。后续 UI 开发前，将仍有价值且已脱敏的参考图落到：

```text
docs\ui\frontend-workbench\assets\references\
```

| 编号 | 长期需求锚点 |
| --- | --- |
| R00 | 用户汇总说明截图，作为本规格总索引。 |
| R01 | 页面全部展开态：左侧、对话、右侧糖葫芦同时可见。 |
| R02 | 左侧侧边栏收起态：主对话空间扩大，入口仍可恢复。 |
| R03 | 左下角头像菜单：账号、设置、反馈等相关信息。 |
| R04 | 进入后的默认工作台状态。 |
| R05 | 输入区工具：模型切换、上传材料等入口。 |
| R06 | 第一次拿到网站的样子：品牌、欢迎语、推荐任务。 |
| R07 | 反馈入口：点赞、点踩、反馈弹窗或入口。 |
| R08 | 消息 hover/focus 交互：复制、更多、反馈等低频操作。 |
| R09 | AI 回复时的流式回复和 generating 提示。 |
| R10 | 回复后的 2-3 个快捷发送指令，文案分点、清晰、热情。 |
| R11 | 更精致的正在生成交互质感。 |
| R12 | 输入框随内容自动增长，有高度阈值。 |
| R13 | 拖动文件到输入框时出现 Drop to attach 覆盖态。 |

## 3. 不可变产品原则

- 中间对话是主视觉，不能被产物字段、工程状态或侧栏噪声抢走。
- 左侧项目区、右侧糖葫芦和中间对话同时存在；右侧糖葫芦不能被下架。
- 普通聊天就是普通聊天，不展示需求规划卡、产物卡或后台字段。
- 只有明确业务需求才进入需求确认；只有用户确认后才生成产物。
- 教师可见界面不能出现 `schema`、`provider`、`node_id`、`debug`、`API`、`Markdown key`、`上游来源` 等工程词。
- 所有 visible button 必须有真实价值：已接功能可点击，未接功能隐藏或明确 disabled。
- quick replies 只能填入输入框或更新草稿，不能自动发送，避免用户失控。
- 附件前端先行时必须显示真实状态：待上传、上传中、待解析、解析失败、已解析；不能暗示系统已经理解未解析文件。

## 4. 信息架构

### 4.1 首次进入

对应参考：R04、R06。

用户第一次进入时应该看到：

- ShanHaiEdu 品牌标识和一句自然欢迎语。
- 2-4 个高频备课任务入口，例如“做公开课课件”“整理教案”“上传教材生成活动”“继续上次项目”。
- 中央输入框可直接输入，不需要先选择工具。
- 右侧糖葫芦可以是紧凑待开始状态，但不能消失。

不应出现：

- 营销页 hero。
- 大面积装饰渐变。
- 技术配置项。
- 空白页面或满屏后台字段。

### 4.2 三栏展开与收起

对应参考：R01、R02。

桌面宽屏：

- 左侧项目栏默认可见，宽度稳定。
- 中间对话区随空间伸缩，但输入框和最新消息始终可见。
- 右侧糖葫芦默认可见，详情面板打开时主内容进入紧凑态。

左侧收起：

- 项目栏折叠为窄入口或 icon rail。
- 对话区获得更多空间。
- 恢复按钮清晰可见。
- 搜索框不应在折叠状态里残留半截 UI。

右侧压缩：

- 空间不足时，糖葫芦收成小组件或抽屉入口。
- 不允许遮挡输入框、最新消息和确认按钮。

### 4.3 左下角头像菜单

对应参考：R03。

`ProfileMenu` 内容第一版：

- 当前用户或本地演示身份。
- 设置入口。
- 反馈入口。
- 关于当前运行模式。
- 退出或切换账号：如果后端未接，显示 disabled，不进入主视觉。

菜单要求：

- 点击头像打开，再次点击或外部点击关闭。
- 键盘可达。
- 不显示工程路径、密钥、token 或本地敏感信息。

## 5. 输入区规格

对应参考：R05、R12、R13。

### 5.1 PromptComposer 容器

`PromptComposer` 只做编排，不继续堆所有逻辑。拆分：

- `ComposerToolbar`
- `ComposerAttachmentMenu`
- `ComposerModelMenu`
- `ComposerFileDropzone`
- `ComposerAttachmentPreview`
- `useAutoResizeTextarea`
- `useComposerAttachments`

### 5.2 发送与文本行为

- Enter 发送。
- Shift+Enter 换行。
- 发送中禁用重复提交。
- 发送后清空输入框。
- 用户消息出现后立即滚动到底部。
- Assistant 回复完成或产物卡插入后再次滚动到底部。
- 输入框根据内容自动增长，到阈值后内部滚动，不撑坏页面。

建议阈值：

- 最小高度：单行输入态。
- 最大高度：约 30%-40% 对话区高度，窄屏更小。
- 超过最大高度后 textarea 内滚动。

### 5.3 工具栏

`ComposerToolbar` 包含：

- 附件加号。
- 模型菜单。
- 上传材料。
- 截图/图片入口。
- 可选 Web Search 入口：如果后端未接，隐藏或 disabled。

模型菜单第一版只表达模式，不暴露 provider 细节：

- 智能模式。
- 本地演示模式。
- 真实模型模式。

若切换未真正接入后端，只能显示 disabled 或“稍后开放”，不能让用户误以为已生效。

### 5.4 附件

支持入口：

- `.md`
- `.txt`
- `.pdf`
- `.docx`
- 图片。
- 粘贴截图。

前端附件卡必须显示：

- 文件名。
- 类型。
- 大小。
- 状态。
- 删除按钮。

状态枚举建议：

```text
pending_upload
uploading
uploaded
pending_parse
parsed
parse_failed
unsupported
```

### 5.5 拖拽与粘贴

拖拽文件进入输入区域：

- 出现覆盖态，参考 R13。
- 文案使用教师可懂表达，例如“松手添加材料”。
- 覆盖态只覆盖输入区域或对话底部，不遮住整个工作台。

粘贴截图：

- 截图生成图片附件卡。
- 默认状态为待上传或待解析。
- 没有 OCR 前不能说“已理解截图内容”。

## 6. 消息区规格

对应参考：R07、R08、R09、R10、R11。

### 6.1 消息排版

Assistant 回复默认：

- 分段短句。
- 关键结论可加粗。
- 业务建议用 2-5 条项目符号。
- 不一口气堆长段。
- 保持热情但不过度拟人。
- 结尾优先给可选下一步，而不是强迫用户继续。

用户消息：

- 右侧或明显区别于 assistant。
- 长文本不撑坏气泡。
- 发送失败时有重试入口。

### 6.2 普通聊天与业务需求

普通聊天：

- 自然回复。
- 可给轻量 quick replies。
- 不出现产物卡、需求确认卡、后台状态。

模糊业务需求：

- 出现槽位问题。
- 给 2-3 个推荐选项。
- 选项点击只填输入框或更新草稿。

明确业务需求：

- 出现教师可读的确认卡。
- 用户确认后才生成。

### 6.3 GeneratingIndicator

生成态至少支持：

- 正在理解。
- 正在整理材料。
- 正在生成回复。
- 正在保存成果。

视觉要求：

- 有轻微动态反馈。
- 不闪烁。
- 不造成布局跳动。
- 网络慢时仍然让用户知道系统在工作。

如果后端暂未做 token streaming，前端可以先做 staged generating，但文案必须准确，不能假装流式 token 已接。

### 6.4 流式回复

最终目标：

- 支持服务端 streaming 或 SSE。
- Assistant 文本逐步出现。
- 产物生成中可以先显示状态，产物保存后再插入成果卡。

第一版可接受：

- 非 token streaming，但有明确 `GeneratingIndicator`。
- 后续阶段再接真实 streaming API。

文档和 UI 中必须区分：

- `generating`：正在生成中。
- `streaming`：正在流式输出 token。
- `saving_artifact`：正在保存成果。

### 6.5 MessageActions

Hover 或 focus 后显示：

- 复制。
- 点赞。
- 点踩。
- 更多。
- 展开或收起。

要求：

- 键盘可达。
- mobile 上可通过轻触或更多菜单访问。
- 复制成功有 near-field feedback。
- 点赞/点踩后打开 `FeedbackDialog` 或出现可选反馈入口。

### 6.6 FeedbackDialog

反馈能力已提升为上线门槛，统一以 `docs\product\beta-feedback-requirements.md` 为准：

- 全局入口、头像菜单、点赞/点踩复用同一个真实反馈中心。
- 分类、描述、影响程度、可点击预制提示、图片选择和剪贴板图片粘贴。
- 服务端数据库与持久化附件存储。
- 提交成功返回反馈编号；失败保留草稿与图片。
- 不允许再显示“本地已记录”冒充服务端保存，也不能保留“反馈入口暂未开放”的可点击假功能。

## 7. Quick Replies 与确认卡

对应参考：R10。

每条 assistant 回复后最多展示 2-3 个 quick replies。

quick reply 类型：

- 推荐下一步。
- 补充信息。
- 修改方向。
- 继续生成。

文案要求：

- 短。
- 像用户会说的话。
- 不使用工程词。
- 推荐项可有轻微强调，但不要刺眼。

点击行为：

- 默认填入输入框。
- 不自动发送。
- 光标聚焦到输入框。
- 用户可以编辑后再发送。

确认卡第一版字段：

- 我理解的任务。
- 已有信息。
- 还缺什么。
- 推荐先做什么。
- 操作：确认开始、补充信息、先聊创意。

确认卡不显示：

- JSON。
- Markdown 字段名。
- 上游来源。
- artifact key。
- tool id。

## 8. 对话内成果卡

对话内成果卡是小组件，不是完整后台面板。

状态：

- compact：只显示标题、摘要、主要动作。
- expanded：显示正文节选或结构化内容。
- side_panel：点击查看完整成果，右侧详情打开。

compact 显示：

- 标题。
- 1-2 行摘要。
- 当前状态的教师表达。
- 展开按钮。

expanded 显示：

- Markdown 正文渲染。
- 复制。
- 作为输入。
- 确认使用。
- 调整后重做。

Markdown 渲染最低要求：

- 标题。
- 段落。
- 有序/无序列表。
- 加粗。
- 表格若出现不能完全变形。
- 中文段落间距自然。

## 9. 右侧糖葫芦与阅读面板

对应参考：R01、R02。

右侧糖葫芦职责：

- 展示交付链步骤。
- 告诉用户当前做到哪一步。
- 让用户快速打开成果。
- 支持复制、作为输入、确认、重做。

桌面：

- 默认可见。
- 宽度稳定。
- 拖拽 resize 无明显延迟。
- 详情面板打开时，中间对话压缩但不破版。

窄屏：

- 转为底部入口或抽屉。
- 不消失。
- 不遮挡输入框。

拖拽性能验收：

- 拖动时不启用 width transition。
- 拖拽柄命中区域足够。
- 鼠标移动时宽度更新跟手。
- 拖拽结束后保存宽度偏好。

## 10. 左侧项目区

左侧必须有价值，不接功能不抢视觉。

必须可用：

- 项目列表。
- 新建项目。
- 项目搜索。
- 展开/收起。
- 当前项目高亮。

需要隐藏或降级：

- 归档。
- 删除。
- 置顶。
- 回收站。
- 协作。

如果第一版要展示这些功能，必须接真实行为或明确 disabled；不能做假按钮。

搜索要求：

- 点击搜索后光标聚焦。
- 输入过滤项目。
- 无结果有低噪声提示。
- 折叠侧栏时搜索不破版。

## 11. 品牌与 Logo

对应参考：R04、R06。

需要补齐品牌资产规格：

- `public/brand/shanhai-logo.png` 或现有同类路径。
- 透明背景版本。
- 256px 应用内图标版本。
- 小尺寸 favicon 或 app icon 版本。

使用位置：

- 首次进入欢迎态。
- 左侧顶部或头像附近的品牌标识。
- Assistant avatar。
- loading/generating 可以使用小尺寸标识，但不能过度装饰。

如果后续使用生成图片或抠图：

- 原始图放在 `public/brand/source/` 或文档记录来源。
- 前端使用压缩后的稳定文件名。
- 不在代码里引用临时目录图片。

## 12. 后端接口依赖

M54-A 不自己判断复杂业务意图。它消费 M54-B 输出：

```ts
type ConversationDecisionV2 = {
  intent: string;
  assistantMessage: {
    title?: string;
    body: string;
  };
  slots: RequirementSlots;
  missingSlots: string[];
  recommendedOptions: RecommendedOption[];
  quickReplies: QuickReply[];
  nextAction: string;
  shouldGenerateArtifact: boolean;
};
```

M54-A 还需要后端后续提供：

- 附件上传结果。
- 附件解析状态。
- 模型/运行模式状态。
- feedback 保存接口。
- streaming 或 staged generation 状态。
- 产物保存后的 artifact id。

若后端尚未提供，前端只能使用 fixture 或准确的待接状态，不能伪装真实完成。

## 13. 组件拆分策略

优先拆新文件，不在已有大组件里继续打补丁。

第一批必须拆：

- `src/components/conversation/composer/ComposerToolbar.tsx`
- `src/components/conversation/composer/ComposerAttachmentMenu.tsx`
- `src/components/conversation/composer/ComposerModelMenu.tsx`
- `src/components/conversation/composer/ComposerFileDropzone.tsx`
- `src/components/conversation/composer/ComposerAttachmentPreview.tsx`
- `src/components/conversation/composer/useAutoResizeTextarea.ts`
- `src/components/conversation/composer/useComposerAttachments.ts`
- `src/components/conversation/messages/GeneratingIndicator.tsx`
- `src/components/conversation/messages/QuickReplySuggestions.tsx`
- `src/components/conversation/messages/MessageActions.tsx`
- `src/components/conversation/messages/FeedbackDialog.tsx`
- `src/components/conversation/messages/InlineArtifactCard.tsx`
- `src/components/layout/ProfileMenu.tsx`
- `src/components/conversation/WelcomeEmptyState.tsx`

允许保留容器：

- `ConversationWorkbench`
- `ChatTranscript`
- `PromptComposer`
- `MediaWorkbench`

但这些容器只做状态编排和布局，不承载所有细节。

## 14. 分阶段开发切片

### M54-A0 图像参考测试定义

目标：把本文件转成测试文档和 fixture。

交付：

- `local-real-mvp-m54a-frontend-workbench-test-plan.md`
- 参考图验收矩阵。
- 浏览器检查脚本或 Playwright 场景列表。

### M54-A1 输入与滚动

范围：

- Enter/Shift+Enter。
- 发送后清空。
- 自动滚到底部。
- 输入框自适应。

验收参考：R09、R12。

### M54-A2 Composer 工具与附件

范围：

- 模型菜单。
- 上传入口。
- 文件卡。
- 拖拽覆盖态。
- 粘贴截图。

验收参考：R05、R13。

### M54-A3 消息操作与生成态

范围：

- `GeneratingIndicator`。
- hover/focus actions。
- 复制反馈。
- feedback dialog。

验收参考：R07、R08、R09、R11。

### M54-A4 Quick Replies 与确认卡

范围：

- 2-3 个快捷选项。
- 推荐项。
- 点击填输入框。
- 需求确认卡。

验收参考：R10。

### M54-A5 首页、左侧栏、头像菜单

范围：

- `WelcomeEmptyState`。
- 品牌 logo。
- `ProfileMenu`。
- 左侧展开/收起。
- 搜索聚焦。
- 无价值按钮隐藏/降级。

验收参考：R02、R03、R04、R06。

### M54-A6 右侧糖葫芦与成果卡

范围：

- 糖葫芦稳定可见。
- 对话内成果卡 compact/expanded。
- 右侧详情打开时布局压缩。
- resize 性能。

验收参考：R01、R02。

## 15. 验收矩阵

| 用户诉求 | 覆盖阶段 | 必须验证 |
| --- | --- | --- |
| 页面全部展开 | A6 | 左、中、右三栏同时可见，不重叠。 |
| 左侧收起 | A5 | 收起后主对话扩大，恢复入口可用。 |
| 头像菜单 | A5 | 点击头像打开菜单，菜单项不泄露敏感信息。 |
| 进入后的样子 | A5 | 欢迎态、品牌、推荐任务可见。 |
| 模型切换和上传材料 | A2 | 菜单可打开，未接能力不伪装。 |
| 第一次拿到网站 | A5 | 首屏不是空白，不是营销页。 |
| 反馈入口 | A3 | 点赞/点踩/反馈弹窗可用。 |
| 悬浮交互 | A3 | hover/focus 出现操作，键盘可达。 |
| 流式/生成提示 | A3 | 生成中有稳定反馈，不跳动。 |
| 每条回复 2-3 个快捷指令 | A4 | 点击只填输入框，不自动发送。 |
| 精致 generating 交互 | A3 | 等待态视觉低噪声、稳定。 |
| 输入框自适应 | A1 | 超过阈值后内部滚动。 |
| 拖拽文件到输入框 | A2 | 拖入时覆盖态，松手后附件卡。 |
| 粘贴截图到输入框 | A2 | 出现图片附件卡，状态准确。 |
| 糖葫芦不能消失 | A6 | 桌面可见，窄屏有入口。 |
| Markdown 好好渲染 | A6 | 标题、列表、加粗、表格基础可读。 |
| 普通聊天不触发产物 | A4 + M54-B | 问候只自然回复，无产物卡。 |
| 业务需求才进入确认 | A4 + M54-B | 明确备课需求显示确认卡，未确认不生成。 |

## 16. 测试要求

基础命令：

```text
npm test
npm run build
git diff --check
```

浏览器验收：

- 桌面 1440px。
- 窄屏 390px。
- 三栏展开。
- 左侧收起。
- 右侧详情打开。
- 输入发送和自动滚动。
- 拖拽文件。
- 粘贴截图。
- hover message actions。
- feedback dialog。
- quick reply 填输入框。
- 普通聊天。
- 模糊需求。
- 明确需求。
- 确认生成。

红线扫描：

- 不出现工程词。
- 不出现假按钮。
- 未解析附件不说已理解。
- 未接真实 streaming 不说正在流式输出 token。
- 未生成真实产物不说已完成交付。

## 17. 当前缺口

当前 M54-A 路线图已经覆盖大方向，但还需要按本规格补：

- 详细测试定义。
- 参考图验收矩阵。
- 品牌 logo 资产规范。
- streaming/staged generating 的真实边界。
- feedback 的服务端持久化实现与上线验收；产品决策已经由 `docs\product\beta-feedback-requirements.md` 固定。
- 模型切换与 provider 状态的后端接口边界。
- Markdown renderer 的最终选型。

这些补齐后，才能进入正式开发切片。
