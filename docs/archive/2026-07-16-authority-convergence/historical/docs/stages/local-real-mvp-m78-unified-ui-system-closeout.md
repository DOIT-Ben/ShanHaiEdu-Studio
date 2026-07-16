# Local Real MVP M78 统一基础交互系统收尾

更新时间：2026-07-12

## 结论

状态：`done`。基础组件抽离、迁移边界、常用页面和成员权限 Select 的真实 owner 写路径均已完成桌面与窄屏验收。

## 证据

- M75-M78 定向合同和全量 Node/Vitest 全部通过；最新计数为 Node 259/259、Vitest 482/482。Input、Textarea、MenuItem、Select、InteractiveListRow、Dialog、Sheet 及语义 tokens 均有覆盖。
- 1366×768 验证认证页、欢迎页、项目列表、三栏工作台、成果 rail/抽屉和反馈弹窗。
- 390px 验证工作台、顶部项目/产物入口、消息、输入区和反馈弹窗；提交反馈返回 201。
- `npm run build` 与 `git diff --check` 通过。
- 2026-07-12 真实 owner 在 1366×768 和 390×844 完成成员新增、权限键盘修改、服务端保存、刷新恢复和 Select 弹层检查。

浏览器证据路径：

- `.playwright-cli\page-2026-07-11T15-26-56-221Z.png`：1366×768 认证页与品牌入口。
- `.playwright-cli\page-2026-07-11T15-23-07-872Z.png`：390px 工作台。
- `.playwright-cli\page-2026-07-11T15-22-41-188Z.yml`：备课成果抽屉。
- `.playwright-cli\page-2026-07-11T15-24-05-858Z.yml`：反馈提交成功。
- `.playwright-cli\page-2026-07-11T15-26-16-941Z.png`：账号乙隔离后的欢迎空态。

## 未关闭门禁

- M77 owner 写路径浏览器验收已关闭。
- 开发环境存在 favicon 404 和封面 sizes 非阻塞提示。
- 不启动 M79，不继续视觉优化或组件抽离。

## 回退

`v1` 与 `fffdfb3` 保持不可变；若 closeout 记录需撤销，仅回退新的 docs 提交。
