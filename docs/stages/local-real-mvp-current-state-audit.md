# Local Real MVP 当前状态审计

日期：2026-07-07

## 1. 审计目标

本审计用于收口 `mainline/local-real-mvp` 在 M0-M40-A 后的真实状态，明确哪些能力已经通过本地验证、哪些只是 readiness、哪些仍不能宣称完成。

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
- `docs\stages\local-real-mvp-m24-image-download-route-report.md`
- `docs\stages\local-real-mvp-m25-material-package-image-asset-report.md`
- `docs\stages\local-real-mvp-m26-teacher-real-generation-entry-report.md`
- `docs\stages\local-real-mvp-m27-real-generation-browser-linkage-report.md`
- `docs\stages\local-real-mvp-m28-artifact-storage-prep-report.md`
- `docs\stages\local-real-mvp-m29-local-auth-access-report.md`
- `docs\stages\local-real-mvp-m30-generation-job-queue-report.md`
- `docs\stages\local-real-mvp-m31-production-readiness-report.md`
- `docs\stages\local-real-mvp-m32-auth-security-hardening-report.md`
- `docs\stages\local-real-mvp-m33-client-exe-readiness-report.md`
- `docs\stages\local-real-mvp-m34-real-client-exe-packaging-report.md`
- `docs\stages\local-real-mvp-m35-client-installer-validation-report.md`
- `docs\stages\local-real-mvp-m36-installer-route-recovery-report.md`
- `docs\stages\local-real-mvp-m37-client-install-experience-report.md`
- `docs\stages\local-real-mvp-m38-next-tracing-report.md`
- `docs\stages\local-real-mvp-m39-client-productization-report.md`
- `docs\stages\local-real-mvp-m40-public-auth-report.md`

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

### 3.21 M24 图片下载 route

M24 已把 M19 保存的本地图片 metadata 推进为后端可下载文件能力：

- 新增 `src\server\image-generation\artifact-image.ts`，封装本地 PNG/JPEG 下载构建、`.tmp` 路径约束、图片魔数校验和下载 headers。
- 在 `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/image` 同一路由中新增 `GET` 下载能力。
- 带 `structuredContent.storage.imageAsset.localOutput` 的 artifact 可下载本地 PNG/JPEG。
- 缺少 `imageAsset` 或指向 `.tmp` 外路径的 artifact 会被拒绝。
- 下载响应不包含 token、远程图片 URL、私有端点或完整 provider 响应。

最近一次 M24 验收记录显示：

- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/image-generation/__tests__/image-download-route.test.ts --maxWorkers=1` 红灯后绿灯：3 tests passed。
- `npm test` 通过：Node 38 tests passed；Vitest 21 files / 81 tests passed。
- `npm run build` 通过；构建仍有 1 条既有 Turbopack output tracing warning，指向 M22 视频本地读取，未新增图片下载相关 warning。

### 3.22 M25 最终材料包图片资产集成

M25 已把 M24 可下载的本地图片推进到最终材料包：

- `buildFinalMaterialPackageDownload` 支持可选 `image` 参数。
- 有图片时 ZIP 增加 `classroom-visual.png` 或 `classroom-visual.jpg`。
- 无图片时材料包保持旧能力，不因图片缺失失败，也不伪装图片完成。
- package route 会在同项目中查找带 `storage.imageAsset` 的 `ppt_draft` artifact，优先 approved，否则使用最新版本。
- 图片读取复用 M24 `buildStoredImageDownload`，继续保持 `.tmp` 路径约束和 PNG/JPEG 魔数校验。
- README 会根据是否存在图片切换说明；有图片时提醒教师核对视觉准确性、版权和课堂适配。

最近一次 M25 验收记录显示：

- `node --test tests\artifact-package-download.test.mjs` 红灯后绿灯：4 tests passed。
- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage13-material-package.test.ts --maxWorkers=1` 通过：1 test passed。
- `npm test` 通过：Node 39 tests passed；Vitest 21 files / 81 tests passed。
- `npm run build` 通过；构建仍有 1 条既有 Turbopack output tracing warning，指向 M22 视频本地读取，未新增图片材料包相关 warning。

### 3.23 M26 教师 UI 真实生成入口

M26 已把 M17、M19、M21 的服务端真实生成 route 暴露为教师可见入口：

- PPT 大纲详情页可显示“生成真实 PPTX”和“生成课堂视觉图”。
- 导入视频方案详情页可显示“生成导入视频”。
- 前端 data source 会调用既有 `coze-ppt`、`image`、`video` 后端 route，并在成功后刷新 snapshot。
- controller 提供触发中状态、成功提示和失败提示。
- 产物详情抽屉移除了未接线的“查看图片”静态按钮。
- 入口文案使用教师可理解表述，不暴露 `provider`、`storage`、`debug` 或 `local path`。

最近一次 M26 验收记录显示：

