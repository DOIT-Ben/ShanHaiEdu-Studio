# Local Real MVP M27 Real Generation Browser Linkage Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M27 的核心需求是验证 M26 新增的教师真实生成入口在真实浏览器里可用：按钮要出现在正确产物详情中，点击后要请求正确后端 route，项目 snapshot 要刷新出对应新 artifact，随后下载按钮和最终材料包要能利用新 artifact。

本阶段不是再次调用真实 provider。M16、M18、M20 已经覆盖真实 provider smoke，M17、M19、M21 已经覆盖后端 artifact adapter。M27 要验证的是浏览器 UI、前端 data source、后端 route 合同和下载联动的闭环。

本阶段必须满足：

- 浏览器中 PPT 大纲详情能看到“生成真实 PPTX”和“生成课堂视觉图”。
- 浏览器中导入视频方案详情能看到“生成导入视频”。
- 点击生成按钮后前端请求对应 route：`coze-ppt`、`image`、`video`。
- 成功后刷新 snapshot，并出现新保存的真实素材 artifact。
- 新 artifact 的下载按钮可见并可触发真实下载 route。
- 最终材料包可以包含已生成的图片/视频资产。
- 教师可见界面仍不暴露工程词。

## 2. 可复用方案调研

项目内可复用资产：

- `tests\e2e\stage2-deterministic.spec.ts`：项目创建、节点推进、产物详情、下载和红线扫描 helpers。
- `scripts\run-stage2-e2e.mjs`：独立测试数据库、单 worker、API-backed 前端运行模式。
- M17/M19/M21 route 测试：真实生成 route 的 artifact 保存合同。
- M24/M25/M23 下载与材料包测试：PPTX、图片、视频和 ZIP 文件头校验模式。

成熟做法判断：

- 浏览器专项测试应使用受控替身拦截真实 provider route，避免重复消耗真实 API、避免长任务不稳定。
- 受控替身必须仍走前端真实点击、真实 HTTP 请求、真实 snapshot 刷新和真实下载检查。
- 不应把测试替身引入生产代码；优先使用 Playwright `page.route` 拦截 POST，并调用普通 `POST /artifacts` route 写入测试 artifact。

## 3. 复用、适配和必要自研

复用：

- 复用 Stage2 的项目创建与节点确认 helper 思路。
- 复用现有 `POST /api/workbench/projects/[projectId]/artifacts` 测试写入能力，创建带本地 metadata 的真实素材 artifact。
- 复用下载 route 校验：PPTX `PK`、PNG 魔数、MP4 `ftyp`、ZIP `PK`。

适配：

- 新增 `tests\e2e\stage27-real-generation-linkage.spec.ts`。
- 新增 `scripts\run-stage27-e2e.mjs`，使用独立 `test-results/stage27-e2e.db`。
- E2E 中拦截 `POST /coze-ppt`、`POST /image`、`POST /video`，写入测试 artifact 后返回 JSON。
- 测试创建 `.tmp\stage27-e2e` 下的最小 PPTX/PNG/MP4 fixture，确保下载 route 和材料包 route 可读取。

必要自研：

- 浏览器用例覆盖按钮显示、请求路径、生成成功提示、下载按钮可用、最终材料包包含图片和视频。
- M27 报告和当前审计更新。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M27 阶段规划和测试定义。
2. 写红灯 E2E：当前没有 stage27 spec/runner。
3. 实现 stage27 spec 和 runner，不改生产代码，除非测试暴露真实问题。
4. 跑 M27 目标 E2E 绿灯。
5. 跑 `npm test`、`npm run build`。
6. 跑必要的 Stage2 或 Stage8 回归。
7. 更新 M27 报告和当前状态审计。
8. 做空白、ignore、敏感扫描和残留进程检查。
9. 提交 M27，不 push。

主要风险：

- Playwright route 替身如果绕过真实前端行为，会削弱测试价值；必须从真实按钮点击触发。
- 测试 fixture 必须写入 `.tmp`，且 `.tmp` 保持 ignored。
- 不能把 provider 成功说成 M27 证明；M27 只证明 UI 到后端合同与下载联动。

验证标准：

- `node scripts\run-stage27-e2e.mjs` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- 教师可见界面无工程词。
- `.env`、`.tmp`、测试生成素材不进入 git。
