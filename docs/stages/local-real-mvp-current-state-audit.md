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
- 缺少 `OPENAI_API_KEY` 时脚本以非 0 退出。
- 输出包含 `missing_OPENAI_API_KEY`，不打印密钥值。
- 不允许 smoke 脚本静默回落 deterministic 冒充真实 OpenAI 结果。
- OpenAI SDK 仍只在服务端 runtime adapter 或脚本上下文使用，没有进入 React。

当前限制：

- 本机 `OPENAI_API_KEY` 未设置。
- `OPENAI_MODEL` 未设置。
- `OPENAI_BASE_URL` 未设置。
- 仓库根目录无 `.env*` 文件。
- 因此 M6 live OpenAI smoke 未通过，不能标记为真实模型可用。

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

## 4. 当前产品就绪结论

当前可以如实表述为：

> ShanHaiEdu 已具备本地 deterministic 材料生产 MVP：教师可以在本机浏览器完成从一句话需求到最终交付清单 Markdown 的连续材料生产闭环，且项目、消息、节点产物、确认状态、产物复用引用和当前项目选择可由后端与浏览器状态恢复支撑。该主链路已在 Chromium desktop、Chromium narrow viewport 和 Firefox desktop 验证通过，最终交付清单已支持真实 `.md` 文件下载，PPT 大纲已支持基于当前 artifact 生成并下载最小 `.pptx` 文件，最终交付清单已同步说明该 PPTX 最小下载能力，并已支持包含 Markdown 与最小 PPTX 的真实 `.zip` 材料包下载。

当前不能表述为：

- 真实 OpenAI 模型已跑通。
- PPTX 已完成图片、动画和视觉精修。
- 图片文件已生成。
- 视频成片已生成。
- 已具备账号、权限或生产级多人协作。
- 已完成生产部署或公网发布。

当前成熟度判断：

- 内部骨架成熟度：约 82%-86%。核心 workflow、后端持久化、浏览器主链路、产物复用输入、窄屏/Firefox 覆盖、Markdown 下载交付、PPTX 最小下载、最终交付口径同步、ZIP 材料包下载、阶段测试与文档闭环已经成形。
- 生产就绪度：约 33%-42%。真实 provider、图片/视频生成、账号权限、生产部署、安全与运维仍未完成。

## 5. 剩余风险

- M6 live OpenAI smoke 缺少真实凭据，真实模型路径尚未证明。
- 浏览器 E2E 已覆盖 Chromium desktop、Chromium narrow viewport 和 Firefox desktop；WebKit、真实移动设备和触摸手势仍待专项验证。
- 当前 PPTX 只是根据文本大纲生成的最小可下载文件，不包含真实图片、视频、动画或精修视觉设计。
- 当前材料包已包含最终交付 Markdown 与最小 PPTX，但不包含图片、视频、动画或视觉精修资产。
- 当前隔离是无账号本地工作台隔离，不是权限隔离。
- SQLite 可继续支撑本地 MVP 试用，但不应被包装为生产级数据库方案。
- `deterministic_draft` 和 deterministic 文本产物必须继续标注为开发态草稿或本地确定性生成结果。

## 6. 推荐下一阶段

优先级从高到低：

1. 补验 M6 live OpenAI smoke：配置 `OPENAI_API_KEY` 后运行 `node scripts\openai-smoke.mjs`，只有返回 `ok=true`、`runtimeKind=openai`、`generationMode=model_generated` 时，才可标记真实模型 smoke 通过。
2. 做真实文件能力拆分规划：PPTX 质量增强、图片、视频分别按 provider readiness、产物合同、存储路径、失败恢复和教师可见边界分阶段推进。
3. 做 WebKit、真实移动设备或触摸手势专项验证。
4. 在进入多人或部署前，先定义账号/权限、数据库迁移和长任务队列触发条件。

## 7. 审查结论

M0-M5 文本主链路已经通过本地浏览器验证，M6 readiness 已通过但 live OpenAI smoke 未通过，M7 本地双上下文隔离已通过，M8 窄屏 Chromium 与 Firefox desktop 覆盖已通过，M9 最终交付清单 Markdown 下载已通过，M10 产物复用输入闭环已通过，M11 PPTX 最小下载闭环已通过，M12 最终交付清单 PPTX 能力口径同步已通过，M13 最终材料包 ZIP 下载已通过。

因此当前主线可以作为“本地 deterministic 材料生产 MVP 可用”的候选状态继续推进，但不能作为“真实模型、图片与视频生产 MVP 已完成”的最终状态。