- `node --test tests\workbench-api.test.mjs` 红灯后绿灯：11 tests passed。
- `npm test` 通过：Node 41 tests passed；Vitest 21 files / 81 tests passed。
- `npm run build` 通过；构建仍有 1 条既有 Turbopack output tracing warning，指向 M22 视频本地读取，未新增前端入口相关 warning。
- `npm run test:e2e:stage2` 通过：Chromium desktop 2 passed。
- `npm run test:e2e:stage8` 通过：Chromium narrow 与 Firefox desktop 共 4 passed。

### 3.24 M27 真实生成浏览器联动验证

M27 已把 M26 的教师真实生成入口推进到浏览器专项验证：

- 新增 `tests\e2e\stage27-real-generation-linkage.spec.ts`。
- 新增 `scripts\run-stage27-e2e.mjs`，使用独立 `test-results/stage27-e2e.db` 和单 worker。
- 浏览器中真实点击“生成真实 PPTX”“生成课堂视觉图”“生成导入视频”。
- Playwright route 替身拦截 `coze-ppt`、`image`、`video` POST route，并通过普通 `/artifacts` route 写入受控测试 artifact。
- snapshot 刷新后可打开“真实 PPTX 文件”“真实课堂视觉图”“真实导入视频”。
- 真实 PPTX artifact 可下载 `.pptx`，文件头为 `PK`。
- 真实课堂视觉图 artifact 可下载 `.png`，文件头为 PNG 魔数。
- 真实导入视频 artifact 可下载 `.mp4`，文件中包含 `ftyp`。
- 最终材料包 ZIP 包含 `classroom-visual.png` 和 `intro-video.mp4`。
- 教师可见页面文本未命中工程词红线。

M27 同时补齐了教师界面的本地素材下载入口：

- `ArtifactItem.realAssetDownloads` 从后端 artifact 的内部素材 metadata 推导可下载类型。
- 产物详情对带图片素材的 artifact 显示“下载图片”。
- 产物详情对带视频素材的 artifact 显示“下载视频”。
- 该能力只暴露教师可理解的下载动作，不暴露 `storage`、本地路径、私有端点或 provider 响应。

最近一次 M27 验收记录显示：

- `node scripts\run-stage27-e2e.mjs` 红灯后绿灯：Chromium desktop 1 passed。
- `npm test` 通过：Node 41 tests passed；Vitest 21 files / 81 tests passed。
- `npm run build` 通过；构建仍有 1 条既有 Turbopack output tracing warning，指向 M22 视频本地读取，未新增本阶段相关 warning。
- `npm run test:e2e:stage2` 通过：Chromium desktop 2 passed。
- `npm run test:e2e:stage8` 通过：Chromium narrow 与 Firefox desktop 共 4 passed。

### 3.25 M28 素材存储生产准备

M28 已把真实 PPTX、图片和视频素材保存路径从分散的 `.tmp` 拼接，推进到统一的 ArtifactStorage 边界：

- 新增 `src\server\artifact-storage\local-artifact-storage.ts`。
- 未配置 `ARTIFACT_STORAGE_ROOT` 时继续写入 `.tmp\<category>`，保持本地开发和既有 E2E 兼容。
- 配置 `ARTIFACT_STORAGE_ROOT` 后，新生成素材写入固定存储根目录。
- 配置模式下 artifact metadata 保存 `artifact-storage/<category>/<filename>` 逻辑 key，不保存机器绝对路径。
- PPTX、图片和视频下载 helper 统一通过 `resolveLocalArtifactOutput` 解析旧 `.tmp/...` metadata 和新 `artifact-storage/...` metadata。
- 路径解析拒绝空路径、绝对路径、盘符路径、`..`、`.` 和非允许前缀。

最近一次 M28 验收记录显示：

- `node --test tests\artifact-storage.test.mjs` 通过：2 tests passed。
- `node --test tests\artifact-pptx-download.test.mjs` 通过：2 tests passed。
- `npx vitest run src/server/image-generation/__tests__/image-download-route.test.ts src/server/video-generation/__tests__/video-download-route.test.ts src/server/coze-ppt/__tests__/coze-ppt-artifact-adapter.test.ts --maxWorkers=1` 通过：3 files / 8 tests passed。
- `npm test` 通过：Node 43 tests passed；Vitest 21 files / 81 tests passed。
- `npm run build` 通过；仍有 1 条 Turbopack output tracing warning，风险已集中在服务端 storage/download 路径。
- `node scripts\run-stage27-e2e.mjs` 通过：Chromium desktop 1 passed。

### 3.26 M29 本地账号权限最小闭环

M29 已补齐本地 MVP 的账号/权限最小闭环：

- 新增 `LocalUser` 模型。
- `Project` 新增可空 `ownerUserId`。
- 无 cookie 浏览器请求会获得 `shanhai_local_user` 本地会话 cookie。
- 新建项目自动归属当前本地用户。
- `listProjects` 按当前 actor 过滤，owner 为空的历史项目继续兼容本地升级场景。
- service 层对项目读取、消息、产物、确认、重做、上游输入、AgentRun、snapshot 均执行同一项目访问判断。
- 所有 `/api/workbench/projects` 与 `/api/workbench/projects/[projectId]...` route 均绑定请求 actor。
- PPTX、图片、视频下载 route，Coze PPT、图片、视频真实生成 route，最终材料包 route 均纳入同一权限边界。

