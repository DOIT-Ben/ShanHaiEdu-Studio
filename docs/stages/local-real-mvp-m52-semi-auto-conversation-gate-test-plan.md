# M52 半自动对话触发门与选项式澄清测试定义

日期：2026-07-08

## 红灯测试

新增 `tests/m52-semi-auto-conversation-gate.test.mjs`：

1. `ChatTranscript` 产物卡必须要求 artifactId，不能对未生成节点展示 inline 产物卡。
2. `ChatTranscript` 支持 quick reply chips，含 `data-quick-reply-choice`、推荐项标识和点击回填。
3. `ConversationWorkbench` / `useWorkbenchController` 将 quick reply 选择写入输入框，不自动发送。
4. `ProjectSidebar` 支持公开课栏目折叠，并且回收站入口不再常驻主视觉。
5. `conversation-orchestrator` 收紧普通聊天触发：问候不生成需求，明确备课/课件请求才进入业务链路。

## 集中验收命令

```powershell
node --test tests/m52-semi-auto-conversation-gate.test.mjs tests/m51-interaction-polish-and-button-audit.test.mjs tests/m50-artifact-rail-markdown-preview.test.mjs
npx vitest run src/server/workbench/__tests__/stage7-mainline-contract.test.ts --maxWorkers=1
npm test
npm run build
git diff --check
```

## 浏览器验收

- 发送“你好”，确认只出现普通回复和选项 chip，不出现 inline 产物卡。
- 点击推荐选项，确认输入框被填充，且没有自动发送。
- 发送明确备课需求，确认出现需求规格产物和右侧节点。
- 折叠/展开“公开课备课”栏目，确认项目列表随之隐藏/显示。
- 窄屏仍能打开项目和产物抽屉。
