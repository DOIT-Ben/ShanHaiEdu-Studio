# V1 Stage 5：版本一致的真实最终包计划

日期：2026-07-12

状态：accepted

## 目标

从已通过交付门的真实文件反向生成最终 ZIP 和 manifest，不再根据任务成功状态或数据库声明猜测文件存在。最终包至少包含结构化教案、12 页可编辑 PPTX、12 页 PDF、真实 Full Intro MP4、`ClassroomRunSpec`、文件清单和哈希。

## 现状差距

- 旧 `final_package` 只包含 PPTX、单张图片、视频和泛化清单，缺教案、PDF、课堂运行顺序和跨产物版本绑定。
- 旧 `concat_only_assemble` 使用 MP4 字节拼接，不能证明产生可播放的规范时间线；Stage 4 最终视频已改由 FFmpeg 合成。
- 旧 manifest 不记录真实 SHA-256、页数、时长、交付资格和共同课程锚点，无法阻断错版本混包。

## 实施范围

1. 建立 `ClassroomRunSpec` 和 `FinalPackageInput` 合同。
2. 对每个输入执行真实文件存在、大小、SHA-256、MIME/容器和 final eligibility 校验。
3. PPTX 从 ZIP 内部统计 `ppt/slides/slide*.xml`；PDF 读取真实页数；MP4 使用 ffprobe 证据绑定。
4. 所有材料必须共享同一个 `courseVersionId`、课程锚点和审核批次。
5. ZIP 从已验真文件反向生成，内部 manifest 记录文件名、哈希、字节、页数/时长和来源角色。
6. 教师界面仍只展示“最终材料包”和自然语言状态，不暴露 manifest、provider 或本地路径。

## 不做

- 不把集成审查冒充真实教师签收。
- 不修改 `v1` 标签，不 push、不部署。
- 不为打包补造占位教案、图片、视频或 PDF。

## 完成标准

1. 错版本、缺文件、哈希不符、PPTX 非 12 页、PDF 非 12 页、视频非 Full Intro 均在写 ZIP 前阻断。
2. ZIP 解压后包含所有必需文件，内部文件哈希与 manifest 一致。
3. 当前 `百分数的意义` 试点生成真实最终 ZIP，并保留集成审查与教师签收边界。
