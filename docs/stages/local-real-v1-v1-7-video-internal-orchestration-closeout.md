# ShanHaiEdu V1-7 视频产品内编排闭环收尾

更新时间：2026-07-13

状态：`done`

## 1. 完成内容

- 复用既有 Video Director 与课程锚点六硬门，没有重复实现已有合同。
- `course_anchor` Critic 报告现在会形成绑定当前创意版本、Rubric、generator invocation 和 critic invocation 的正式审查 Artifact。
- `video_final_review` 新增九项硬门：独立可理解、独立观看价值、非教材/PPT复述、唯一最小课程锚点、受众不约束故事世界、不泄露答案、镜头时间线连续性、字幕/转写完整性、音轨完整性。
- 成片审查必须具备实际 MP4、时间线、采样帧、字幕或转写、音轨五类证据；缺失时拒绝持久化通过结论。
- 成片 finding 只接受当前候选中的 shot、frame range、track 或 timeline；不存在的 `shotId` 和越界 Artifact 稳定拒绝。
- Main Agent 被明确约束为先独立创意、再课程锚点 Critic、再教师批准；六硬门失败时不得提出媒体生产。
- Main Agent 的 `inputDraft.shotIds` 已贯通 ConversationTurnService、ToolRouter 和 ProviderToolAdapter，支持后续按镜头执行。
- Workbench HumanGate 会阻止未审查或审查失败的创意和成片被批准；通过后生成独立的课程锚点批准或成片批准证据。
- OpenAI Critic Executor 获得阶段化硬门和证据指令，避免只依赖后端拒绝错误输出。

## 2. 验证证据

| 门禁 | 结果 |
|---|---|
| V1-7 专项 | 10 文件，150/150 通过 |
| TypeScript | `npx tsc --noEmit --pretty false` exit 0 |
| Node | 259/259 通过 |
| 完整 Vitest | 随 `npm test` 完整运行正常完成；终端尾部摘要被截断 |
| 生产构建 | exit 0，13 个静态页面；保留 4 条既有动态文件追踪性能警告 |
| SQLite | `npm test` 初始化隔离 `.tmp\test-workbench.db`，正式审查、HumanGate 和 VideoShot 持久化测试通过 |
| diff | `git diff --check` exit 0 |
| 浏览器 | 本阶段无 UI 改动，不适用；未把未执行项记录为通过 |

## 3. 关键边界

- 未调用真实图片、视频、拼接或最终包 Provider，未生成新真实交付包。
- 外部 Codex 没有选创意、批准课程锚点或决定返修镜头。
- V1-7 证明产品内视频决策、审查、HumanGate 和局部返修输入闭环，不证明当前 `Buffer.concat` 能形成最终可靠时间线。
- 当前真实成片工具尚不会自动产出五类 `videoFinalReviewEvidence`；该真实媒体证据采集和 FFmpeg/ffprobe 收口属于 V1-9 实际 E2E 前必须关闭的缺口。
- 音轨、字幕或时间线 finding 可以形成结构化返修计划，但当前 V1 业务 Tool 主要完成镜头级生成；专用后期执行能力不得伪装成已实现。
- JSON reporter 摘要提取器在 Windows 子进程启动阶段失败，未执行测试；已停止重复等价尝试，不影响此前成功的 `npm test` 和专项证据。

## 4. 下一阶段

进入 V1-8 两用户并发与恢复：验证两个邀请账号在不同项目同时运行 Main Agent 时，项目、对话、强度快照、租约、任务、Provider taskId、费用事件和产物完全隔离；不得用全局串行锁规避并发。
