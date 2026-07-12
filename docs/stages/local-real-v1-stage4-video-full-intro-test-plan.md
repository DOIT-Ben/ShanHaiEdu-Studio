# V1 Stage 4：视频 Full Intro 测试计划

日期：2026-07-12

状态：accepted

| ID | 场景 | 通过标准 |
|---|---|---|
| 4A-01 | 缺课程锚点、shotId 或连续性字段 | 合同门精确拒绝 |
| 4A-02 | Short Preview 进入最终包 | 稳定阻断 |
| 4A-03 | PPT 资产或总览作为视频参考 | assetDomain/lineage 门失败 |
| 4B-01 | 三个 shot 提交 | 每个拥有独立 inputHash/taskId/attempt |
| 4B-02 | providerTaskId 已存在 | 只 poll，不重复 submit |
| 4B-03 | 单 shot 失败或返修 | 仅目标 shot 失效，其他 clip hash 不变 |
| 4B-04 | 连续性 shot | 请求记录真实参考 assetId/hash |
| 4C-01 | clip 编码不一致 | 归一化后才可合成 |
| 4C-02 | FFmpeg 成片 | ffprobe、TimelineManifest、镜头数和时长一致 |
| 4C-03 | 答案泄露/字幕错误/音轨问题 | Critic 定位 shotId 或 track 并阻断交付 |
| 4C-04 | 桌面和 390px | 可查看镜头状态、问题定位和局部返修，无工程词或溢出 |

集中门禁：`npm test`、`npx tsc --noEmit`、`npm run build`、`npm run db:init` 两次、`git diff --check`。

真实验收还必须执行真实 Provider 三镜头、FFmpeg/ffprobe、故障恢复和教师审查；fixture 不得替代这些证据。
