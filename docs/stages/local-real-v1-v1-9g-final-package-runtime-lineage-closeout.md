# V1-9G 最终包真实 Runtime 来源门收尾

更新时间：2026-07-13

状态：`done / target localhost staging verified`

## 1. 阶段结论

V1 最终包现在会对 `requirement_spec`、`lesson_plan`、`ppt_design_draft` 和 `video_script_generate` 四类语义源执行真实 Runtime 来源门。四者必须同时具备 `generationMode=model_generated`、`providerStatus=real`、`runtimeKind=openai`；deterministic、degraded、非 OpenAI 或缺少来源证据的草稿均不能进入真实 ZIP。

本阶段保留 `FallbackAgentRuntime` 作为可查看、可编辑、可重试的兼容草稿能力，没有把降级草稿伪装成真实完成，也没有改变 PPTX、图片和视频各自的文件真实性、Provider、HumanGate、Critic 与 Quality Gate。

## 2. 实现与本地验证

- 新增 `FinalPackageInputContract` 的语义来源断言，字段来自服务端 Capability Runner 封装，不采信模型正文自报。
- 红灯证明四类 deterministic 语义源在修复前均可错误成包；修复后专项 23/23 通过。
- 完整验证：Node 271/271、Vitest 119 文件 849/849、生产构建 14/14 页面、`git diff --check` 通过。
- 精确实现提交：`ea84cd2`；目标镜像：`sha256:419252b6899ef71c4daf14b6745280881b7cd47942b823d081bfeddddefd2cc8b`。

## 3. 目标服务器证据

| 门禁 | 结果 |
|---|---|
| 一次性生产预检 | 新镜像 15/15 为 `ok=true`，覆盖密码认证、可信代理、单实例、关闭注册、外置 SQLite/Artifact 和五类 Provider 配置 |
| 常驻运行 | `shanhai-edu-studio:v1-9g-ea84cd2` 接管 `127.0.0.1:3210`，单容器、非 root、Docker healthy、重启次数 0 |
| 应用边界 | health=200；未认证项目接口沿用切换前的资源隐藏语义 404；公开注册=403 |
| 数据完整性 | SQLite `integrity_check=ok`、密码管理员=1；数据库和 Artifact 摘要在切换前、切换后和重启后保持一致 |
| 重启复验 | 重启后 Docker healthy、health=200、项目=404、注册=403，生产预检仍为 15/15 |
| 既有服务 | nginx 配置通过；根站和 3001 为 200；3010 继续监听；未切公网流量 |
| 回退点 | `v1-10f-098e651` 镜像保留，并按原运行合同重建停止态回退容器；共享数据不随代码回退 |

## 4. 切换偏差与处理

首次切换沿用了应用 HTTP 健康检查，但新镜像本身没有内置 Docker `HEALTHCHECK`；因此应用已返回 200 时，Docker 层仍只显示 running。随后按上一常驻容器的正式健康检查参数重建 V1-9G 容器，Docker 状态转为 healthy。

首次 90 秒回退脚本与健康检查纠正发生时间重叠，旧 `098e651` 容器实例被移除，但不可变镜像、受限配置和共享数据均未删除或改写。已用同一用户、端口、挂载、重启策略和健康检查合同重建停止态回退容器，并再次验证 V1-9G 重启与数据摘要。后续发布脚本应把“HTTP 就绪”和“Docker Health 状态”统一为一个串行切换事务，禁止并发启动第二个纠正流程。

## 5. 边界与下一步

- 未调用真实 PPT、图片、视频或 TTS Provider，未越过教师 HumanGate。
- localhost staging 不是公网上线；未修改 nginx、域名、证书或 80/443 流量。
- 真实项目仍停在 `requirement_spec` 的 19 步计划确认门。必须由真实教师在产品内确认或自然语言修改，外部 Codex 不代点、不选样张、不选视频创意、不批准课程锚点或返修范围。
- 教师确认后，由产品 Main Agent 独立执行唯一一次 V1-9 真实 PPTX、完整 MP4 和版本一致 ZIP E2E；外部 Codex 只在成包后做黑盒验收与责任层归因。
