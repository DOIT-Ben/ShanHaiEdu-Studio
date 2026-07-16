# V1 Stage 5：版本一致的真实最终包测试计划

日期：2026-07-12

状态：accepted

| ID | 场景 | 通过标准 |
|---|---|---|
| 5-01 | `ClassroomRunSpec` | 视频结束、PPT 起始页、教师提问、互动和答案揭示顺序明确且不冲突 |
| 5-02 | 文件缺失或哈希不符 | 写 ZIP 前阻断，不留下伪成功包 |
| 5-03 | PPTX/PDF 页数 | 从真实文件分别验证为 12 页 |
| 5-04 | MP4 | ffprobe 证据为 H.264/AAC、约 18 秒、24fps，且 SHA-256 与输入一致 |
| 5-05 | 错版本混包 | 任一 `courseVersionId`、课程锚点或审核批次不一致即阻断 |
| 5-06 | preview/degraded/stale | 任一输入非 `final_eligible` 即阻断 |
| 5-07 | ZIP 反向校验 | 必需条目存在，逐文件字节和 SHA-256 与内部 manifest 一致 |
| 5-08 | 教师签收边界 | integration review 允许生成候选包，但 manifest 必须标记 `teacherSignoff=false`，不能宣称 V1 上线 |

集中验证：聚焦单测、`npx tsc --noEmit`、`npm run build`、ZIP 解压复核、`git diff --check`。
