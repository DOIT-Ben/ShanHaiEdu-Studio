# Local Real MVP 当前状态审计

日期：2026-07-07

## 1. 审计目标

本审计用于收口 `mainline/local-real-mvp` 在 M0-M13 后的真实状态，明确哪些能力已经通过本地验证、哪些只是 readiness、哪些仍不能宣称完成。

当前审计不新增产品能力、不变更代码、不执行部署、不 push、不删除旧 worktree。

## 2. 审计口径

第一性原理判断：

- ShanHaiEdu 本地真实 MVP 的核心，不是展示一个 mock 页面，而是让教师在本机浏览器里连续生产一节公开课的文本材料，并由后端真实保存项目、消息、节点产物和确认状态。
- deterministic runtime 可以作为开发态可验证运行时，但不能被描述为真实模型生成。
- 没有真实 provider 成功证据前，不能把 OpenAI、图片、视频或生产部署标记为完成；PPTX 只可按 M11 验收范围表述为“基于当前 PPT 大纲生成的最小可下载文件”。

本轮复用的项目内证据：

- `docs\mainlines\local-real-mvp.md`
- `docs\stages\local-real-mvp-m0-baseline-report.md`
- `docs\stages\local-real-mvp-m1-browser-loop-report.md`
- `docs\stages\local-real-mvp-m2-lesson-text-loop-report.md`
- `docs\stages\local-real-mvp-m3-ppt-outline-report.md`
- `docs\stages\local-real-mvp-m4-intro-video-report.md`
- `docs\stages\local-real-mvp-m5-final-delivery-report.md`
- `docs\stages\local-real-mvp-m6-openai-smoke-report.md`
- `docs\stages\local-real-mvp-m7-local-concurrency-report.md`
- `docs\stages\local-real-mvp-m8-browser-coverage-report.md`
- `docs\stages\local-real-mvp-m9-markdown-download-report.md`
- `docs\stages\local-real-mvp-m10-artifact-reuse-report.md`
- `docs\stages\local-real-mvp-m11-pptx-download-report.md`
- `docs\stages\local-real-mvp-m12-final-delivery-pptx-awareness-report.md`
- `docs\stages\local-real-mvp-m13-final-material-package-report.md`
- `docs\stages\local-real-mvp-m14-ledger-openai-smoke-report.md`
- `docs\stages\local-real-mvp-m15-ppt-sample-coze-readiness-report.md`
- `docs\stages\local-real-mvp-m16-coze-ppt-live-smoke-report.md`
- `docs\stages\local-real-mvp-m17-coze-ppt-artifact-adapter-report.md`
- `docs\stages\local-real-mvp-m18-image-api-live-smoke-report.md`
- `docs\stages\local-real-mvp-m19-image-artifact-adapter-report.md`
- `docs\stages\local-real-mvp-m20-video-api-live-smoke-report.md`
- `docs\stages\local-real-mvp-m21-video-artifact-adapter-report.md`
- `docs\stages\local-real-mvp-m22-video-download-route-report.md`
- `docs\stages\local-real-mvp-m23-material-package-video-asset-report.md`

## 3. 已完成能力

### 3.1 M0 基线

M0 已确认当前主线具备继续推进本地 MVP 的基础：

- 分支为 `mainline/local-real-mvp`。
- `npm test` 通过。
- `npm run build` 通过。
- `npm run test:e2e:stage2:preflight` 通过。
- 未发现测试 worker 残留。

### 3.2 M1-M5 文本主链路

M1-M5 已形成本地浏览器真实文本闭环：

```text
新建项目
-> 输入一句话需求
-> 生成并确认需求规格
-> 生成教材证据包
-> 生成公开课教案
-> 生成 PPT 大纲与逐页脚本
-> 生成导入视频方案
-> 生成最终交付清单 Markdown
```

已验证的用户可见能力：

- 产物可查看、复制、确认、重做。
- 刷新后项目、消息、节点产物和确认状态可恢复。
- 上游确认后可推进下游节点。
- 最终交付清单不伪装 PPTX、图片文件或视频成片已生成。
- 教师界面已针对 M1 暴露的内部字段做过滤修复。

最近一次 M5 验收记录显示：

