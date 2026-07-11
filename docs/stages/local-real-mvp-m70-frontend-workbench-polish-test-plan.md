# M70 前端工作台功能收口测试计划

日期：2026-07-11

状态：done

## 1. 测试目标

验证 M70 前端收口不引入假能力、不破坏现有对话工作台，并覆盖欢迎态、附件拖放/粘贴、工具菜单和响应式体验。

## 2. 单元与合同测试

- 扩展 `tests/m54a-frontend-workbench-contract.test.ts`：
  - 欢迎态建议数量、文案和“只填入不发送”的合同。
  - 图片附件、PDF/DOCX、文本附件状态标签不包含工程词。
  - 工具菜单能力列表区分可用/未接通能力。
- 扩展 `tests/m51-interaction-polish-and-button-audit.test.mjs`：
  - 无消息区使用真实欢迎态，不再只有单句提示卡。
  - `PromptComposer` 包含 drop/paste 入口和工具菜单。
  - 不存在“更多操作暂未开放”等可点击假入口。

## 3. 定向运行

```text
npx vitest run tests/m54a-frontend-workbench-contract.test.ts --maxWorkers=1
node --test tests/m51-interaction-polish-and-button-audit.test.mjs
```

## 4. 全量验证

```text
npm test
npm run build
git diff --check
graphify update .
```

## 5. 浏览器验收

使用 production build 或 dev server 打开工作台，检查：

- 桌面：欢迎态、工具菜单、文本附件、图片粘贴/拖入状态、反馈/协作/产物入口正常；图片不能进入本轮模型引用。
- 390px 窄屏：欢迎态不遮挡输入框；工具菜单和附件卡可读；右侧交付链仍可通过抽屉访问。
- Console 不出现 M70 新增功能导致的错误；favicon 404 这类既有非阻塞静态资源问题不作为 M70 阻塞。

## 6. 不通过条件

- 图片、PDF、DOCX 被显示为“已解析”但没有真实解析；或图片被显示为模型可见引用但没有真实上传/多模态载荷。
- 点击欢迎态建议直接发送消息或携带隐藏确认 actionId。
- 用户可见界面出现工程词：schema、manifest、provider、node_id、storage、API、debug、local path。
- 移动端输入框、菜单、附件卡或欢迎态发生遮挡。
