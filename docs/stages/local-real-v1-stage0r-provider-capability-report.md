# ShanHaiEdu V1 Stage 0R Provider 与交付工具能力探测报告

更新时间：2026-07-12

状态：`0R-05 completed / 0R-06 completed as a blocked old-flow baseline`

关联计划：

- `docs\stages\local-real-v1-quality-release-mainline-plan.md`
- `docs\stages\local-real-v1-quality-release-mainline-test-plan.md`
- `docs\stages\local-real-v1-stage0r-local-gates-closeout.md`

## 1. 目标与判定边界

本轮只回答两类问题：

1. 当前 checkout 的真实 OpenAI-compatible、图片、PPT、视频、渲染、FFmpeg 和产物存储是否可调用。
2. 当前最小 smoke 产物是否已经达到可授课交付质量。

`API 请求成功`、`文件存在`、`PPTX/MP4 格式有效`与`可授课`是四个不同结论。本报告不得用前三级证据替代第四级质量验收。

## 2. 基线

- checkout：`main`
- HEAD：`a6c11b8e390ca19e327b652f24e6760a204334ce`
- OpenAI、Coze、图片、视频、存储和数据库配置存在；凭据未写入报告。
- smoke、生产预检和存储相关契约测试：35/35 通过。
- `FFmpeg 7.1.1`、`ffprobe 7.1.1`、`LibreOffice 26.2.3.2` 可执行。
- 配置的产物存储根完成真实 7 字节写入、读取属性和清除探针。

## 3. 真实能力结果

| 能力 | 真实结果 | 耗时 | 实物证据 | 技术判定 | 交付质量判定 |
|---|---|---:|---|---|---|
| Agent Brain | fallback 台账通道、`gpt-5.5` 返回模型生成的结构化结果 | 5.65 秒 | smoke 输出 `generationMode=model_generated` | 通过 | 仅证明最小请求；应用内 60 秒回退仍需单独定位 |
| 图片 | `free / gpt-image-2` 生成有效 PNG | 48.56 秒 | `.tmp\image-smoke\m18-1783793781613-percentage-intro.png`；1,540,765 bytes | 通过 | 不通过；“打八折”与“优惠 10%”并置，数学语义和任务指向存在歧义 |
| Coze PPT | `/run` 返回并下载有效 PPTX | 24.33 秒 | `.tmp\coze-ppt-smoke\m16-1783793835990-sujiao_grade6_percentage_intro.pptx`；28,558 bytes | 格式通过 | 不通过；只有 1 页、0 个媒体文件，渲染后标题重叠且页面大面积空白 |
| 视频缓存恢复 | 复用已有 taskId 查询并下载有效 MP4 | 8.89 秒 | `.tmp\video-smoke\m20-1783793958673-intro-video.mp4`；1,379,460 bytes | 查询/下载通过 | 不通过；仅为普通课堂教师镜头，无生活情境和百分数锚点 |
| 视频新提交 | 新 submit、轮询、下载完成 | 87.13 秒 | `.tmp\video-smoke\m20-1783794134529-intro-video.mp4`；1,477,459 bytes | 提交链路通过 | 不通过；回到教师直接讲授，黑板文字与符号漂移，未形成独立创意任务 |
| PPT 渲染 | PPTX 经 LibreOffice 转为 PDF，Poppler 渲染 PNG | 约 6 秒 | 1 页 PDF、1 张 PNG | 通过 | 渲染证实 PPT 质量问题，不是合格课件 |
| 视频媒体检查 | ffprobe、首中尾帧抽检、完整解码 | 约 3 秒 | 6.041667 秒、752x416、24fps、H.264、AAC 双声道 | 通过 | 编码合格，课程叙事和文字可靠性不合格 |
| Artifact storage | 配置根真实写入并删除探针 | 小于 1 秒 | 写入 7 bytes，探针清除成功 | 通过 | 只证明本机存储，不证明目标服务器共享卷和恢复能力 |

真实 API 均未返回可核算的 token、图片、PPT 或视频账单字段，因此本轮只能记录调用次数与耗时，实际成本保持 `unknown`，不得填估算值冒充真实成本。

## 4. 生产预检结果

`npm run preflight:production` 按预期失败，当前 `.env` 仍是本地运行配置。未关闭项：

1. 缺少构建期 `NEXT_PUBLIC_SHANHAI_AUTH_MODE=password`。
2. 缺少 `SHANHAI_TRUST_PROXY=1`。
3. 公网注册的客户端开关未明确关闭。
4. `DATABASE_URL` 仍是相对 SQLite 路径，不是 release 外的绝对生产路径。
5. 生产 SQLite 中的有效管理员未验证。

Provider 配置检查和 release 外 Artifact storage 检查通过。以上失败项属于 Stage 6 发布门，本轮不擅自修改生产配置或初始化生产账号。

## 5. 对工作流优化的直接结论

1. **必须拆分技术完成与质量完成。** Provider 返回和文件格式验证只能进入 `preview_only`，不能直接进入 `final_candidate` 或 `final_eligible`。
2. **PPT post-contract 必须读取真实文件。** 至少确定性校验页数、媒体数、可编辑文本、渲染页数、空白率、溢出和重叠；当前 smoke 的 `pptxValid=true` 明显不足。
3. **图片需要数学语义 Validator。** 折扣、优惠幅度、现价比例等概念不能只交给视觉模型自检；生成图片中的可读文字和数字默认不可信。
4. **视频需要 Director/ShotSpec，而不是单段宽泛 prompt。** 必须先决定故事导入或讲解视频，检查课程锚点、镜头功能、首尾帧、可读文字策略和禁止项；当前模型自动回到了通用教师讲课模板。
5. **精确文字与数学信息应后期确定性叠加。** AI 视频和底图优先留出干净区域，黑板文字、价格、百分数、字幕和公式由可编辑 PPT 层或视频 overlay 生成。
6. **成本观测需要进入 Job/Provider ledger。** 每次 submit、poll、download、重试和恢复必须记录 providerTaskId、耗时、是否重复提交和账单字段；账单缺失时明确标记 unknown。

## 6. Stage 0R 当前结论

- `0R-01` 至 `0R-05` 已有本轮或前序新鲜证据。
- `0R-05` 的结论是“真实能力可调用，但 PPT、图片和视频 smoke 交付质量均不合格”，不是“交付链路已通过”。
- `0R-06` 已用固定教师任务运行到真实阻断点：应用 PPTX 失败后改道，真实课堂图片成功，视频文本链生成到资产说明，视频资产图失败且未进入 GenerationJob；片段计划、视频和最终包因此没有执行。
- 旧流程完整耗时、错误、人工确认、质量评分和 Replan 证据见 `docs\stages\local-real-v1-stage0r-old-flow-baseline-report.md`。
- Stage 0R 已形成可信对照，可以进入 Stage 1A；这不代表 V1 已上线，也不关闭任何真实交付和发布门禁。

## 7. 下一步

进入 Stage 1A：执行身份、项目写租约、意图版本栅栏、幂等和 Provider Job 恢复。Stage 1A 验证必须复用本轮两个失败断点：PPTX 通道选择不一致，以及 `asset_image_generate` 失败未进入 GenerationJob。不得先用提示词优化掩盖执行安全和恢复缺口。