- `npm test` 通过：Node 9 tests passed；Vitest 15 files / 68 tests passed。
- `npm run build` 通过。
- `npm run test:e2e:stage2` 通过：Chromium desktop 1 passed，覆盖 M1-M5 主链路。
- `git diff --check` 通过。
- 敏感信息扫描未命中密钥、token 或私钥文件特征。

### 3.3 M6 OpenAI smoke readiness

M6 已完成真实 OpenAI smoke 的门禁 readiness：

- 新增 `scripts\openai-smoke.mjs`。
- 缺少 OpenAI-compatible 凭据时脚本以非 0 退出。
- 输出包含 `missing_OPENAI_COMPATIBLE_CREDENTIAL`，不打印密钥值。
- 不允许 smoke 脚本静默回落 deterministic 冒充真实 OpenAI 结果。
- OpenAI SDK 仍只在服务端 runtime adapter 或脚本上下文使用，没有进入 React。

后续状态：

- M6 当时只完成 readiness。
- M14 已通过私有台账 fallback 通道完成 live OpenAI-compatible smoke。

### 3.4 M7 本地双上下文隔离

M7 已验证本地 1-2 人试用规模下的基础隔离：

- 两个 browser context 分别创建项目。
- A/B 上下文的消息和需求规格产物不串。
- 刷新后各自保持当前项目。
- SQLite 在本地双上下文 E2E 中未出现锁冲突或串写。

最近一次 M7 验收记录显示：

- `npm test` 通过：Node 10 tests passed；Vitest 15 files / 68 tests passed。
- `npm run build` 通过。
- `npm run test:e2e:stage2` 通过：M1-M5 单项目主链路未回归。
- `npm run test:e2e:stage7` 通过：两个 browser context 刷新后仍保持各自项目。
- `git diff --check` 通过。
- 敏感信息扫描未命中密钥、token 或私钥文件特征。

### 3.5 M8 浏览器覆盖

M8 已验证同一 M1-M5 文本主链路可在更多本地浏览器环境运行：

- `chromium-narrow`：390 x 844 窄屏视口通过完整 M1-M5 主链路。
- `firefox-desktop`：Firefox desktop 通过完整 M1-M5 主链路。
- 窄屏项目抽屉在新建或选择项目后会自动关闭，避免遮挡对话输入。
- 窄屏产物抽屉节点具备“标题，状态”的可访问名称，打开详情后会自动关闭产物抽屉。
- Stage 2 E2E 已适配桌面 rail 与窄屏抽屉两种真实路径。

最近一次 M8 验收记录显示：

- `npm run test:e2e:stage8` 通过：`chromium-narrow` 与 `firefox-desktop` 2 passed。
- `npm test` 通过：Node 10 tests passed；Vitest 15 files / 68 tests passed。
- `npm run build` 通过。
- `npm run test:e2e:stage2` 通过：Chromium desktop 主链路未回归。
- `npm run test:e2e:stage7` 通过：双 browser context 隔离未回归。

### 3.6 M9 Markdown 下载

M9 已补齐最终交付清单的真实 Markdown 下载能力：

- 最终交付清单详情页提供“下载 Markdown”按钮。
- 浏览器会触发真实 `.md` 文件下载。
- 下载内容包含标题、摘要、关键字段、正文、上游来源和更新时间。
- 下载内容不包含“PPTX 文件已生成”“图片文件已生成”“视频成片已生成”等虚假完成表述。

最近一次 M9 验收记录显示：

- `node --test tests/artifact-markdown-download.test.mjs` 通过：1 test passed。
- `npm run test:e2e:stage2` 通过：Chromium desktop 捕获真实 download 事件并校验文件内容。
- `npm test` 通过：Node 11 tests passed；Vitest 15 files / 68 tests passed。
- `npm run build` 通过。
- `npm run test:e2e:stage8` 通过：窄屏 Chromium 与 Firefox desktop 未回归。
- `npm run test:e2e:stage7` 通过：双 browser context 隔离未回归。

### 3.7 M10 产物复用输入闭环

M10 已补齐节点产物作为下一轮教师输入的真实闭环：

