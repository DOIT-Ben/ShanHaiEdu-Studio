# M70 前端工作台功能收口阶段 Closeout

日期：2026-07-11

状态：done

## 1. 完成范围

本阶段完成 M54-A 前端工作台第一档收口，不重做 UI，不改变后端工作流：

- 首次欢迎态：无消息时展示 ShanHaiEdu 标识、自然欢迎语和 4 个高频备课任务。
- 欢迎建议：点击后只填入输入框，等待教师修改和发送，不自动发送。
- 附件拖放：输入区支持拖入文件，并显示拖放覆盖态。
- 截图粘贴：剪贴板图片进入附件状态，提示教师补充可见文字或画面要点，不伪装 OCR、图片文字识别或模型可见视觉输入。
- 文件状态：文本/Markdown/CSV/JSON 可读取为本轮资料；PDF/DOCX 显示“请摘取关键内容或另存为文本后使用”。
- 工具菜单：新增“工具和资料”入口，区分已可用能力和未接通能力。
- 工具菜单动作：已标为可用的菜单项均有动作；当前仅“添加文本资料”是可点击动作，截图粘贴和继续排队作为说明性提示，不伪装为已接通命令。
- 发送安全：pending 文件读取期间阻止发送；发送中阻止拖放/粘贴新附件；消息 POST 带客户端幂等键，降低 snapshot 失败后的重复发送风险。
- 假入口清理：M70 新增界面不出现“更多操作暂未开放”等可点击假入口，也不暴露工程词。
- 响应式：桌面和 390px 窄屏下欢迎态、工具菜单、附件卡和输入区可用。

## 2. 关键文件

- `src\components\conversation\ConversationWorkbench.tsx`
- `src\components\conversation\PromptComposer.tsx`
- `src\components\conversation\composer\composer-contracts.ts`
- `src\hooks\useWorkbenchController.ts`
- `src\lib\workbench-api.ts`
- `tests\m54a-frontend-workbench-contract.test.ts`
- `tests\m51-interaction-polish-and-button-audit.test.mjs`
- `tests\m47-composer-api-wiring.test.mjs`
- `tests\workbench-api.test.mjs`

## 3. 测试与验证

### 3.1 TDD 红灯

先新增 M70 合同和源码审计测试，并确认失败点来自缺失能力：

```text
npx vitest run tests/m54a-frontend-workbench-contract.test.ts --maxWorkers=1
node --test tests/m51-interaction-polish-and-button-audit.test.mjs
```

红灯结果：

- 图片附件仍被识别为 unsupported。
- `buildWelcomePromptSuggestions` 不存在。
- `getComposerToolMenuItems` 不存在。
- `ConversationWorkbench` 未挂载 `WelcomeEmptyState`。

### 3.2 定向回归

```text
npx vitest run tests/m54a-frontend-workbench-contract.test.ts --maxWorkers=1
node --test tests/m51-interaction-polish-and-button-audit.test.mjs
```

结果：

- Vitest：9/9 passed
- Node test：27/27 passed（覆盖 M51 源码审计与 workbench API 幂等键行为）

### 3.3 全量测试

```text
npm test
```

结果：

- Node test：213/213 passed
- Vitest：463/463 passed

### 3.4 生产构建

```text
npm run build
```

结果：exit 0。

### 3.5 浏览器验收

使用临时 local auth dev server 验收 M70 前端，不读取或回显账号密码。

检查项：

- 桌面 1366px：欢迎态可见，点击“公开课目标”只填入输入框，不触发发送。
- 工具菜单：展示“添加文本资料 / 粘贴截图参考 / 继续排队生成 / 自动读取 PDF/DOCX / 实时逐字输出”。
- 工具菜单动作：只有“添加文本资料”是可点击动作；“粘贴截图参考 / 继续排队生成 / 自动读取 PDF/DOCX / 实时逐字输出”均为说明性提示，不再出现 enabled 但无真实动作的菜单项。
- 文本拖放：`lesson-plan.md` 显示“已读取，可作为材料参考”。
- 图片粘贴：`blackboard.png` 显示“截图已记录，请在输入框补充可见文字或画面要点”，且不会被加入 `资料《blackboard.png》` 这类模型引用。
- PDF 拖放：`scan.pdf` 显示“请摘取关键内容或另存为文本后使用”。
- 390px 窄屏：输入区宽度 332px，工具按钮未越界，欢迎态和工具菜单可读。

截图证据：

- `output\playwright\m70-desktop.png`
- `output\playwright\m70-mobile-390.png`
- `output\playwright\m70-after-fix-desktop.png`
- `output\playwright\m70-after-fix-mobile-390.png`

最终 spot check：

- local-mode dev server `http://127.0.0.1:3012` 返回 200。
- 工具菜单文本包含添加文本资料、粘贴截图参考、继续排队生成、自动读取 PDF/DOCX 和实时逐字输出。
- 可点击工具项计数：`enabled-add-buttons=1`。
- 390px 窄屏输入框宽度：`composer-width=332`。

### 3.6 审查修复

Reviewer 复审前发现 5 个 P1，已在最终修复中关闭：

- 发送中拖放/粘贴附件导致 reference 失配：已阻止发送中添加附件，并取消过期读取请求。
- pending 附件清除后异步读取污染下一轮：已统一递增 request id 取消过期读取结果。
- POST 成功但 snapshot 失败后重试可能重复发送：已为工作台消息发送添加客户端幂等键；同一项目、正文、引用和确认动作的失败重试复用同一 key，发送成功后清除。
- `.png/.pdf/.docx` 携带 `text/plain` MIME 时被误当文本读取：已改为扩展名优先识别图片和富文档。
- enabled 工具项只有聚焦输入框的假动作：已只保留“添加文本资料”为 enabled 可点击动作。
- 发送中移除附件导致失败恢复卡片/reference 失配：发送中附件移除按钮禁用。

最终 reviewer 复审结论：未发现 P0/P1 阻塞。

剩余测试缺口：缺少 controller 级故障注入测试和真实组件交互测试；幂等 key 仅保存在内存中，页面刷新或组件卸载后的模糊失败重试不能复用。

### 3.7 代码与图谱

```text
git diff --check
graphify update .
```

结果：

- `git diff --check`：无空白错误，仅 LF/CRLF 提示。
- `graphify update .`：2792 nodes / 6791 edges / 209 communities。

## 4. 未完成与不纳入

- 真实 PDF/DOCX 解析、OCR、图片文字识别未实现，本阶段明确展示为未接通或需手动摘取。
- 真实 token streaming 未实现；当前仅展示生成、排队、保存等状态。
- 未执行真实外部 provider smoke；仍属于邀请真实用户前门禁。
- M67 生产实机门禁仍未关闭：共享卷重启、release 回滚、备份恢复。

## 5. 结论

M70 前端工作台第一档收口已完成并通过测试、构建、浏览器桌面/窄屏验收。真实用户开放仍不得只凭 M70 放行，必须先完成生产门禁和真实 provider smoke。
