# Frontend Merge Readiness Report

日期：2026-07-07 09:45

## 1. 只读核对结论

当前分支：

```text
feature/mvp-frontend-api-backed-workbench
```

远端对齐：

```text
720e677 [origin/feature/mvp-frontend-api-backed-workbench] fix: 完成工作台响应式与交互回归 | v0.4.9 | 2026-07-07 05:39
```

工作区状态：

```text
## feature/mvp-frontend-api-backed-workbench...origin/feature/mvp-frontend-api-backed-workbench
?? SHANHAIEDU_LEGACY_RETROSPECTIVE.md
```

结论：

- 本地分支与远端分支已对齐。
- 工作区仅剩未跟踪 `SHANHAIEDU_LEGACY_RETROSPECTIVE.md`。
- 该文件已在 Stage 3 和 Stage 4 判定为遗留复盘文件，不属于本前端分支，不应提交。
- 本阶段不合并 `main`，等待主 Codex 统一集成决策。

## 2. 当前分支完成范围

Frontend API-backed Workbench 主线已经完成前端职责内的 API-backed 边界：

- 项目列表加载已从 controller/data source 边界进入。
- 项目 snapshot 恢复已通过 API client / development adapter 合同承接。
- 消息发送后同步对话和节点。
- Backend Workflow Lite raw snapshot 已映射为前端 view model。
- 产物确认动作优先使用真实 `artifactId`，动作后重新读取 snapshot。
- 复制、作为输入、确认、重做、详情查看交互已保留。
- 桌面和窄屏回归已覆盖。

明确不声明完成：

- 后端生产真源。
- 真实 provider 调用。
- regenerate 真实版本合同。
- 生产错误格式最终态。
- `npm run lint` 可用性。

## 3. 合并前必须关注的风险

### 3.1 lint 脚本债务

现状：

```text
npm run lint
Invalid project directory provided, no such directory: ...\frontend-api-backed-workbench\lint
```

判断：

- 这是既有 Next 16 `next lint` 脚本债务。
- Stage 1-4 都已记录，不由最后一阶段引入。
- 合并前可以选择接受该已知风险，也可以单开小阶段把 lint 脚本改为明确 ESLint 流程。

建议：

- 若 `main` 的质量门禁要求 lint 必须通过，先修 lint 脚本再合并。
- 若当前合并只要求前端边界功能，可接受风险，但必须在合并说明里写清。

### 3.2 真实后端接入

现状：

- 前端 API client 已能处理 Backend Workflow Lite raw shape。
- API data source 已保留合同边界。
- development adapter 仍用于本地前端回归。

风险：

- 当前分支不证明真实后端 route、真实数据库持久化和真实 runtime 生成均已生产可用。
- 后端 approve/regenerate route 的最终合同仍需以后端主线为准。

建议：

- 合并前由主 Codex 对齐 backend-workflow-lite 当前 HEAD。
- 合并后下一前端主线第一阶段应做真实后端联调，不再以 development adapter 作为验收真源。

### 3.3 响应式

现状：

- Stage 4 桌面 `1440x900`：`clientWidth=1440`，`scrollWidth=1440`。
- Stage 4 窄屏 `390x844`：`clientWidth=390`，`scrollWidth=390`。
- 项目入口、产物入口、composer、hover preview、详情侧栏、复制反馈均已浏览器验证。

风险：

- 合并 `main` 后如果引入其他前端分支变化，仍可能产生布局回归。

建议：

- 合并后必须跑桌面和窄屏 smoke。
- 不在合并阶段做视觉重写；只修阻塞性溢出或入口不可达问题。

### 3.4 用户可见工程词

现状：

- Stage 1-4 源码扫描均记录 `rg -n "schema|manifest|provider|node_id|storage|API|debug|local path" src` 无命中。
- Stage 3 mapper 已过滤后端内部 structured label。
- Stage 4 浏览器页面文本工程词扫描无命中。

风险：

- 下一阶段接真实后端错误时，后端 raw error 可能把工程词带到用户界面。

建议：

- 错误恢复阶段必须继续在 API client/controller 边界归一化错误。
- 用户界面继续禁止出现工程词。

### 3.5 legacy 文件

现状：

