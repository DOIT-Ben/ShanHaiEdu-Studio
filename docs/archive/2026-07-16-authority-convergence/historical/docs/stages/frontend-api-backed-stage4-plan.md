# Frontend API-backed Workbench Stage 4 Plan

日期：2026-07-07

## 1. 当前目标

Stage 4 的目标是对现有 Codex 风格工作台做响应式和关键交互集中回归，只做必要小修，不重写 UI、不引入新视觉系统。

成功标准：

- 桌面端保持项目栏、对话主区域、产物 rail 和详情/预览层次清晰。
- 窄屏端保留 `项目` 与 `产物`入口，页面级无横向溢出。
- 复制、作为输入、确认、重做、详情查看、发送、Enter、Shift+Enter 等核心交互有浏览器证据。
- hover 预览不与详情侧栏冲突。
- 普通用户界面不出现工程词。
- Stage 1-3 的 API-backed controller、artifact id 边界和 development adapter 语义不退化。

## 2. 第一性原理

本阶段不是“做漂亮”，而是确保教师在一个屏幕里能继续完成工作：

```text
选项目 -> 看对话 -> 找产物 -> 复制/作为输入/确认/详情 -> 继续发送
```

如果窄屏入口消失、hover 预览挡住详情、发送后没有反馈、复制动作不可达，前端即使接了 API 也不可用。

## 3. 调研与复用

复用项目既有结构：

- `MediaWorkbench` 负责桌面三栏和窄屏 drawer。
- `ConversationWorkbench` + `PromptComposer` 负责发送、Enter 和 Shift+Enter。
- `ChatTranscript` 已有 `aria-label="复制回复"`。
- `ArtifactRail` 已有 `.artifact-preview-popover`，并通过 `previewDisabled` 避免详情打开时 hover 预览叠加。
- `ArtifactDetailSheet` 和 `ArtifactSidePanel` 承载详情、复制、作为输入和确认。

复用已安装工具：

- Codex bundled Playwright + 本机 Chrome 做桌面和 390px 窄屏自动化验证，不把 Playwright 写入项目依赖。
- 继续使用 `npm test`、`npx tsc --noEmit`、`npm run build`、工程词扫描和 `git diff --check`。

必要自研或小修：

- 若浏览器回归发现某个交互不可达，只做局部修复。
- 若需要稳定测试选择器，优先使用现有 id/aria-label/class，不新增工程词可见文案。

## 4. 开发方案

### 4.1 文件范围

预计可能修改：

- `src\components\conversation\PromptComposer.tsx`
  - 若 Enter/Shift+Enter 或 near-field feedback 不满足验收，局部修复。
- `src\components\conversation\ChatTranscript.tsx`
  - 若复制按钮 hover/focus 可达性不满足验收，局部修复。
- `src\components\artifacts\ArtifactRail.tsx`
  - 若 hover 预览和详情侧栏冲突，局部修复。
- `src\components\layout\MediaWorkbench.tsx`
  - 若窄屏 drawer 入口或详情层级有问题，局部修复。
- `docs\stages\frontend-api-backed-stage4-closeout.md`
  - 记录最终浏览器证据、审查处理和剩余风险。
- `docs\mainlines\frontend-api-backed-workbench.md`
  - Stage 4 完成后更新主线状态和可合并判断。

如果浏览器回归全部通过，则本阶段可以只提交文档验收记录，不为“有代码改动”而改代码。

### 4.2 阶段步骤

1. 写 Stage 4 测试文档。
2. 启动本地 dev server。
3. 用真实浏览器集中回归桌面和窄屏。
4. 若失败，按 TDD/最小修复处理，并复测失败项。
5. 跑自动化验收。
6. 自审或独立审查。
7. 写 closeout，提交并 push。

## 5. 不做范围

- 不重写 UI，不做 landing page，不换视觉风格。
- 不接真实 provider。
- 不实现后端 regenerate 版本合同。
- 不改数据库、后端 route 或 OpenAI 调用。
- 不提交 `SHANHAIEDU_LEGACY_RETROSPECTIVE.md`。

## 6. 风险与回退

风险：

- `npm run lint` 仍是 Next 16 脚本债务，可能继续失败；本阶段只记录或在风险可控时修复脚本。
- 浏览器 automation 可能受工具 viewport 限制影响；以 Codex bundled Playwright + 本机 Chrome 作为窄屏权威验证。
- development adapter 只证明前端交互，不证明真实后端生产能力。

回退：

- 若交互小修引入视觉退化，回退该局部组件修改，保留 Stage 3 的 API-backed 边界。

## 7. 验证标准

- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- `npm run lint`，若仍失败则记录 Next 16 脚本债务原文。
- `rg -n "schema|manifest|provider|node_id|storage|API|debug|local path" src`
- `git diff --check`
- Playwright 桌面 `1440x900`：
  - 项目/对话/产物 rail 可见。
  - hover 产物节点出现预览。
  - 打开侧栏后 hover 不出现预览叠加。
  - 详情、复制、作为输入、确认入口可达。
  - 点击发送和 Enter 发送有反馈；Shift+Enter 保留换行。
  - hover assistant reply 时复制回复按钮可见。
- Playwright 窄屏 `390x844`：
  - `项目`、`产物`入口可见。
  - 页面级无横向溢出。
  - composer 可见可用。
