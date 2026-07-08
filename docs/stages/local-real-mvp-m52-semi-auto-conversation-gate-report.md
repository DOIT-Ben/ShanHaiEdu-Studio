# M52 半自动对话触发门与选项式澄清验收报告

日期：2026-07-08 13:20

## 范围

- 普通聊天不再触发需求规格产物卡。
- 明确公开课备课需求后才进入需求规格和产物链。
- Assistant 回复下提供可点击选项，其中包含推荐项。
- 选项点击只填入输入框，等待用户修改或确认发送。
- 左侧“公开课备课”栏目可折叠，未开放工具默认不进入主视觉。

## 实现摘要

- `ChatTranscript` 增加真实产物门槛：只有 assistant 文案带完成信号，且匹配到带 `artifactId` 的已生成产物时，才展示对话内嵌产物卡。
- `ChatTranscript` 增加 quick reply chips，普通问候和澄清类回复下给出推荐选项。
- `useWorkbenchController` 增加 `selectQuickReply`，点击选项后只写入 composer，不自动发送。
- `ProjectSidebar` 增加公开课栏目折叠状态，并将未开放的回收站入口默认隐藏。
- `conversation-orchestrator` 将确定性分支拆为 `isCasualChat` 与 `isExplicitLessonWorkRequest`，避免仅凭“生成/设计”泛词启动备课链路。

## 验收记录

| 命令或流程 | 结果 |
| --- | --- |
| `node --test tests\m52-semi-auto-conversation-gate.test.mjs` | 通过，5/5 |
| `node --test tests\m52-semi-auto-conversation-gate.test.mjs tests\m51-interaction-polish-and-button-audit.test.mjs tests\m50-artifact-rail-markdown-preview.test.mjs` | 通过，14/14 |
| `$env:DATABASE_URL='file:./.tmp/test-workbench.db'; node scripts/init-sqlite-schema.mjs; npx vitest run src\server\workbench\__tests__\stage7-mainline-contract.test.ts --maxWorkers=1` | 通过，5/5 |
| `npm test` | 通过，Node 122/122；Vitest 25 files / 100 tests |
| `npm run build` | 通过，Next.js production build 成功 |

## 浏览器验收

本地地址：`http://127.0.0.1:3002`

- 输入“你好”：未出现“生成内容已进入产物链”；出现 3 个可选回复，其中 1 个推荐项。
- 点击推荐项：输入框填入“我想做三年级数学公开课，需要教案、PPT大纲和导入视频方案。”，未自动发送。
- 输入“我想做三年级数学《长方形和正方形的周长》公开课，需要教案、PPT大纲和导入视频方案。”：出现“需求规格说明书已生成”和“生成内容已进入产物链”。
- 点击左侧“公开课备课”：`aria-expanded` 从 `true` 到 `false`，再次点击恢复 `true`。
- 390x844 移动端：无页面级横向溢出，项目入口、产物入口和输入框均存在。

## 风险与后续

- 当前 quick reply 仍由前端规则生成，后续可以升级为后端需求智能体返回结构化选项。
- 当前真实模型分支可能先追问缺失课题；完整课题输入后会进入需求规格产物链，这是符合半自动澄清的行为。
- 本阶段未新增真实 PPTX、图片或视频 provider 能力，只收口对话入口和半自动选择体验。