最近一次 M29 验收记录显示：

- `node --test tests\local-session-auth.test.mjs` 红灯后绿灯：2 tests passed。
- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage29-local-auth-access.test.ts --maxWorkers=1` 红灯后绿灯：3 tests passed。
- `npm test` 通过：Node 45 tests passed；Vitest 22 files / 84 tests passed。
- `npm run build` 通过；仍有 1 条既有 Turbopack output tracing warning，指向 storage/download 路径。
- `npm run test:e2e:stage7` 通过：Chromium desktop 1 passed，两个 browser context 刷新后保持各自项目。
- `node scripts\run-stage27-e2e.mjs` 通过：Chromium desktop 1 passed，真实生成入口和下载联动不回归。

### 3.27 M30 真实生成任务队列基础

M30 已把 PPTX、图片和视频真实生成推进到持久化任务状态基础：

- 新增 `GenerationJob` 模型。
- 每次 Coze PPT、图片和视频真实生成都会先创建任务。
- 任务状态按 `queued -> running -> succeeded/failed` 推进。
- 成功任务记录结果 artifact。
- 失败任务记录脱敏错误摘要、尝试次数和完成时间。
- `ProjectSnapshot` 返回 `generationJobs`，刷新后可恢复任务列表。
- 新增 `/api/workbench/projects/[projectId]/generation-jobs` route。
- 任务读取和状态更新继续受 M29 本地 actor 项目权限保护。
- route 仍保留既有 `artifact` 响应，M27 浏览器联动不回归。

最近一次 M30 验收记录显示：

- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage30-generation-job-queue.test.ts --maxWorkers=1` 通过：1 file / 4 tests passed。
- `npm test` 通过：Node 45 tests passed；Vitest 23 files / 88 tests passed。
- `npm run build` 通过；仍有 1 条既有 Turbopack output tracing warning，指向 storage/download 路径。
- `npm run test:e2e:stage7` 通过：Chromium desktop 1 passed，两个 browser context 刷新后保持各自项目。
- `node scripts\run-stage27-e2e.mjs` 通过：Chromium desktop 1 passed，真实生成入口、下载和材料包联动不回归。

### 3.28 M31 生产部署本地准备

M31 已补齐本地真实 MVP 的上线前生产准备基础：

- `next.config.ts` 已配置 `output: "standalone"`。
- 新增 `npm run preflight:production`。
- 新增 `scripts\production-preflight.mjs`，检查 build/start、standalone、SQLite、素材存储根目录、OpenAI-compatible、Coze PPT、图片和视频 env。
- `scripts\init-sqlite-schema.mjs` 默认加载 `.env`，`npm run db:init` 可初始化 `.env` 指定的本地生产准备 SQLite 路径。
- 新增 `docs\runbooks\local-real-mvp-production-readiness.md`。
- `data\` 和 `artifact-storage-root\` 已加入 `.gitignore`。
- 已在 ignored 的 `.env` 中补齐本机生产准备配置，未提交真实 key、token、私有端点或 `.env` 内容。

最近一次 M31 验收记录显示：

- `node --test tests\production-preflight.test.mjs tests\sqlite-init-dotenv.test.mjs` 通过：5 tests passed。
- `npm run preflight:production` 通过：`ok=true`，8 个检查项通过。
- `npm run db:init` 通过：初始化 `.env` 指定的本地生产准备 SQLite 路径。
- `npm test` 通过：Node 50 tests passed；Vitest 23 files / 88 tests passed。
- `npm run build` 通过；仍有 1 条既有 Turbopack output tracing warning，指向 storage/download 路径。
- `npm run test:e2e:stage7` 通过：Chromium desktop 1 passed。
- `node scripts\run-stage27-e2e.mjs` 通过：Chromium desktop 1 passed。

### 3.29 M32 账号权限安全加固

M32 已在 M29 本地账号/权限最小闭环基础上补齐浏览器安全边界：

- `withLocalWorkbenchActor` 对写接口执行统一来源校验。
- 跨站 `POST`、`PUT`、`PATCH`、`DELETE` 返回 403。
- 同源请求继续允许执行。
- `localhost`、`127.0.0.1`、`::1` 在同协议同端口下按 loopback 同源处理。
- HTTPS 或 `x-forwarded-proto=https` 场景下，本地会话 cookie 自动增加 `Secure`。
- `next.config.ts` 增加基础安全响应头：`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`。

最近一次 M32 验收记录显示：

- `node --test tests\auth-security-hardening.test.mjs` 通过：5 tests passed。
- `npm test` 通过：Node 55 tests passed；Vitest 23 files / 88 tests passed。
- `npm run build` 通过；仍有 1 条既有 Turbopack output tracing warning，指向 storage/download 路径。
- `npm run test:e2e:stage7` 通过：Chromium desktop 1 passed。
- `node scripts\run-stage27-e2e.mjs` 通过：Chromium desktop 1 passed。

### 3.30 M33 客户端 exe 验证准备

M33 已在 M31 本地生产准备和 M32 loopback 安全边界基础上补齐客户端 exe 验证前置条件：

- 新增 `npm run preflight:client-exe`。
- 新增客户端 exe readiness 检查脚本，覆盖 build/start、Next standalone、下载 route、素材目录、loopback 兼容和桌面打包工程识别。
- 新增 `npm run test:e2e:stage33`，使用 `http://localhost:<port>` 入口模拟桌面容器加载本地服务。
- Stage33 覆盖新建项目、发送需求、刷新恢复、Markdown 下载和教师可见工程词扫描。
- readiness 输出明确保留 `desktop-wrapper-not-configured` warning，避免把准备态包装为真实 exe 已完成。