- 从完整产物详情页点击“作为输入”后，详情抽屉会关闭，输入区可见可操作。
- composer 显示“引用：产物标题：摘要”。
- textarea 插入“请基于：...”的可编辑产物内容。
- 发送下一轮消息后，后端 `ConversationMessage.artifactRefs` 保存引用。
- 前端从后端 snapshot 回显教师消息时，会把已保存引用显示为“引用：...”。
- 点击“移除引用”后引用 chip 消失，但教师已编辑的输入正文保留。

最近一次 M10 验收记录显示：

- `npm run test:e2e:stage2` 通过：Chromium desktop 2 passed，覆盖 M1-M5 主链路和 M10 产物复用输入闭环。
- `npm run test:e2e:stage8` 通过：Chromium narrow 与 Firefox desktop 共 4 passed，M10 用例在两个浏览器配置下均通过。
- `npm run test:e2e:stage7` 通过：双 browser context 隔离未回归。
- `npm test` 通过：Node 11 tests passed；Vitest 15 files / 68 tests passed。
- `npm run build` 通过。

### 3.8 M11 PPTX 最小下载闭环

M11 已补齐从当前 PPT 大纲 artifact 到真实 `.pptx` 文件的最小下载闭环：

- 产物详情页仅对“PPT 大纲与逐页脚本”显示“下载 PPTX”按钮。
- 后端路由通过 `projectId + artifactId` 读取真实持久化 artifact。
- `pptxgenjs` 在服务端生成标准 OOXML PPTX 文件，文件头为 `PK`。
- PPTX 包含标题、摘要、关键字段、正文要点和交付边界说明。
- 非 PPT artifact 不允许导出 PPTX。
- 页面仍不显示“PPTX 文件已生成”这类扩大能力边界的完成文案。

最近一次 M11 验收记录显示：

- `node --test tests\artifact-pptx-download.test.mjs` 通过：2 tests passed。
- `node --test tests\artifact-markdown-download.test.mjs` 通过：1 test passed。
- `npm test` 通过：Node 13 tests passed；Vitest 15 files / 68 tests passed。
- `npm run build` 通过，新增 `/api/workbench/projects/[projectId]/artifacts/[artifactId]/pptx` 动态路由。
- `npm run test:e2e:stage2` 通过：Chromium desktop 2 passed，捕获真实 `.pptx` download 并校验文件头。
- `npm run test:e2e:stage8` 通过：Chromium narrow 与 Firefox desktop 共 4 passed，均覆盖 PPTX 下载路径。
- `npm run test:e2e:stage7` 通过：双 browser context 隔离未回归。

### 3.9 M12 最终交付清单识别 PPTX 下载能力

M12 已把 M11 的 PPTX 最小下载能力同步到最终交付清单口径：

- 最终交付清单列出“PPT 大纲可下载最小 PPTX 文件”。
- 最终交付详情页和 Markdown 下载文件都能看到同一描述。
- 清单明确当前 PPTX 只保证根据文本大纲生成可打开、可阅读的最小文件。
- 图片文件、视频成片、动画和视觉精修仍标记为待生成或待完善。
- 页面和下载内容仍不出现“PPTX 文件已生成”“图片文件已生成”“视频成片已生成”等扩大完成边界的表述。

最近一次 M12 验收记录显示：

- `npx vitest run src/server/workbench/__tests__/stage11-m5-final-delivery.test.ts --maxWorkers=1` 红灯后绿灯：1 test passed。
- `node --test tests\artifact-markdown-download.test.mjs` 通过：1 test passed。
- `npm run test:e2e:stage2` 通过：Chromium desktop 2 passed，详情页和 Markdown 下载均验证 M12 口径。
- `npm test` 通过：Node 13 tests passed；Vitest 15 files / 68 tests passed。
- `npm run build` 通过。
- `npm run test:e2e:stage8` 通过：Chromium narrow 与 Firefox desktop 共 4 passed。
- `npm run test:e2e:stage7` 通过：双 browser context 隔离未回归。

### 3.10 M13 最终材料包 ZIP 下载

M13 已补齐最终交付清单到本地材料包的真实 ZIP 下载：