- `SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 仍为未跟踪文件。
- 该文件不属于本前端分支。

建议：

- 本分支不提交该文件。
- 若主仓需要保留，应由主 Codex 另行决定归档位置和分支。

## 4. 已有验证证据索引

自动化证据：

- Stage 1：`npm test` 3 passed，`npx tsc --noEmit` 通过，`npm run build` 通过。
- Stage 2：`npm test` 5 passed，`npx tsc --noEmit` 通过，`npm run build` 通过，`git diff --check` 通过。
- Stage 3：`npm test` 9 passed，`npx tsc --noEmit` 通过，`npm run build` 通过，`git diff --check` 通过。
- Stage 4：`npm test` 9 passed，`npx tsc --noEmit` 通过，`npm run build` 通过，`git diff --check` 通过。

浏览器证据：

- Stage 1：桌面 `1280x720` 与窄屏 `390x844`。
- Stage 2：桌面本地回归与窄屏 `390x844`。
- Stage 3：桌面 `1280` 宽与窄屏 `390x844`。
- Stage 4：桌面 `1440x900` 与窄屏 `390x844`，覆盖复制、作为输入、确认、详情、发送、Enter、Shift+Enter 和 hover 复制入口。

## 5. 下一条前端主线规划

主线名称建议：

```text
Frontend Real Backend MVP Demo Readiness
```

主线目标：

让前端从“API-backed 边界完成”进入“真实后端联调与最终 MVP 演示路径可用”，仍保留 Codex 风格工作台，不做视觉重写。

### Stage 1：真实后端联调基线

目标：

- 对齐 backend-workflow-lite 当前合同。
- 使用真实 API data source 跑项目列表、项目 snapshot、发送消息、确认动作。

验收：

- 禁用 development adapter 后，真实后端可加载至少一个项目。
- 发送消息后 snapshot 重新读取。
- 失败时不补假 assistant 回复。

### Stage 2：错误恢复合同

目标：

- 归一化真实后端错误格式。
- 为项目加载、snapshot、发送、确认、重做分别提供用户可理解恢复态。

验收：

- 模拟 4xx、5xx、网络失败。
- 用户界面不出现工程词。
- 重试入口可达且不会重复提交危险动作。

### Stage 3：加载态与空态

目标：

- 梳理项目列表、snapshot、消息发送、动作刷新期间的加载态。
- 保持纯白低噪声，不新增营销式 UI。

验收：

- 慢接口下不会出现空白屏或误导性成功。
- project switch 与 action refresh 不互相覆盖状态。

### Stage 4：真实项目切换

目标：

- 验证多个真实项目之间切换不串消息、不串节点、不串产物状态。
- 明确 active project 的恢复策略。

验收：

- 项目 A 与项目 B 的 messages/nodes/artifacts 隔离。
- 刷新页面后恢复最近项目或明确默认项目。

### Stage 5：产物动作真实闭环

目标：

- 对齐后端 approve/regenerate 最终合同。
- 确认、重做、复制、作为输入、详情查看保持一致交互。

验收：

- 确认后刷新不丢状态。
- regenerate 未完成时仍显示明确边界，不伪装成功。
- regenerate 完成后能展示新版本或用户可理解状态。

### Stage 6：可访问性与键盘路径

目标：

- 补强按钮 aria、焦点顺序、抽屉/侧栏键盘路径、Enter/Shift+Enter。

验收：

- 关键路径不用鼠标也能完成：选项目、发送、打开产物、复制、作为输入。
- hover-only 入口必须有 focus 等价路径。

### Stage 7：最终 MVP 演示路径

目标：

- 固化一条真实教师演示路径：进入项目、发送备课需求、查看节点、确认产物、复制/作为输入、形成下一步。

验收：

- 使用真实后端运行，不以 development adapter 为最终证据。
- 桌面和窄屏各跑一次完整路径。
- 记录可复现命令、端口、环境变量和已知边界。

### Stage 8：合并前发布候选收口

目标：

- 汇总真实后端联调、错误恢复、加载态、项目切换、可访问性和 MVP 演示证据。
- 修复或明确接受 lint 脚本债务。

验收：

- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- 可用 lint 流程或明确豁免记录。
- 桌面和窄屏浏览器 smoke。
- 用户界面工程词扫描无命中。

## 6. 合并建议

当前分支可以作为前端 API-backed 边界合并候选，但不应把它描述成完整生产闭环。

合并 `main` 前建议主 Codex 做统一集成判断：

- 是否先修 `npm run lint`。
- 是否等待 backend-workflow-lite 合同同步。
- 是否需要在合并后立即启动下一条前端真实后端联调主线。
- 如何处理未跟踪 legacy 文件。

本阶段结论：

```text
等待主 Codex 统一集成决策。
```