最近一次 M33 验收记录显示：

- `node --test tests\client-exe-readiness.test.mjs` 通过：4 tests passed。
- `npm run preflight:client-exe` 通过：`ok=true`，并提示真实桌面打包工程尚未配置。
- `npm run test:e2e:stage33` 通过：Chromium desktop 1 passed。
- `npm test` 通过：Node 59 tests passed；Vitest 23 files / 88 tests passed。
- `npm run build` 通过；仍有 1 条既有 Turbopack output tracing warning，指向 storage/download 路径。

### 3.31 M34 真实客户端 exe 最小打包

M34 已把 M33 的客户端验证准备推进为真实 Windows 客户端打包最小闭环：

- 选择 Electron + electron-builder 作为首个 Windows exe MVP 路线。
- 新增 Electron 主进程与空 preload。
- 主进程启动 Next standalone server，并加载本地 loopback URL。
- 新增 `desktop:prepare` 安全 bundle，过滤 `.env`、本地数据库、素材目录和测试/文档产物。
- 新增 `desktop:smoke` 和 `desktop:pack`。
- 生成本地未签名 Windows 候选安装包。
- unpacked exe 已通过固定端口 smoke，`http://127.0.0.1:3127` 返回 200。

最近一次 M34 验收记录显示：

- `node --test tests\desktop-packaging.test.mjs` 通过：3 tests passed。
- `npm run desktop:smoke` 通过：`ok=true`。
- `npm run preflight:client-exe` 通过：`ok=true`，`warnings=[]`。
- `npm run test:e2e:stage33` 通过：Chromium desktop 1 passed。
- `npm test` 通过：Node 63 tests passed；Vitest 23 files / 88 tests passed。
- `npm run desktop:pack` 通过：生成 `dist-desktop\ShanHaiEdu Studio Setup 0.1.0.exe` 和 `dist-desktop\win-unpacked\ShanHaiEdu Studio.exe`。
- unpacked exe smoke 通过：本地 HTTP 200。

### 3.32 M35 客户端安装包验收边界

M35 已把 M34 的未签名候选安装包推进为可重复的安装包 smoke 边界：

- 新增 `npm run desktop:installer-smoke`。
- 新增 `scripts\desktop-installer-smoke.mjs`。
- 新增 `tests\desktop-installer-smoke.test.mjs`。
- 默认 smoke 验证安装包产物、unpacked exe、git ignore、打包资源安全和 unpacked exe HTTP 200。
- 显式安装器 smoke 通过 `SHANHAI_RUN_INSTALLER_SMOKE=1` 开启，避免日常测试误安装。
- NSIS 已配置 `runAfterFinish: false`，避免安装完成后自动启动应用干扰验收。

最近一次 M35 验收记录显示：

- `node --test tests\desktop-installer-smoke.test.mjs` 通过：3 tests passed。
- `npm run desktop:installer-smoke` 通过：`installerMode=skipped`，unpacked exe 返回 HTTP 200。
- `$env:SHANHAI_RUN_INSTALLER_SMOKE='1'; npm run desktop:installer-smoke` 未通过：安装文件已解压，但 `Uninstall ShanHaiEdu Studio.exe` 未生成，静默卸载无法执行。

因此 M35 当前只证明“候选客户端可运行 + 安装包资源边界可检查”，不能证明“安装/卸载验收通过”。

### 3.33 M36 安装器 blocker 收敛

M36 已收敛 M35 的静默安装/卸载 blocker：

- 根因是 180 秒 smoke 窗口过短，安装器尚未完成大体积应用目录解压和复制就被终止。
- 180 秒失败现场中，安装目录只有 6260 个文件，约 707 MB；`win-unpacked` 有 15699 个文件，约 883 MB。
- 安装器等待窗口调整为默认 600000 ms，并允许 `SHANHAI_INSTALLER_TIMEOUT_MS` 覆盖。
- 显式安装器 smoke 现在能拆分报告安装退出、安装后 exe、安装后 server、安装后 HTTP、卸载器和静默卸载状态。
- 安装后 exe HTTP smoke 已调整到静默卸载之前执行。