- 最终交付详情页仅对“最终交付清单”显示“下载材料包”按钮。
- 后端 `/package` 路由只允许 `final_delivery` artifact 导出材料包。
- ZIP 文件包含 `README.md`、`final-delivery.md`、`ppt-outline.pptx`。
- `final-delivery.md` 来自当前最终交付 artifact。
- `ppt-outline.pptx` 复用 M11 的 PPTX 生成能力，来自同项目 PPT 大纲 artifact。
- README 明确图片文件、视频成片、动画和视觉精修仍待生成或完善。
- 浏览器验收已解压 ZIP 并检查三个文件存在。

最近一次 M13 验收记录显示：

- `node --test tests\artifact-package-download.test.mjs` 红灯后绿灯：2 tests passed。
- `npx vitest run src/server/workbench/__tests__/stage13-material-package.test.ts --maxWorkers=1` 通过：1 test passed。
- `npm run test:e2e:stage2` 通过：Chromium desktop 2 passed，含真实 ZIP 下载与 entries 检查。
- `node --test tests\artifact-pptx-download.test.mjs` 通过：2 tests passed。
- `node --test tests\artifact-markdown-download.test.mjs` 通过：1 test passed。
- `npm test` 通过：Node 15 tests passed；Vitest 16 files / 69 tests passed。
- `npm run build` 通过，新增 `/api/workbench/projects/[projectId]/artifacts/[artifactId]/package` 动态路由。
- `npm run test:e2e:stage8` 通过：Chromium narrow 与 Firefox desktop 共 4 passed，均覆盖材料包下载路径。
- `npm run test:e2e:stage7` 通过：双 browser context 隔离未回归。

### 3.11 M14 私有台账 OpenAI-compatible live smoke

M14 已把 M6 的 readiness 推进为真实 OpenAI-compatible live smoke：

- 已参考私有 API 台账，但未摘录、提交或打印真实 key、token、账号、私有端点或 `.env` 内容。
- 脱敏矩阵显示 primary/third 通道均返回 HTTP 403，fallback 通道的 Responses 和 Chat Completions 均可用。
- 本项目根 `.env` 已固定选择 `AGENT_BRAIN_CHANNEL=fallback`，`.env` 仍被 `.gitignore` 忽略。
- `scripts\openai-smoke.mjs` 支持 `OPENAI_*` 和台账 `AGENT_BRAIN_*` 通道选择。
- live smoke 已输出 `ok=true`、`runtimeKind=openai`、`generationMode=model_generated`、`credentialSource=agent_brain_fallback_ledger_env`。
- smoke 成功与失败输出均不包含真实 key、token、账号、私有端点、模型响应全文或底层堆栈。

最近一次 M14 验收记录显示：

- `node --test tests\openai-smoke-script.test.mjs` 通过：3 tests passed。
- 无凭据门禁命令按预期 exit 2，并输出 `missing_OPENAI_COMPATIBLE_CREDENTIAL`。
- `node scripts\openai-smoke.mjs` 通过：真实 OpenAI-compatible fallback 通道返回 `model_generated`。
- `npm test` 通过：Node 17 tests passed；Vitest 16 files / 69 tests passed。
- `npm run build` 通过。
- worker 残留检查通过。
- `git diff --check` 通过，无空白错误。

### 3.12 M15 PPT 样本资产与 Coze readiness

M15 已把用户指定的 PPT 提示词和教材 PDF 纳入项目 fixture：

- `fixtures\ppt\template-a1-original-visual-strategy.md`
- `fixtures\textbooks\sujiao-grade6-percentage.pdf`
- `fixtures\ppt-sample-manifest.json`

已验证的 readiness：

- manifest 记录来源路径、项目内路径、size、sha256、用途和敏感性判断。
- `tests\fixture-assets.test.mjs` 校验 fixture 存在、非空、PDF 头为 `%PDF`、size/hash 与 manifest 一致。
- Coze PPT 关键变量已从私有台账安装到项目根 `.env`，只记录 present/missing，不打印真实 token 或端点值。

最近一次 M15 验收记录显示：

- `node --test tests\fixture-assets.test.mjs` 红灯后绿灯：1 test passed。
- Coze env present/missing 检查通过：`COZE_API_BASE`、`COZE_API_TOKEN`、`COZE_PPT_BOT_ID`、`COZE_PPT_RUN_URL` 均 present。
- `npm test` 通过：Node 18 tests passed；Vitest 16 files / 69 tests passed。

### 3.13 M16 Coze PPT live smoke

