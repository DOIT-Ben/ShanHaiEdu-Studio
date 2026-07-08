# M51 对话产物展开与前端交互审计测试定义

日期：2026-07-08

## 红灯测试

新增 `tests/m51-interaction-polish-and-button-audit.test.mjs`，先验证当前缺口：

1. `ProjectSidebar` 使用真实 input 搜索课题，包含 `placeholder="搜索课题"`、`value={searchQuery}`、`onChange` 和项目筛选。
2. `ChatTranscript` 的 inline 产物卡包含 `data-inline-artifact-toggle`、`aria-expanded` 和展开态 `data-inline-artifact-expanded`。
3. AI logo 使用 `/brand/shanhai-ai-logo-256.png`，并且该资产存在。
4. `ArtifactSidePanel` 在 resizing 时禁用宽度 transition，`ResizableHandle` 暴露 resize start/end 回调。
5. `MediaWorkbench` 将 `controller.sidePanelOpen` 传给 `ConversationWorkbench` 的 compact 模式；`WorkbenchTopbar` 和 `StageProgress` 支持 compact。
6. 明确未接能力按钮：协作和回收站不能是无反馈可点击假按钮。

## 集中验收命令

```powershell
node --test tests/m51-interaction-polish-and-button-audit.test.mjs tests/m50-artifact-rail-markdown-preview.test.mjs tests/m49-chat-scroll-and-delight.test.mjs
npm test
npm run build
git diff --check
```

## 浏览器验收

桌面端：

- 打开本地工作台，点击“搜索课题”输入并确认项目列表筛选。
- 新建项目，发送一条需求，等待 AI 回复。
- 点击 inline 产物卡“展开查看”，确认卡片展开；再点击“收起”恢复紧凑。
- 点击右侧 rail 节点打开侧栏，确认顶部栏和阶段条缩小而不溢出。
- 拖动侧栏宽度，确认体感不再有明显延迟。
- 检查协作、回收站等未接能力是否明确禁用。

窄屏：

- 搜索输入可用。
- “产物”按钮可打开抽屉。
- inline 产物卡展开后不撑破屏幕。

## 证据要求

- 保存桌面截图：展开前、展开后、侧栏打开压缩态。
- 保存窄屏截图：搜索/抽屉/inline 展开。
- 输出浏览器自动检查 JSON，包含关键按钮和布局状态。