最近一次 M36 验收记录显示：

- `node --test tests\desktop-installer-smoke.test.mjs` 通过：5 tests passed。
- `npm run desktop:installer-smoke` 通过：默认 unpacked exe 返回 HTTP 200。
- `$env:SHANHAI_RUN_INSTALLER_SMOKE='1'; npm run desktop:installer-smoke` 通过：静默安装退出、安装后 exe/server 存在、安装后 exe HTTP 200、卸载器存在、静默卸载 exit 0。

因此当前可以表述为“未签名候选安装包已通过自动静默安装/启动/卸载 smoke”，但仍不能表述为“正式签名安装包或人工安装体验已完成”。

### 3.34 M37 客户端安装体验自动证据

M37 已把 M36 的静默安装、启动、卸载 smoke 推进为安装体验关键系统证据：

- 桌面壳支持 `SHANHAI_DESKTOP_USER_DATA_DIR`，安装体验 smoke 可把 Electron userData 隔离到 `test-results` 下验证。
- 显式安装体验 smoke 会检查 Windows 卸载注册表入口。
- 显式安装体验 smoke 会检查开始菜单快捷方式。
- 安装后 exe 启动并返回 HTTP 200 后，会检查 userData 下的 `data` 与 `artifact-storage-root`。
- 静默卸载后，会等待并检查注册表入口、开始菜单快捷方式和测试安装目录核心文件已清理。

最近一次 M37 验收记录显示：

- `node --test tests\desktop-packaging.test.mjs` 通过：3 tests passed。
- `node --test tests\desktop-installer-smoke.test.mjs` 通过：6 tests passed。
- `npm run desktop:pack` 通过：重新生成包含 M37 桌面壳改动的未签名候选包。
- `npm run desktop:installer-smoke` 通过：默认 unpacked exe 返回 HTTP 200。
- `$env:SHANHAI_RUN_INSTALLER_SMOKE='1'; npm run desktop:installer-smoke` 通过：安装体验检查项全部通过。

因此当前可以表述为“未签名候选客户端已通过自动化安装体验关键证据 smoke”，但仍不能表述为“正式签名发布、自动更新或人工可见安装向导验收已完成”。

### 3.35 M38 Next standalone tracing 收敛

M38 已收敛 M28-M37 持续记录的 Next/Turbopack NFT tracing warning：

- video route 的动态本地素材路径不再把项目根、文档、测试、本地数据库、桌面 bundle 或生成物带入 route NFT 清单。
- `next.config.ts` 已通过 `outputFileTracingExcludes` 为 API routes 排除本地生成物和根级非运行配置。
- `src\server\artifact-storage\local-artifact-storage.ts` 对运行时 `process.cwd()` 路径增加 tracing ignore 标记。
- 新增 `tests\next-tracing-readiness.test.mjs` 作为防回归检查。

最近一次 M38 验收记录显示：

- `node --test tests\next-tracing-readiness.test.mjs` 通过：2 tests passed。
- `node --test tests\artifact-storage.test.mjs` 通过：2 tests passed。
- `npm run build` 通过，且不再出现 `Encountered unexpected file in NFT list`。
- `npm run desktop:prepare` 通过：`ok=true`。
- `npm run desktop:installer-smoke` 通过：默认 unpacked exe 返回 HTTP 200。
- video route NFT 清单风险项计数为 0。

因此当前可以表述为“Next standalone 构建的既有 NFT tracing warning 已消除，桌面打包不再依赖 `desktop:prepare` 来弥补该过宽 route trace”，但仍不能表述为“可以删除 `desktop:prepare` 或对象存储/生产部署已完成”。

### 3.36 M39 客户端产品化工程边界

M39 已把未签名客户端候选包推进到基础产品化工程态：

- `electron-builder.config.cjs` 已启用 `asar: true`。
- `desktop-bundle/**` 和 `node_modules/**` 已纳入 `asarUnpack`，保证 Next standalone server 与运行依赖在真实目录可解析。
- 客户端配置已包含基础 `description`、`author` 和 `win.icon`。
- 新增 `desktop\assets\icon.ico` 作为基础候选图标。
- Electron 主进程会在 `userData` 下创建 `data`、`artifact-storage-root`、`logs` 和 `crash-dumps`。
- Electron 主进程使用 `app.setAppLogsPath` 和 `app.setPath("crashDumps", ...)` 固定日志与崩溃转储目录。
- 默认 installer smoke 已验证 asar/unpack 后 unpacked exe 仍可返回 HTTP 200。

最近一次 M39 验收记录显示：

