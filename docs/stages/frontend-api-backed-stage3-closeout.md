# Frontend API-backed Workbench Stage 3 Closeout

日期：2026-07-07

## 1. 阶段结论

Stage 3 已完成，可提交并推送本阶段变更。

本阶段完成的是产物动作的真实标识边界：前端确认动作优先使用后端 `artifactId`，动作完成后重新读取项目 snapshot，以后端真源刷新 UI。后端真实 approve route 尚不由本主线实现；当前只完成前端 API client、mapper 和 controller 边界，不把 development adapter 当作真实后端能力。

## 2. 完成内容

- `src\lib\workbench-mappers.ts`
  - 从 `workbench-api.ts` 拆出 Backend Workflow Lite raw types。
  - 拆出项目列表和 snapshot normalizer。
  - 保留 node placeholder 映射，未生成产物不暴露复制、作为输入、确认和重做。
  - 过滤后端内部 structured label，避免动态字段进入用户可见 UI。
- `src\lib\workbench-actions.ts`
  - 新增产物动作 key resolver，按 action 权限硬门禁。
  - 真实后端产物优先使用 `artifactId`，开发态可继续使用本地 key。
- `src\lib\workbench-api.ts`
  - 降低文件职责，只保留 API client、development adapter 和错误处理。
  - `approveArtifact` 改为先调用 artifact approve endpoint，再重新读取 project snapshot。
  - `regenerateArtifact` 在 API data source 下保持明确后端合同边界，不调用未完成的真实版本 endpoint。
  - 保持 development adapter 的本地动作边界，名称和测试明确它不是 production state。
- `src\hooks\useWorkbenchController.ts`
  - 确认和重做动作先经过 action resolver，避免固定入口绕过 `actions.canConfirm`。
  - 保持现有通知文案和 Codex 风格交互。
- `tests\workbench-api.test.mjs`
  - 支持测试加载拆分后的 mapper。
  - 增加 approve 使用 artifact id 并刷新 snapshot 的测试。
  - 增加 placeholder 动作门禁和动态字段过滤测试。
  - 更新共享合同路径测试，覆盖 approve 后二次读取 snapshot。

## 3. 验证证据

自动化：

- `npm test`：通过，9 个测试全部通过。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过，Next.js 16.2.10 production build exit 0。
- `git diff --check`：通过。
- `rg -n "schema|manifest|provider|node_id|storage|API|debug|local path" src`：无命中。
- 行数检查：`workbench-api.ts` 239 行，`workbench-mappers.ts` 220 行，`useWorkbenchController.ts` 251 行，`workbench-actions.ts` 9 行。

浏览器：

- 桌面本地回归 `127.0.0.1:3029`：
  - 项目列表、对话区、右侧节点可见。
  - 点击 `确认` 后页面出现 `已确认「导入」`。
  - `clientWidth=1280`，`scrollWidth=1280`，无横向溢出。
- 窄屏 `390x844`：
  - `项目` 与 `产物`入口可见。
  - 工程词扫描无命中。
  - `clientWidth=390`，`scrollWidth=390`，无横向溢出。

已知测试脚本债务：

- `npm run lint` 仍未通过，当前输出为 `Invalid project directory provided, no such directory: ...\frontend-api-backed-workbench\lint`。这是既有 Next 16 `next lint` 脚本债务，不由 Stage 3 引入。

## 4. 自审结论

- 未重写 UI，未改变纯白极简和三栏 Codex 风格工作台结构。
- 没有把 OpenAI SDK 或 provider 调用放进 React 组件。
- 后端 raw 合同字段只在 mapper/API client 边界内使用；动态 structured label 已过滤内部字段，静态源码扫描和浏览器回归均无工程词暴露。
- `SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 已判定为遗留复盘文件，不属于本前端主线，本阶段不提交。
- 本阶段拆分降低了 `workbench-api.ts` 行数债务，后续动作接入可以继续在 mapper/client/controller 三层边界内推进。

## 5. 审查处理

独立审查智能体发现 2 个 Important 和 2 个 Minor：

- P1：固定确认入口可能绕过 `actions.canConfirm`，把 node placeholder key 当真实 artifact action。已修复：新增 `resolveArtifactActionKey`，controller 层硬门禁，并补 `artifact action resolver blocks placeholders and prefers real artifact ids` 回归测试。
- P2：`structuredContent` raw key 可能把内部字段带入可见 UI。已修复：mapper 过滤内部字段 label，并补 `API client does not expose backend-only structured labels in visible artifact fields` 回归测试。
- P3：缺 controller/UI 绕过路径测试。已用纯 action resolver 锁住 controller 调用前置门禁；Stage 4 再补 UI 交互级覆盖。
- P3：closeout 对工程词声明偏满。已改为基于静态源码扫描、动态字段过滤测试和浏览器回归的证据化表述。

## 6. 风险与后续处理

- Backend Workflow Lite 的真实 approve route 仍需由后端主线交付；本阶段只保证前端调用路径、id 选择和刷新策略正确。
- `regenerateArtifact` 的真实版本合同仍未完成，API data source 下明确返回边界错误；前端暂不宣称重做闭环已生产可用。
- 下一阶段需要补强复制、作为输入、详情查看和重做的集中浏览器回归，并决定是否修复 Next 16 lint 脚本债务。

## 7. 下一阶段入口

Stage 4 进入响应式与 polish 回归：

- 以现有 UI 为基线，不做视觉重写。
- 集中覆盖复制、作为输入、详情侧栏、确认、重做和项目切换。
- 处理或明确记录 `npm run lint` 脚本债务。
- 形成最终可合并结论前，补全桌面与窄屏浏览器证据。
