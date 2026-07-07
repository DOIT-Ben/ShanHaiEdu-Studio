# Frontend API-backed Workbench Stage 4 Closeout

日期：2026-07-07

## 1. 阶段结论

Stage 4 已完成，可提交并推送本阶段变更。

本阶段没有重写 UI，只对现有 Codex 风格工作台做响应式与关键交互回归，并修复复制动作缺少近场反馈的问题。前端 API-backed 主线在前端边界内已完成：项目列表、snapshot、消息、节点、产物和确认状态均通过 controller/data source/API client 边界承接；后端真实 route 和 provider 能力仍由对应后端主线负责。

## 2. 完成内容

- `docs\stages\frontend-api-backed-stage4-plan.md`
  - 定义 Stage 4 范围：响应式、hover/detail 层级、复制、作为输入、确认、发送和键盘行为。
- `docs\stages\frontend-api-backed-stage4-test-plan.md`
  - 定义桌面、窄屏和关键交互集中验收脚本。
- `src\hooks\useWorkbenchController.ts`
  - `copyArtifact` 返回复制结果，供组件给出近场反馈。
- `src\hooks\useArtifactCopyFeedback.ts`
  - 抽出复制反馈状态，按产物 key 重置并清理超时计时器，避免状态串到其他产物。
- `src\components\artifacts\ArtifactSidePanel.tsx`
  - 侧栏复制按钮增加 `正在复制` / `已复制` / `复制未确认` 近场状态。
- `src\components\artifacts\ArtifactPreviewCard.tsx`
  - hover 预览卡复制按钮增加同样近场状态。
- `src\components\artifacts\ArtifactDetailSheet.tsx`
  - 完整详情页复制按钮增加同样近场状态。

## 3. 验证证据

自动化：

- `npm test`：通过，9 个测试全部通过。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过，Next.js 16.2.10 production build exit 0。
- `rg -n "schema|manifest|provider|node_id|storage|API|debug|local path" src`：无命中。
- `git diff --check`：通过。

浏览器：

- 使用 Codex bundled Playwright + 本机 Chrome，不写入项目依赖。
- 桌面 `1440x900`：
  - `clientWidth=1440`，`scrollWidth=1440`，无页面级横向溢出。
  - 对话区、prompt composer、右侧 artifact rail 可用。
  - 面板关闭时 hover artifact node 出现 `.artifact-preview-popover`。
  - 侧栏打开后 hover 其它 artifact node 不再出现 preview overlay。
  - 侧栏复制按钮出现近场复制反馈。
  - `作为输入` 后 composer 出现 `引用：`。
  - 点击固定 `确认` 后出现 `已确认「导入」`。
  - 点击发送和 Enter 发送后出现近场 `已发送`，输入清空。
  - Shift+Enter 保留换行。
  - assistant 回复复制按钮默认 `opacity=0`，hover 后 `opacity=1`。
  - 页面文本工程词扫描无命中。
- 窄屏 `390x844`：
  - `clientWidth=390`，`scrollWidth=390`，无页面级横向溢出。
  - `项目`、`产物`入口可见。
  - prompt composer 可见。
  - 页面文本工程词扫描无命中。

已知测试脚本债务：

- `npm run lint` 仍未通过，当前输出为 `Invalid project directory provided, no such directory: ...\frontend-api-backed-workbench\lint`。这是既有 Next 16 `next lint` 脚本债务，不由 Stage 4 引入。本阶段已用 `npx tsc --noEmit`、`npm run build`、工程词扫描和浏览器回归覆盖主线验收。

## 4. 自审结论

- 保留纯白、低噪声、三栏 Codex 风格工作台。
- 未新增营销页、hero、渐变、装饰性视觉或工程词 UI。
- 复制反馈修复只影响 artifact preview/detail surfaces，不改变数据合同。
- 独立审查提出的复制状态串联、超时误报和主线阻塞表述不一致问题已处理；复制超时态使用 `复制未确认`，不伪装为确定失败。
- `SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 仍判定为遗留复盘文件，不属于本前端主线，不提交。
- 本阶段浏览器回归覆盖桌面与窄屏，未发现 P0/P1 UI 阻塞。

## 5. 剩余风险

- `npm run lint` 脚本仍需后续单独修复为 Next 16 可用的 ESLint 流程。
- Backend Workflow Lite 的真实 approve/regenerate route 完成情况不由本前端主线声明；本分支只保证前端 API client 和 controller 边界。
- development adapter 用于本地回归，不代表真实 provider 生成能力。

## 6. 主线收尾判断

Frontend API-backed Workbench 主线在前端职责内已完成：

- 项目列表加载：已完成。
- 项目 snapshot 恢复：已完成。
- 发送消息后同步对话和节点：已完成前端 API client/controller 边界。
- 节点与产物映射：已完成 Backend Workflow Lite raw snapshot normalizer。
- 复制、作为输入、确认、重做、详情查看交互：已保留并通过 Stage 4 浏览器回归；重做真实后端版本合同未完成时不伪装生产闭环。
- 桌面和窄屏检查：已完成。

结论：可作为前端 API-backed 边界分支合并候选；合并到 `main` 前仍需用户明确确认，并接受 `npm run lint` 脚本债务或先单独修复 lint 流程。