- `node --test tests\desktop-packaging.test.mjs` 通过：5 tests passed。
- `node --test tests\desktop-installer-smoke.test.mjs` 通过：7 tests passed。
- `npm run build` 通过，无 NFT tracing warning。
- `npm run desktop:prepare` 通过：`ok=true`。
- `npm run desktop:pack` 通过：重新生成未签名候选 setup exe 与 win-unpacked exe。
- `npm run desktop:installer-smoke` 通过：默认 unpacked exe 返回 HTTP 200。

因此当前可以表述为“未签名客户端候选包具备基础 metadata、图标、asar/unpack、日志/崩溃目录和默认启动 smoke”，但仍不能表述为“正式签名、自动更新、崩溃上报或人工可见安装向导验收已完成”。

### 3.37 M40-A 公网认证服务端底座

M40-A 已把 M29/M32 的本地账号与安全边界推进为公网正式认证前的服务端地基：

- 新增统一 `WorkbenchActor`，区分 `local`、`password`、`oauth`、`sso` 四类 auth mode。
- 新增 public session cookie 名称 `shanhai_session`，不复用本地 `shanhai_local_user` 作为公网登录态。
- 新增 `AuthSession`、`ProjectMembership`、`AuditLog`、`CsrfToken` 数据模型。
- workbench service 授权从 owner-only 升级为 read/write/generate 三类检查。
- owner/editor/viewer/admin 的基础授权差异已有测试覆盖。
- local auth mode 继续兼容 ownerless 历史项目；public auth mode 不继承该兼容。
- 新增 CSRF token helper 和审计日志脱敏 helper。

最近一次 M40-A 验收记录显示：