M16 已使用 M15 固定样本调用真实 Coze PPT `/run` 通道：

- 新增 `scripts\coze-ppt-smoke.mjs`。
- 新增 `tests\coze-ppt-smoke-script.test.mjs`。
- 脚本从 fixture 组装 1 页“六年级百分数导入课”PPT 请求。
- 真实 Coze `/run` 返回 PPTX 结果后，脚本下载到 `.tmp\coze-ppt-smoke\`。
- 下载文件已通过 zip 头和 `ppt\presentation.xml` 校验。
- 脚本输出不包含 token、远程 PPTX URL、账号、私有端点或完整响应体。

最近一次 M16 验收记录显示：

- `node --test tests\coze-ppt-smoke-script.test.mjs` 红灯后绿灯：3 tests passed。
- `node scripts\coze-ppt-smoke.mjs` 通过：`ok=true`、`provider=coze_ppt`、`channel=run`、`pptxValid=true`、`bytes=29462`。
- `npm test` 通过：Node 21 tests passed；Vitest 16 files / 69 tests passed。
- `npm run build` 通过。

### 3.14 M17 Coze PPT 后端 artifact adapter

M17 已把 M16 的真实 Coze PPT smoke 能力推进到后端 artifact 层：

- 新增 `src\server\coze-ppt\coze-ppt-run.ts`，封装 Coze `/run` 请求、解析、下载和 PPTX 校验。
- 新增 `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/coze-ppt`。
- 该 route 只允许 `ppt_draft` artifact 触发。
- 成功后保存新版本 `ppt_draft` artifact，内部 `structuredContent.storage.cozePptx` 记录本地 PPTX metadata。
- PPTX 下载 route 已改为优先返回本地真实 Coze PPTX，没有 Coze 文件时回退最小 PPTX。
- 最终材料包 route 已改为优先打包真实 Coze PPTX。
- 本地文件读取约束在 `.tmp` 目录内，不透传远程 URL。

最近一次 M17 验收记录显示：

- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/coze-ppt/__tests__/coze-ppt-artifact-adapter.test.ts --maxWorkers=1` 红灯后绿灯：2 tests passed。
- `node --test tests\artifact-pptx-download.test.mjs` 通过：2 tests passed。
- `npm test` 通过：Node 21 tests passed；Vitest 17 files / 71 tests passed。
- `npm run build` 通过，新增 `/coze-ppt` 动态 route，构建无 Turbopack warning。

### 3.15 M18 图片真实 API live smoke

M18 已把图片能力从台账 readiness 推进到服务端真实 live smoke：

- 新增 `scripts\image-smoke.mjs`，支持 OpenAI-compatible 图片生成接口。
- 新增 `tests\image-smoke-script.test.mjs`，覆盖 `b64_json`/URL 响应解析、PNG/JPEG 魔数校验、endpoint 拼接、缺 env 门禁和 `free` 通道脱敏失败输出。
- 本项目根 `.env` 已固定选择 `IMAGE_PROVIDER_CHANNEL=free`，`.env` 仍被 `.gitignore` 忽略。
- 脚本支持根地址、`/v1` 地址或完整 `/v1/images/generations` endpoint，避免重复追加 `/v1`。
- 真实 live smoke 已生成本地 PNG 文件到 `.tmp\image-smoke\`，并记录 bytes、sha256、mime 和 `imageValid=true`。
- 脚本输出不包含 key、token、私有端点、远程图片 URL 或完整 provider 响应。

最近一次 M18 验收记录显示：

- `node --test tests\image-smoke-script.test.mjs` 红灯后绿灯：5 tests passed。
- `node scripts\image-smoke.mjs` 通过：`ok=true`、`provider=image_generation`、`channel=free`、`model=gpt-image-2`、`bytes=1196644`、`imageValid=true`、`mime=image/png`。

### 3.16 M19 图片后端 artifact adapter

M19 已把 M18 的图片真实 API smoke 能力推进到后端 artifact 层：

- 新增 `src\server\image-generation\image-generation-run.ts`，封装图片 provider 请求、响应解析、本地文件保存和图片魔数校验。
- 新增 `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/image`。
- 该 route 只允许 `ppt_draft` artifact 触发。
- 成功后保存新版本 `ppt_draft` artifact，内部 `structuredContent.storage.imageAsset` 记录本地图片 metadata。
- route 响应不包含 token、远程图片 URL、私有端点或完整 provider 响应。

最近一次 M19 验收记录显示：

- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/image-generation/__tests__/image-artifact-adapter.test.ts --maxWorkers=1` 红灯后绿灯：2 tests passed。
- `node --test tests\image-smoke-script.test.mjs` 通过：5 tests passed。
- `npm test` 通过：Node 26 tests passed；Vitest 18 files / 73 tests passed。
- `npm run build` 通过，新增 `/image` 动态 route。

