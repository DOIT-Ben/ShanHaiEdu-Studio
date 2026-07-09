# M56 真实交付端到端验收报告

## 验收对象

- 项目：M56真实验收-六年级百分数导入课
- 项目 ID：`cmrce1vm100004cezv6ffofur`
- 本地地址：`http://127.0.0.1:3132`
- 验收记录：`.tmp\m56-real-delivery\m56-cmrce1vm100004cezv6ffofur-acceptance-record.json`

## 真实产物

- 12 页 PPTX：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\local-real-mvp-mainline\artifact-storage-root\coze-ppt-artifacts\cmrce1vm100004cezv6ffofur-1783533955136-grade6_math_percentage_intro.pptx`
- 课堂视觉图：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\local-real-mvp-mainline\artifact-storage-root\image-artifacts\cmrce1vm100004cezv6ffofur-1783534001475-classroom-visual.png`
- 1 分钟导入视频：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main\.tmp\m56-real-delivery\m56-cmrce1vm100004cezv6ffofur-intro-video-ffmpeg-60s.mp4`
- 最终材料包：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main\.tmp\m56-real-delivery\m56-cmrce1vm100004cezv6ffofur-final-package.zip`

## 验证结果

- PPTX 结构校验：通过，`ppt/presentation.xml` 存在。
- PPTX 页数：12 页。
- PPTX 大小：41056 bytes。
- 图片格式：PNG，1857604 bytes。
- 视频格式：MP4，1280x720，30fps，60.000000 秒。
- 最终 ZIP 内容：`README.md`、`final-delivery.md`、`ppt-outline.pptx`、`classroom-visual.png`、`intro-video.mp4`。
- 最终 ZIP 大小：3801975 bytes。

## 重要说明

项目内视频 provider smoke 返回失败，原因是视频任务失败；`mmx` 视频生成通道也返回 Token Plan 用量上限。本次为满足 1 分钟真实 MP4 交付，使用已真实生成的课堂视觉图通过本地 ffmpeg 合成 60 秒导入视频，并把该 MP4 写入项目 artifact 记录。该视频是可播放真实文件，不是 placeholder；但不是远端视频生成 provider 直接出片。

## 代码修复摘要

- 主 Agent 外部能力不再保存 `placeholder: true` 成功产物。
- PPTX、图片、视频能力改为真实 provider 或明确失败。
- Coze PPT 生成请求改为 12 页。
- 前端 mapper 过滤 `placeholder`、boolean、object 等工程字段。
- 最终包只选择包含真实 `cozePptx` 存储的 PPTX artifact，不再把文本大纲 fallback 当最终 PPTX。

## 待补风险

- 远端视频 provider 当前不可用或配额不足，需要补充可用额度或切换正式视频 provider 后重跑。
- ffmpeg 合成视频满足 1 分钟 MP4 验收，但视觉动态复杂度有限，需要人工确认是否满足公开课使用预期。