- `node --test tests\public-auth-model.test.mjs tests\public-auth-csrf.test.mjs tests\public-auth-audit-log.test.mjs` 通过：5 tests passed。
- `node --test tests\auth-security-hardening.test.mjs` 通过：5 tests passed。
- `node --test tests\local-session-auth.test.mjs` 通过：2 tests passed。
- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage40-public-auth-authorization.test.ts --maxWorkers=1` 通过：3 tests passed。
- `npm test` 通过：Node 79 tests passed；Vitest 24 files / 91 tests passed。
- `npm run build` 通过。
- `npm run test:e2e:stage7` 通过：Chromium desktop 1 passed。

因此当前可以表述为“公网认证服务端模型、会话边界、membership 授权底座、CSRF-ready helper 和审计脱敏 helper 已具备”，但仍不能表述为“密码登录、OAuth/SSO、完整 CSRF 落库校验、管理员/共享协作 UI 或公网部署已完成”。

## 4. 当前产品就绪结论

当前可以如实表述为：

> ShanHaiEdu 已具备本地 deterministic 材料生产 MVP：教师可以在本机浏览器完成从一句话需求到最终交付清单 Markdown 的连续材料生产闭环，且项目、消息、节点产物、确认状态、产物复用引用和当前项目选择可由后端与浏览器状态恢复支撑。该主链路已在 Chromium desktop、Chromium narrow viewport 和 Firefox desktop 验证通过，最终交付清单已支持真实 `.md` 文件下载，PPT 大纲已支持基于当前 artifact 生成并下载最小 `.pptx` 文件，最终交付清单已同步说明该 PPTX 最小下载能力，并已支持包含 Markdown、最小 PPTX、可选导入视频和可选课堂视觉图的真实 `.zip` 材料包下载。服务端 smoke 层已能通过私有台账固定 fallback 通道完成真实 OpenAI-compatible live smoke。PPT 真实生成阶段已具备固定提示词、教材 fixture、Coze env readiness，并已通过真实 Coze `/run` PPTX 下载 smoke；后端 artifact 层已能保存并优先下载本地真实 Coze PPTX，教师界面已具备触发真实 PPTX 的入口，浏览器专项已验证触发、刷新和下载联动。图片真实 API 阶段已通过固定 `free` 通道完成服务端 live smoke，已具备后端 artifact adapter 保存本地图片 metadata、后端本地图片下载 route、最终材料包图片资产集成能力、教师界面触发入口和浏览器下载联动验证。视频真实 API 阶段已通过固定 `octo` 通道完成服务端 submit/query/download live smoke，已具备后端 artifact adapter 保存本地 MP4 metadata、后端本地 MP4 下载 route、最终材料包视频资产集成能力、教师界面触发入口和浏览器下载联动验证。真实 PPTX、图片和视频素材已具备可配置部署卷的本地 ArtifactStorage 准备，metadata 可避免保存机器绝对路径。本地浏览器会话已具备最小用户身份和项目访问边界，项目列表、项目读写、真实生成与下载 route 已按本地 actor 隔离，并具备跨站写入阻断、HTTPS Secure cookie 和基础安全响应头。真实 PPTX、图片和视频生成已具备持久化任务状态基础，可记录排队、运行、成功、失败和刷新恢复列表。当前已具备上线前本地生产准备检查、Next standalone 构建准备、本地生产 SQLite 初始化、素材存储根目录检查、客户端 exe 验证准备、真实 Windows 客户端未签名候选包生成能力、默认 unpacked exe 安装包 smoke、显式静默安装/启动/卸载 smoke、自动化安装体验关键系统证据 smoke，已消除既有 Next/Turbopack NFT tracing warning，并已具备客户端基础 metadata、图标、asar/unpack、日志和崩溃目录。

当前不能表述为：

- PPTX 内嵌图片已完成。
- Coze 官方 OpenAPI 主链路已完成。
- PPTX 已完成图片、动画和视觉精修。
- 视频在线播放、Range 请求、独立生产 worker 或视频质量验收已完成。
- 已具备完整公网账号、密码登录、OAuth/SSO、组织/班级权限或生产级多人协作。
- 已完成完整 CSRF 落库校验、管理员/共享协作 UI 或审计查询 UI。
- 已完成完整 CSP、HSTS、rate limit、正式登录风控或生产安全监控。
- 已完成公网发布、域名、HTTPS 或远端生产部署。
- 已完成对象存储、CDN、素材生命周期清理或部署运维。
- 已完成正式签名客户端安装包、自动更新、人工可见安装向导、窗口生命周期或系统权限验收。

当前成熟度判断：

- 内部骨架成熟度：约 99%。核心 workflow、后端持久化、浏览器主链路、产物复用输入、窄屏/Firefox 覆盖、Markdown 下载交付、PPTX 最小下载、最终交付口径同步、ZIP 材料包下载、真实 OpenAI-compatible smoke、PPT 固定样本、真实 Coze PPT smoke、Coze PPT artifact adapter、图片真实 API smoke、图片 artifact adapter、图片下载 route、材料包图片资产集成、视频真实 API smoke、视频 artifact adapter、视频下载 route、视频材料包资产集成、教师 UI 真实生成入口、真实生成浏览器联动、统一本地素材存储边界、本地会话身份、项目访问边界、真实生成任务状态基础、上线前本地生产准备检查、阶段测试与文档闭环已经成形。
- 生产就绪度：约 93%-94%。真实文本 smoke、Coze PPT `/run` smoke、Coze PPT artifact adapter、图片 live smoke、图片 artifact adapter、图片下载 route、图片材料包集成、视频 live smoke、视频 artifact adapter、视频下载 route、视频材料包集成、教师 UI 真实生成入口、浏览器联动验证、可配置部署卷准备、本地权限最小闭环、账号安全加固、真实生成任务状态基础、Next standalone 准备、生产预检、本地生产 SQLite 初始化、客户端 exe 验证准备、真实 Windows 未签名候选包生成、默认 unpacked exe smoke、显式静默安装/启动/卸载 smoke、自动化安装体验关键系统证据 smoke、Next standalone tracing 收敛和客户端基础产品化工程边界已通过，但业务节点真实模型全面接入、Coze 官方 OpenAPI 主链路、独立 worker、公网正式认证、正式签名客户端安装包、远端部署、安全与运维仍未完成。

## 5. 剩余风险

- M14 live OpenAI-compatible smoke 已通过，但 primary/third 台账通道当前返回 403，固定通道暂选 fallback。
- 业务工作流节点仍主要使用 deterministic runtime，真实模型尚未全面接入节点生成链路。
- M15 已纳入教材 PDF fixture；后续外发、部署或公开演示前需单独确认版权和发布边界。
- Coze PPT `/run` smoke、artifact adapter 和教师 UI 显式触发入口已通过，但尚未完成 Coze 官方 OpenAPI 主链路。
- Coze PPT、图片和视频素材已支持可配置部署卷准备；但对象存储、CDN、备份、清理和生命周期策略仍未完成。
- M18 图片 live smoke 已通过，M19 已接入后端 artifact adapter，M24 已提供图片下载 route，M25 已提供最终材料包图片资产，M26 已提供教师 UI 入口，M27 已通过浏览器下载联动；但当前尚未提供 PPTX 内嵌图片。
- M18 `primary` 图片通道曾返回 403，当前固定通道为 `free`；后续切换通道必须重新跑 smoke。
- M20 视频 live smoke 已通过，M21 已接入后端 artifact adapter，M22 已提供视频下载 route，M23 已集成最终材料包视频资产，M26 已提供教师 UI 入口，M27 已通过浏览器下载联动；但当前尚未提供独立生产队列、对象存储或质量验收。
- M38 已消除既有 Next/Turbopack NFT tracing warning；但生产部署前仍需在真实部署目录、部署卷、数据库路径和素材下载 route 下复查 standalone 产物。
- M30 已有持久化 job 状态，但当前仍是 route inline 执行 provider，不等于独立后台 worker、生产调度或可取消/可重试的完整队列系统。
- M31 已有本地生产预检和 runbook，但尚未在真实远端服务器、域名、HTTPS、进程守护或客户端 exe 容器内验证。
- M40-A 已有公网认证服务端模型、会话边界、membership 授权底座、CSRF-ready helper 和审计脱敏 helper；但密码登录、OAuth/SSO、完整 CSRF 落库校验、管理员/共享协作 UI、审计查询 UI、完整 CSP、HSTS、rate limit 和登录风控仍未完成。
- M33 已有客户端 exe 验证准备和 localhost 容器等价 E2E，但没有真实 exe 打包工程，不能替代安装包验收。
- M39 已验证未签名候选包的基础图标、metadata、asar/unpack、隔离 userData 日志/崩溃目录和默认启动 smoke；但安装耗时接近 10 分钟，后续仍需正式签名、自动更新、崩溃上报、人工可见安装向导和窗口生命周期专项验收。
- 浏览器 E2E 已覆盖 Chromium desktop、Chromium narrow viewport 和 Firefox desktop；WebKit、真实移动设备和触摸手势仍待专项验证。
- 当前 PPTX 只是根据文本大纲生成的最小可下载文件，不包含真实图片、视频、动画或精修视觉设计。
- 当前材料包已包含最终交付 Markdown、最小 PPTX、可选图片与可选视频，但不包含动画或视觉精修资产。
- 当前已具备本地会话、项目 owner 隔离和公网认证服务端底座，但这不是完整公网认证；密码、OAuth/SSO、组织/班级、共享协作、管理员 UI 和审计查询仍未完成。
- SQLite 可继续支撑本地 MVP 试用，但不应被包装为生产级数据库方案。
- `deterministic_draft` 和 deterministic 文本产物必须继续标注为开发态草稿或本地确定性生成结果。

## 6. 推荐下一阶段

优先级从高到低：

1. 做 M40-B 密码登录最小闭环，覆盖强哈希、登录/退出/当前用户 API、session 过期/撤销和错误不泄露。
2. 做任务队列生产化规划，覆盖 worker、重试、取消、限流、监控和失败 repair。
3. 做 WebKit、真实移动设备或触摸手势专项验证。
4. 做正式签名、自动更新和人工可见安装向导专项。

## 7. 审查结论

M0-M5 文本主链路已经通过本地浏览器验证，M6 readiness 已通过，M7 本地双上下文隔离已通过，M8 窄屏 Chromium 与 Firefox desktop 覆盖已通过，M9 最终交付清单 Markdown 下载已通过，M10 产物复用输入闭环已通过，M11 PPTX 最小下载闭环已通过，M12 最终交付清单 PPTX 能力口径同步已通过，M13 最终材料包 ZIP 下载已通过，M14 私有台账 OpenAI-compatible live smoke 已通过，M15 PPT 样本资产与 Coze readiness 已通过，M16 Coze PPT `/run` live smoke 已通过，M17 Coze PPT 后端 artifact adapter 已通过，M18 图片真实 API live smoke 已通过，M19 图片后端 artifact adapter 已通过，M20 视频真实 API live smoke 已通过，M21 视频后端 artifact adapter 已通过，M22 视频下载 route 已通过，M23 最终材料包视频资产集成已通过，M24 图片下载 route 已通过，M25 最终材料包图片资产集成已通过，M26 教师 UI 真实生成入口已通过，M27 真实生成浏览器联动验证已通过，M28 素材存储生产准备已通过，M29 本地账号权限最小闭环已通过，M30 真实生成任务队列基础已通过，M31 生产部署本地准备已通过，M32 账号权限安全加固已通过，M33 客户端 exe 验证准备已通过，M34 真实客户端 exe 最小打包已通过，M35 默认安装包 smoke 已通过，M36 显式静默安装/启动/卸载 smoke 已通过，M37 自动化安装体验关键系统证据 smoke 已通过，M38 Next standalone tracing 收敛已通过，M39 客户端基础产品化工程边界已通过，M40-A 公网认证服务端底座已通过。

因此当前主线可以作为“本地 deterministic 材料生产 MVP 可用 + 服务端真实文本模型 smoke 可用 + Coze PPT 真实 smoke、后端 artifact、教师触发入口与浏览器下载联动可用 + 图片真实 API smoke、后端 artifact、下载、材料包、教师触发入口与浏览器下载联动可用 + 视频真实 API smoke、后端 artifact、下载、材料包、教师触发入口与浏览器下载联动可用 + 真实素材可配置部署卷准备可用 + 本地会话和项目访问边界可用 + 本地账号安全加固可用 + 公网认证服务端模型/会话边界/membership 授权底座/CSRF-ready helper/审计脱敏 helper 可用 + 真实生成持久化任务状态基础可用 + 上线前本地生产准备可用 + 客户端 exe 验证准备可用 + 真实 Windows 未签名候选包可生成 + 默认 unpacked exe smoke 可通过 + 显式静默安装/启动/卸载 smoke 可通过 + 自动化安装体验关键系统证据 smoke 可通过 + Next standalone tracing warning 已消除 + 客户端基础 metadata、图标、asar/unpack、日志和崩溃目录可用”的候选状态继续推进，但不能作为“密码登录/OAuth/SSO 已完成、正式签名客户端已发布、人工可见安装向导已完成、独立生产 worker、远端生产部署和公网正式认证已完成”的最终状态。
