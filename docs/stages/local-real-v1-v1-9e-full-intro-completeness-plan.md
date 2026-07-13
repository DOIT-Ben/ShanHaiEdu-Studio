# V1-9E Full Intro 叙事完整性与时长闭环计划

更新时间：2026-07-13

## 1. 目标

在唯一一次产品内真实 E2E 前，关闭“真实 MP4 技术通过但只有少量镜头、时长过短、信息量不足”的已知缺口。Full Intro 的镜头数量仍由产品 Video Director 根据内容决定，不把三镜头或固定时长写成永久产品上限；但结构化分镜必须声明目标总时长，真实 Provider 必须消费逐镜头时长，最终组装必须覆盖当前 Storyboard 的全部镜头，并由产品内成片 Critic审查叙事完整性与节奏。

本阶段不调用真实媒体 Provider，不由外部 Codex 选择视频创意、镜头数量、课程锚点、返修范围或教师批准。

## 2. 已知根因

1. 当前 Full Intro 只要求至少三个镜头，没有目标总时长与镜头时长总和的一致性合同。
2. `ResolvedShotVideoRequest` 没有携带 `ShotSpec.durationTargetRange`，Provider 始终读取环境默认 6 秒。
3. `concat_only_assemble` 不要求 Storyboard，无法证明所有计划镜头均有且仅有一个当前批准片段。
4. 成片 Critic有连续性、字幕和音轨硬门，但没有独立的“叙事完整性与节奏”硬门。

## 3. 设计

### 3.1 保留 Director 自由度

- `VideoIntent` 增加 `targetDurationRange`，Full Intro 默认由 Runtime 指导为 30-60 秒；教师明确要求时可在 V1 安全范围 30-90 秒内调整。
- 不固定全局镜头数；三镜头可以成立，但必须通过更长的可执行 ShotSpec 覆盖目标总时长。更多短镜头也可以成立。
- Validator 只检查不可绕过的一致性：目标范围合法、逐镜头时长区间与目标范围存在可行解、每个镜头时长在 Provider Profile 6-30 秒能力内。

### 3.2 逐镜头执行

- `ResolvedShotVideoRequest` 携带当前镜头的目标时长范围与本次解析出的 `durationSeconds`。
- 服务端从各镜头最小时长开始，按 Storyboard 顺序只补足达到目标最低总时长所需的秒数；既不生成短于目标的成片，也不无故选择更贵的最大时长。任何结果仍须落在 Provider Profile 6-30 秒范围。
- Provider 请求和结果 `requestEvidence` 同时记录 `shotId` 与实际请求时长，便于恢复和审计。

### 3.3 全分镜组装

- `concat_only_assemble` 新增已批准 `storyboard_generate` 必需输入。
- 组装前验证当前 Storyboard 合法，并要求每个 `shotId` 恰好对应一个已批准片段；缺镜头、重复镜头、额外镜头或 ordinal 不一致全部阻断。
- 成片实际时长必须落在 Storyboard Full Intro 目标范围的技术容差内；不得把短预览或残缺片段组装成最终视频。
- 成片证据持久化 Storyboard digest、目标时长范围、完整 shot 清单和实际总时长。

### 3.4 产品内审查

- 成片 Critic增加 `narrative_completeness_and_pacing` 硬门。
- Critic必须读取时间线、真实字幕/转写、采样帧与音轨，判断开场钩子、目标/阻碍/变化、结尾悬念和唯一课程回接是否构成完整可观看短片。
- 技术时长合格不自动等于叙事通过；Critic失败必须定位到 shot、frame range、track 或 timeline，由 Main Agent 决定最小返修。

## 4. 范围

- 更新 VideoIntent、Storyboard Schema、Validator 和 Runtime 提示。
- 更新单镜头解析、Provider 请求体和 request evidence。
- 更新 concat Tool 前置、全镜头覆盖和时长校验。
- 更新成片 Critic硬门与提示。
- 更新相关夹具和回归测试。

## 5. 风险与回退

- 风险：旧 Storyboard 缺少目标时长，将不能继续进入 V1 最终成片；这是正确失效，不做隐式默认补字段。
- 风险：更长视频意味着更多镜头或更长单镜头，真实 Provider 积分消耗会上升；每个真实镜头仍须 HumanGate，不能自动无痕扩张。
- 风险：Provider 实际输出时长存在少量漂移；最终校验使用受控技术容差，不放宽到可掩盖缺镜头。
- 回退：本阶段独立提交，可整体 revert；不修改数据库结构、历史 tag 或真实 Provider 密钥。

## 6. 退出标准

- Full Intro 无目标总时长、时长总和覆盖不足或单镜头超出 Provider 能力时稳定拒绝。
- 每个真实视频请求的 duration 来自当前 ShotSpec，而不是无条件使用全局 6 秒。
- 组装缺失任一 Storyboard 镜头时 Tool 调用次数为 0，且不保存成功成片。
- 成片实际时长与目标范围一致，并形成可供 Critic读取的完整证据。
- 成片 Critic包含叙事完整性与节奏硬门。
- 专项、TypeScript、Node、Vitest、生产构建和 diff 检查全部通过后，才进入产品 UI 真实 E2E。
