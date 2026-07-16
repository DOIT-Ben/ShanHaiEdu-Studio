# Local Real MVP M78 统一基础交互系统计划

更新时间：2026-07-11

## 目标与范围

- 统一对象选择列表、Select、普通 Input/Textarea、菜单项和浮层表面。
- 只修改前端 UI、文档和测试；保持认证、成员、反馈、项目、对话的枚举、回调、API 和数据不变。
- 不迁移隐藏 file input、PromptComposer 复合 textarea、tabs、chips、radio、消息、artifact rail。

## 实施

1. 收敛 `InteractiveListRow` 为纯颜色反馈，并让项目主行和操作区共享同一表面。
2. 加固 Radix Select 的 disabled、focus-visible、Popper 尺寸和滚动边界。
3. 新增轻量 `Input`、`MenuItem`，迁移明确列出的普通输入和菜单项；现有 Textarea 统一焦点合同。
4. 以 CSS 语义变量统一 Popover、Select、Tooltip、Dialog、Sheet 的边框、圆角、焦点和分层阴影，不新增万能 Overlay。
5. 清除全局按钮 active 位移；原生业务按钮继续显式提供 focus-visible。
6. 修正项目侧栏滚动区、底边融合和不可选 collapsed 项目的 disabled 语义。

## 风险与回退

- 风险：迁移输入或菜单时改变 Enter、blur、autoFocus 和回调；通过透传原生 props 和源码合同锁定。
- 风险：已有未提交改动较多；只定向编辑 M78 文件，不回滚来源不明改动。
- 回退：可按 primitive 与调用点独立恢复，不涉及数据库、API 或数据迁移。

## 成功标准

定向 node tests、TypeScript、单 worker 全量测试、生产构建和 `git diff --check` 均 exit 0；浏览器结果由主代理报告。
