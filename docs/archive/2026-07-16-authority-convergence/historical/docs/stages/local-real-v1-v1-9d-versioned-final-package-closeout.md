# V1-9D 版本一致最终包主路径收尾

更新时间：2026-07-13

## 1. 阶段结论

V1-9D 工程门禁已完成。`create_final_package` 的生产主路径已停止调用旧材料包生成器，统一改为版本化最终包：只有同一课程版本、同一课程锚点、同一审查批次且均已批准的教案、PPTX、PDF、课堂视觉图和最终视频才能进入 ZIP。

本结论只表示版本化最终包合同、主路径和自动化验证完成，不表示产品内真实 E2E、真实教师签收或 V1 发布门已经完成。

## 2. 已完成能力

- Main Agent 只提出 `classroom-run-spec-draft.v1` 的课堂运行顺序，不得自报课程版本号或审查批次。
- 服务端根据来源 Artifact 的 id、kind、version 和 digest 确定性计算 `courseVersionId`。
- 服务端根据 PPT 完整包/Review 与视频 Final Review/Approval 证据确定性计算 `reviewBatchId`。
- PPT 最终资格必须形成有效 Candidate、`ppt-full-deck-review.v1`、一致 candidate digest、一致 Review QA 和 Sealed Package QA。
- 视频最终资格必须存在五类成片证据、通过的成片 Review 和绑定同一 evidence digest 的教师批准。
- 最终 ZIP 必须且只能包含教案、PPTX、PDF、课堂视觉图、最终 MP4、`manifest.json` 和 `classroom-run-spec.json`。
- manifest 记录每个文件的来源 Artifact id/version/digest、真实文件 SHA-256、课程版本、课程锚点和审查批次。
- ZIP 生成后会反向打开并复核角色、文件大小、SHA-256 和 ClassroomRunSpec 绑定。
- 视频组装成功文案已同步 V1-9C 事实：受控音轨与字幕证据已经形成，下一步是成片 Critic，而不是继续等待字幕或转写。

## 3. 阻断行为

以下情况均会在最终 Artifact 保存前失败：

- Main Agent 未提供课堂运行顺序或擅自改变已批准课程锚点。
- 视频、唯一回接问题、打开 PPT、教师组织教学、最后揭示答案的顺序或角色绑定错误。
- 来源 Artifact 跨项目、重复、未批准或版本不一致。
- PPT Candidate、Review、QA、Package digest 任一不一致或被篡改。
- 视频成片 Review、教师批准或五类证据不完整。
- PPTX、PDF、图片、视频缺失，存储路径无效或文件 SHA-256 不一致。
- ZIP manifest、ClassroomRunSpec 或内部文件被篡改。

## 4. 验证证据

| 验证项 | 结果 |
|---|---|
| TypeScript | `npx tsc --noEmit` 通过 |
| V1-9D 专项 | 4 个文件，`50/50` 通过 |
| Node 全量 | `259/259` 通过 |
| Vitest 全量 | 116 个文件，`831/831` 通过 |
| 生产构建 | 通过，生成 `13/13` 静态页面 |
| Diff | `git diff --check` 通过 |
| 旧主路径 | `package-tool-adapter.ts` 中旧打包器生产引用为 0 |
| 敏感信息 | V1-9D diff 密钥模式扫描 0 命中 |
| 资源残留 | Vitest/Jest worker 0；保留两个早于本轮存在的 Playwright CLI 守护进程 |

生产构建保留 5 条 Turbopack 动态文件匹配警告，涉及既有本地 Artifact Storage、PPT Full Deck Renderer 和 Feedback Storage 动态路径。它们未造成编译失败，本阶段未扩张处理。

## 5. 未执行与剩余风险

- 本阶段未调用真实文本、图片、PPT 或视频 Provider。
- 本阶段未从教师 UI 启动产品内真实 E2E。
- 尚未证明产品 Main Agent 在真实运行中能够自主形成并保留 `classroomRunSpecDraft`，再经 HumanGate、Critic 和 Quality Gate 生成最终包。
- 尚未执行最终真实交付包的外部黑盒审核和真实教师签收。
- 目标服务器共享卷、重启、回滚、备份恢复和公开注册关闭复核仍属于后续发布门。

## 6. 下一恢复点

进入 V1-9 唯一一次产品内真实 E2E。必须从教师 UI 启动，由产品 Main Agent 自主规划、调用 Tool、形成课堂运行顺序、处理 Observation/Replan，并等待产品内 HumanGate 与 Quality Gate。外部 Codex 不选择创意、不批准课程锚点、不批准 PPT 样张、不决定返修范围，只在最终包形成后进行黑盒审核和责任层归因。

若真实 E2E 中 Main Agent 未形成或未保留 `classroomRunSpecDraft`，应先把失败归因到 Main Agent 输出合同、Tool Input 传递或持久化恢复层，不得由外部 Codex 手工补写课堂运行顺序绕过问题。