### 3.17 M20 视频真实 API live smoke

M20 已把视频能力从台账 frozen 状态推进到服务端真实 live smoke：

- 新增 `scripts\video-smoke.mjs`，支持异步视频任务 submit/query/download。
- 新增 `tests\video-smoke-script.test.mjs`，覆盖任务 id 解析、状态归一、结果 URL 解析、query endpoint 拼接、可恢复任务选择、脱敏状态摘要、stuck 分类、MP4 校验和失败输出脱敏。
- 脚本支持 `VIDEO_SMOKE_TASK_ID` 或 `.tmp\video-smoke\last-task.json` 复查已有任务，避免排障时重复 submit。
- 持续排队任务会分类为 `video_task_stuck`，不再只给泛化 timeout。
- 真实 live smoke 已通过固定视频通道完成 submit/query/download，本地 MP4 文件保存到 `.tmp\video-smoke\`，并记录 bytes、sha256、mime 和 `videoValid=true`。
- 脚本输出不包含 key、token、私有端点、任务 id、远程视频 URL 或完整 provider 响应。

最近一次 M20 验收记录显示：

- `node --test tests\video-smoke-script.test.mjs` 红灯后绿灯：11 tests passed。
- `node scripts\video-smoke.mjs` 通过：`ok=true`、`provider=video_generation`、`channel=octo`、`model=omni_flash-10s`、`taskStatus=completed`、`bytes=2511817`、`videoValid=true`、`mime=video/mp4`。
- `npm test` 通过：Node 37 tests passed；Vitest 18 files / 73 tests passed。
- `npm run build` 通过。

### 3.18 M21 视频后端 artifact adapter

M21 已把 M20 的视频真实 API smoke 能力推进到后端 artifact 层：

- 新增 `src\server\video-generation\video-generation-run.ts`，封装视频 provider submit/query/download、本地文件保存和 MP4 校验。
- 新增 `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/video`。
- 该 route 只允许 `intro_video_plan` artifact 触发。
- 成功后保存新版本 `intro_video_plan` artifact，内部 `structuredContent.storage.videoAsset` 记录本地 MP4 metadata。
- route 响应不包含 token、远程视频 URL、私有端点、task id 或完整 provider 响应。

最近一次 M21 验收记录显示：

- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/video-generation/__tests__/video-artifact-adapter.test.ts --maxWorkers=1` 红灯后绿灯：2 tests passed。
- `node --test tests\video-smoke-script.test.mjs` 通过：11 tests passed。
- `npm test` 通过：Node 37 tests passed；Vitest 19 files / 75 tests passed。
- `npm run build` 通过，新增 `/video` 动态 route。

### 3.19 M22 视频下载 route

M22 已把 M21 保存的本地 MP4 metadata 推进为后端可下载文件能力：

- 新增 `src\server\video-generation\artifact-video.ts`，封装本地 MP4 下载构建、`.tmp` 路径约束、MP4 `ftyp` 校验和下载 headers。
- 在 `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/video` 同一路由中新增 `GET` 下载能力。
- 带 `structuredContent.storage.videoAsset.localOutput` 的 artifact 可下载本地 MP4。
- 缺少 `videoAsset` 或指向 `.tmp` 外路径的 artifact 会被拒绝。
- 下载响应不包含 token、远程视频 URL、私有端点、task id 或完整 provider 响应。

最近一次 M22 验收记录显示：

- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/video-generation/__tests__/video-download-route.test.ts --maxWorkers=1` 红灯后绿灯：3 tests passed。
- `npm test` 通过：Node 37 tests passed；Vitest 20 files / 78 tests passed。
- `npm run build` 通过，route 表包含 `/video` 动态 route；构建仍有 1 条 Turbopack output tracing warning，需在生产存储改造阶段复查。

### 3.20 M23 最终材料包视频资产集成

M23 已把 M22 可下载的本地 MP4 推进到最终材料包：

- `buildFinalMaterialPackageDownload` 支持可选 `video` 参数。
- 有视频时 ZIP 增加 `intro-video.mp4`。
- 无视频时材料包保持旧能力，不因视频缺失失败，也不伪装视频完成。
- package route 会在同项目中查找带 `storage.videoAsset` 的 `intro_video_plan` artifact，优先 approved，否则使用最新版本。
- 视频读取复用 M22 `buildStoredVideoDownload`，继续保持 `.tmp` 路径约束和 MP4 校验。
- README 会根据是否存在视频切换说明；有视频时提醒教师核对视频质量、节奏和课堂锚点。

最近一次 M23 验收记录显示：

- `node --test tests\artifact-package-download.test.mjs` 红灯后绿灯：3 tests passed。
- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage13-material-package.test.ts --maxWorkers=1` 通过：1 test passed。
- `npm test` 通过：Node 38 tests passed；Vitest 20 files / 78 tests passed。
- `npm run build` 通过；构建仍有 1 条 Turbopack output tracing warning，需在生产存储改造阶段复查。

## 4. 当前产品就绪结论

当前可以如实表述为：

> ShanHaiEdu 已具备本地 deterministic 材料生产 MVP：教师可以在本机浏览器完成从一句话需求到最终交付清单 Markdown 的连续材料生产闭环，且项目、消息、节点产物、确认状态、产物复用引用和当前项目选择可由后端与浏览器状态恢复支撑。该主链路已在 Chromium desktop、Chromium narrow viewport 和 Firefox desktop 验证通过，最终交付清单已支持真实 `.md` 文件下载，PPT 大纲已支持基于当前 artifact 生成并下载最小 `.pptx` 文件，最终交付清单已同步说明该 PPTX 最小下载能力，并已支持包含 Markdown 与最小 PPTX 的真实 `.zip` 材料包下载。服务端 smoke 层已能通过私有台账固定 fallback 通道完成真实 OpenAI-compatible live smoke。PPT 真实生成阶段已具备固定提示词、教材 fixture、Coze env readiness，并已通过真实 Coze `/run` PPTX 下载 smoke；后端 artifact 层已能保存并优先下载本地真实 Coze PPTX。图片真实 API 阶段已通过固定 `free` 通道完成服务端 live smoke，并已具备后端 artifact adapter 保存本地图片 metadata 的能力。视频真实 API 阶段已通过固定 `octo` 通道完成服务端 submit/query/download live smoke，已具备后端 artifact adapter 保存本地 MP4 metadata、后端本地 MP4 下载 route 和最终材料包视频资产集成能力。

当前不能表述为：

- 图片下载 route、材料包图片资产或 PPTX 内嵌图片已完成。
- Coze 官方 OpenAPI 主链路已完成。
- 教师 UI 已暴露真实 Coze PPT 生成按钮。
- PPTX 已完成图片、动画和视觉精修。
- 视频在线播放、Range 请求或教师 UI 真实视频生成入口已完成。
- 已具备账号、权限或生产级多人协作。
- 已完成生产部署或公网发布。

当前成熟度判断：

- 内部骨架成熟度：约 93%-96%。核心 workflow、后端持久化、浏览器主链路、产物复用输入、窄屏/Firefox 覆盖、Markdown 下载交付、PPTX 最小下载、最终交付口径同步、ZIP 材料包下载、真实 OpenAI-compatible smoke、PPT 固定样本、真实 Coze PPT smoke、Coze PPT artifact adapter、图片真实 API smoke、图片 artifact adapter、视频真实 API smoke、视频 artifact adapter、视频下载 route、材料包视频资产集成、阶段测试与文档闭环已经成形。
- 生产就绪度：约 60%-68%。真实文本 smoke、Coze PPT `/run` smoke、Coze PPT artifact adapter、图片 live smoke、图片 artifact adapter、视频 live smoke、视频 artifact adapter、视频下载 route 与视频材料包集成已通过，但业务节点真实模型全面接入、Coze 官方 OpenAPI 主链路、图片下载/材料包集成、账号权限、生产部署、安全与运维仍未完成。

