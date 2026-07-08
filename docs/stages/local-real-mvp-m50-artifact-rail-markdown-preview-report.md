# M50 产物链与 Markdown 对话预览验收报告

日期：2026-07-08

## 结论

通过。

M50 已修复 M49 后的前端体验回归：桌面端右侧“糖葫芦”线性产物 rail 已恢复；AI 回复下方会展示生成产物的对话内预览；产物详情和侧栏中的 Markdown 已按标题、列表和段落渲染；右侧 rail、侧栏和详情 sheet 已统一到 ShanHaiEdu AI 当前浅青绿色视觉语气。

## 完成项

- 恢复桌面端常驻压缩产物 rail。
- 保留窄屏“产物”抽屉入口。
- 侧栏打开时禁用 rail hover 预览，避免覆盖详情面板。
- `ConversationWorkbench` 将当前产物传入 `ChatTranscript`。
- assistant 生成类回复下新增 `data-generated-artifact-inline` 产物预览卡。
- `MarkdownPreview` 新增轻量 Markdown 文本解析，支持标题、列表和段落。
- `ArtifactDetailSheet` 复用 `MarkdownPreview`，不再手写纯文本内容块。
- 统一 `ArtifactRail`、`ArtifactSidePanel`、`ArtifactDetailSheet` 的浅青绿色边线和背景。

## 验证记录

| 命令或检查 | 结果 |
| --- | --- |
| `node --test tests/m50-artifact-rail-markdown-preview.test.mjs tests/m48-chat-first-ui.test.mjs tests/m49-chat-scroll-and-delight.test.mjs` | 通过，11/11 |
| `npm test` | 通过，Node 112/112；Vitest 25 files / 100 tests |
| `npm run build` | 通过，Next.js 编译、TypeScript、静态页面生成均通过 |
| Playwright 桌面真实流程 | 通过，对话生成后有 inline 产物预览、AI logo 和 8 个右 rail 节点 |
| Playwright 桌面侧栏 | 通过，点击需求规格节点打开侧栏，Markdown 标题和列表正常渲染，未裸露 `## 项目概述` |
| Playwright 窄屏 | 通过，右 rail 不常驻，顶部“产物”按钮打开线性产物抽屉 |

## 浏览器证据

- `.tmp/m50-playwright-desktop-inline-rail.png`
- `.tmp/m50-playwright-desktop-sidepanel-markdown.png`
- `.tmp/m50-playwright-mobile-drawer.png`

## 风险与边界

- 对话内产物预览使用当前产物列表做只读展示，没有新增后端消息到产物的强绑定合同。后续若要每条消息精确关联多个产物，应在后端消息模型中补充关系字段。
- Markdown 渲染只支持 MVP 需要的安全子集：标题、列表和段落；不支持 HTML、表格或复杂嵌套。
- 本阶段只修复对话工作台前端体验，不改变 provider、生产部署、账号权限或后端持久化合同。

