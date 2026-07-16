# M56 真实交付端到端验收计划

## 1. 第一性原理需求

本阶段目标不是演示占位链路，而是验证 ShanHaiEdu 能否产出一套老师可验收的真实交付物：12 页 PPTX、约 1 分钟导入视频、课堂图片素材和最终交付记录。任何 placeholder、deterministic draft、最小 PPTX fallback 都不能冒充完成交付。

成功标准：产物文件真实存在、格式可验证、项目内有 artifact/generation job 记录、页面不展示工程字段、最终包不把占位包装成最终成果。

## 2. 可复用方案

项目已有可复用模块：

- `coze-ppt`：真实 PPTX provider adapter，已能 smoke 生成有效 PPTX。
- `image-generation`：真实图片 provider adapter，已能 smoke 生成有效 PNG。
- `video-generation`：真实视频 provider adapter，当前 smoke 失败，需作为真实验收失败点或切换可用视频通道。
- `artifact-storage`：本地保存真实文件并记录相对路径。
- `generation-jobs`：记录真实生成任务状态。

## 3. 复用与适配

本阶段优先复用现有 provider adapter，不新增外部协议。需要补齐的是主 Agent 能力执行层：`coze_ppt`、`image_asset`、`intro_video` 不再返回成功占位，而是调用真实 provider；失败时返回失败状态并记录 job 失败。

前端只展示教师可读字段，过滤 `placeholder`、`storage`、`generationMode`、`providerStatus` 等工程字段。最终包只使用真实 PPTX，不再把文本大纲即时 fallback 成最终 PPTX。

## 4. 落地方案与验证

实施步骤：

1. 修复 Coze PPT prompt 页数为 12 页。
2. 将主 Agent 外部能力接入真实 PPTX、图片、视频 provider。
3. 移除图片/视频占位成功路径；provider 失败即失败，不保存成功 artifact。
4. 修复 artifact mapper，禁止工程字段和 boolean/object 值进入教师可见内容。
5. 修复最终包下载，要求真实存储 PPTX。
6. 跑真实 smoke：PPT、图片、视频。
7. 创建真实项目，任选课题生成 12 页 PPTX 和约 1 分钟导入视频，保存验收记录。

风险：视频 provider 当前 smoke 失败；如果项目内视频 provider 不可用，必须记录失败并使用可用替代生成通道生成真实 MP4 后写入项目记录，不能伪装项目 provider 成功。

验证命令：`npm test`、`npm run build`、`git diff --check`、`graphify update .`、真实 API/browser 验收。
