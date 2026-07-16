# M50 产物链与 Markdown 对话预览测试定义

日期：2026-07-08

## 红灯测试

新增 `tests/m50-artifact-rail-markdown-preview.test.mjs`，先验证以下行为缺失：

1. `MediaWorkbench` 桌面端有 `hidden ... lg:block` 常驻 rail 容器，并向 `ArtifactRail` 传入 `previewDisabled={controller.sidePanelOpen}`。
2. 移动端/窄屏仍保留 `controller.railOpen` 的 drawer 产物入口。
3. `ConversationWorkbench` 将 artifacts 传给 `ChatTranscript`。
4. `ChatTranscript` 渲染 `data-generated-artifact-inline` 对话内产物预览。
5. `MarkdownPreview` 具备 `renderMarkdownBlocks` 或等价轻量 Markdown 渲染函数，支持标题、列表和段落。
6. `ArtifactDetailSheet` 复用 `MarkdownPreview`，避免在完整详情里再次把 Markdown 当纯文本输出。
7. `ArtifactSidePanel`、`ArtifactDetailSheet`、`ArtifactRail` 使用同一组浅青绿色边线和背景语气。

同步更新 `tests/m48-chat-first-ui.test.mjs`，不再断言桌面 rail 被移除，只保留“抽屉入口可用”的要求。

## 集中验收命令

```powershell
node --test tests/m50-artifact-rail-markdown-preview.test.mjs tests/m48-chat-first-ui.test.mjs tests/m49-chat-scroll-and-delight.test.mjs
npm test
npm run build
git diff --check
```

## 浏览器验收

桌面端：

- 打开本地工作台，确认右侧糖葫芦 rail 常驻。
- 点击 rail 节点，确认侧栏打开且 hover 预览不会覆盖侧栏。
- 触发一次对话生成，确认 assistant 回复下出现产物预览卡。
- 打开完整详情，确认 Markdown 标题和列表正常排版。

窄屏：

- 确认右 rail 不常驻。
- 顶部“产物”按钮可打开抽屉。
- 抽屉、详情和 Markdown 排版可读。

## 审查清单

- 普通界面不出现工程词。
- 不把 deterministic 草稿说成真实模型完成。
- 不改动 provider、后端持久化合同或部署配置。
- 不引入外部 Markdown 依赖。