## 5. 剩余风险

- M14 live OpenAI-compatible smoke 已通过，但 primary/third 台账通道当前返回 403，固定通道暂选 fallback。
- 业务工作流节点仍主要使用 deterministic runtime，真实模型尚未全面接入节点生成链路。
- M15 已纳入教材 PDF fixture；后续外发、部署或公开演示前需单独确认版权和发布边界。
- Coze PPT `/run` smoke 和 artifact adapter 已通过，但尚未完成 Coze 官方 OpenAPI 主链路和教师 UI 显式触发入口。
- Coze PPT 本地文件当前存储在 `.tmp`，生产部署前必须替换为部署卷或对象存储。
- M18 图片 live smoke 已通过，M19 已接入后端 artifact adapter；但当前尚未提供图片下载 route、最终材料包图片资产、PPTX 内嵌图片或教师 UI 入口。
- M18 `primary` 图片通道曾返回 403，当前固定通道为 `free`；后续切换通道必须重新跑 smoke。
- M20 视频 live smoke 已通过，M21 已接入后端 artifact adapter，M22 已提供视频下载 route，M23 已集成最终材料包视频资产；但当前尚未提供教师 UI 入口、生产队列、对象存储或质量验收。
- M22 构建仍有 1 条 Turbopack output tracing warning，指向运行时本地视频文件读取；本地 MVP 可用，但生产部署前应随存储方案一并处理。
- 浏览器 E2E 已覆盖 Chromium desktop、Chromium narrow viewport 和 Firefox desktop；WebKit、真实移动设备和触摸手势仍待专项验证。
- 当前 PPTX 只是根据文本大纲生成的最小可下载文件，不包含真实图片、视频、动画或精修视觉设计。
- 当前材料包已包含最终交付 Markdown 与最小 PPTX，但不包含图片、视频、动画或视觉精修资产。
- 当前隔离是无账号本地工作台隔离，不是权限隔离。
- SQLite 可继续支撑本地 MVP 试用，但不应被包装为生产级数据库方案。
- `deterministic_draft` 和 deterministic 文本产物必须继续标注为开发态草稿或本地确定性生成结果。

## 6. 推荐下一阶段

优先级从高到低：

1. 做图片后续文件能力拆分：图片下载 route、材料包集成、PPTX 内嵌图片分别按产物合同、存储路径、失败恢复和教师可见边界分阶段推进。
2. 做教师 UI 入口：把真实 Coze PPT、图片和视频后端能力暴露为受控操作，同时避免工程词进入教师界面。
3. 做 WebKit、真实移动设备或触摸手势专项验证。
4. 在进入多人或部署前，先定义账号/权限、数据库迁移和长任务队列触发条件。

## 7. 审查结论

M0-M5 文本主链路已经通过本地浏览器验证，M6 readiness 已通过，M7 本地双上下文隔离已通过，M8 窄屏 Chromium 与 Firefox desktop 覆盖已通过，M9 最终交付清单 Markdown 下载已通过，M10 产物复用输入闭环已通过，M11 PPTX 最小下载闭环已通过，M12 最终交付清单 PPTX 能力口径同步已通过，M13 最终材料包 ZIP 下载已通过，M14 私有台账 OpenAI-compatible live smoke 已通过，M15 PPT 样本资产与 Coze readiness 已通过，M16 Coze PPT `/run` live smoke 已通过，M17 Coze PPT 后端 artifact adapter 已通过，M18 图片真实 API live smoke 已通过，M19 图片后端 artifact adapter 已通过，M20 视频真实 API live smoke 已通过，M21 视频后端 artifact adapter 已通过，M22 视频下载 route 已通过，M23 最终材料包视频资产集成已通过。

因此当前主线可以作为“本地 deterministic 材料生产 MVP 可用 + 服务端真实文本模型 smoke 可用 + Coze PPT 真实 smoke 与后端 artifact 能力可用 + 图片真实 API smoke 与后端 artifact 能力可用 + 视频真实 API smoke、后端 artifact、下载与材料包能力可用”的候选状态继续推进，但不能作为“图片下载/材料包完整集成、教师 UI 真实生成入口、账号权限和生产部署已完成”的最终状态。
