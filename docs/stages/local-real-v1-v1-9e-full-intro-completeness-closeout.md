# V1-9E Full Intro 叙事完整性与时长闭环收尾

更新时间：2026-07-13

## 1. 阶段结论

V1-9E 工程门禁已完成。产品不再把“技术上可播放的少量短镜头”当作完整导入视频：Full Intro 必须由 Video Director 声明目标总时长，服务端验证镜头时长区间存在可行解并确定性分配实际请求时长，最终组装必须覆盖当前 Storyboard 的全部镜头，成片 Critic必须独立审查叙事完整性与节奏。

本阶段没有调用真实 Provider，也没有替产品 Main Agent选择镜头数、创意、课程锚点或返修范围。完成的是唯一一次真实 E2E 前的产品内合同和门禁，不代表真实成片已经通过。

## 2. 已完成能力

- `VideoIntent` 增加 `targetDurationRange`；Full Intro V1 安全范围为 30-90 秒，Runtime默认指导 30-60 秒。
- 镜头数继续由 Director 根据叙事需要决定，不固定为三镜头；合同只要求至少三个镜头与可执行时长区间。
- 服务端验证镜头区间与目标总时长存在可行解，从各镜头最小时长开始，只补足达到目标最低总时长所需秒数。
- `ResolvedShotVideoRequest`、Provider 请求体和结果 `requestEvidence` 统一绑定 `shotId`、目标范围和实际请求秒数。
- `concat_only_assemble` 新增当前已批准 Storyboard 前置，并要求每个计划 `shotId` 恰好有一个批准片段。
- 缺镜头、重复镜头、额外镜头或非法 Storyboard 会在 TTS 与 FFmpeg 前阻断。
- 成片实际时长必须落在 Storyboard 目标范围的受控技术容差内。
- 成片证据新增 Storyboard artifact/version/digest、目标时长和完整 shot 清单。
- 成片 Critic由九硬门增加为十硬门，新增 `narrative_completeness_and_pacing`，必须审查钩子、目标/阻碍、可见变化、信息密度、结尾悬念和节奏。
- 组装成功文案已准确表述受控音轨与字幕证据已经形成，等待成片独立审查。

## 3. 验证证据

| 验证项 | 结果 |
|---|---|
| TypeScript | `npx tsc --noEmit` 通过 |
| V1-9E 核心专项 | 8 个文件，`108/108` 通过 |
| 本地真实媒体 | 三个各 10 秒 MP4 经 FFmpeg 形成满足 30 秒目标的完整成片 |
| 缺镜头失败注入 | 在 TTS/FFmpeg 调用前阻断，调用次数为 0 |
| Node 全量 | `259/259` 通过 |
| Vitest 全量 | 116 个文件，`834/834` 通过 |
| 生产构建 | 通过，生成 `13/13` 静态页面 |
| Diff | `git diff --check` 通过 |
| 敏感信息 | V1-9E diff 敏感值模式扫描 0 命中 |
| 资源残留 | Vitest/Jest worker 0 |

生产构建仍有 5 条既有 Turbopack 动态文件匹配警告，涉及 Artifact Storage、PPT Full Deck Renderer 和 Feedback Storage；未造成编译失败，本阶段未扩张处理。

## 4. 审查结论

未发现阻塞 V1-9E 提交的 P0/P1 缺陷。

本设计没有通过固定镜头数过度约束模型能力：三个长镜头、五个中短镜头或其他满足叙事与 Provider 能力的组合均可成立。服务端只负责可执行性、完整覆盖和最低交付长度，语义质量仍由产品内独立 Critic判断。

## 5. 剩余风险

- 真实 Provider 是否严格返回所请求的逐镜头时长，仍须在产品内真实 E2E 由 ffprobe 反查；若明显偏短，最终组装会阻断而不是冒充通过。
- 当前 V1 视频资产 Provider 仍主要形成一个主参考图；Storyboard 若要求多个独立必需参考资产会正确阻断，不能伪装为全部已传。
- 目标时长达标不等于内容达标，真实成片仍必须通过产品内 `narrative_completeness_and_pacing` 和其余九个硬门。
- HumanGate仍由真实教师决定；外部 Codex不得替教师批准课程锚点、PPT 样张、完整 PPT 或最终视频。

## 6. 下一恢复点

从当前提交对应的教师 UI 启动 V1-9 唯一一次真实 E2E。首先验证 Main Agent真实生成并持久化计划、专业 Agent Tool调用和第一个 HumanGate；到达需要教师判断实际候选内容的门禁时暂停等待真实教师决定。只有产品内部 Critic、HumanGate、返修与最终包全部留下真实证据后，外部 Codex才对最终 ZIP 生成只读 `ExternalAcceptanceReport`。
