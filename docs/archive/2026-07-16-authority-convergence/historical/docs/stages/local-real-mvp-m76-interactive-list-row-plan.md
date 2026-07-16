# Local Real MVP M76 交互列表行统一计划

更新时间：2026-07-11

## 1. 目标

把教师端“进入详情/选择对象”的主列表行统一为可复用的安静交互表面，复现已确认的欢迎页最近项目行张力，同时不改变业务回调和非列表交互。

## 2. 范围与盘点结论

- 新增 `src/components/ui/interactive-list-row.tsx`，使用原生 button 语义，支持 active/selected、attention、leading、title/subtitle/meta/trailing、showArrow、disabled、className、onClick、aria-label，并提供 compact/contained 以适配侧栏。
- 迁移 `AuthenticatedWelcome` 最近项目、`ProjectListItem` 非 collapsed 主选择行、`ArtifactNodeCard` drawer 行。
- 不迁移项目生命周期菜单和重命名按钮、collapsed 项目图标、Artifact rail、成员/管理员用户静态管理行、反馈分类/chip、ProfileMenu 菜单；这些分别是破坏性确认、窄 rail 图标、状态筛选、静态信息+独立操作或纯菜单项。

## 3. 实施设计

1. M78 最终口径覆盖早期张力方案：组件最小 44px，hover 只改变背景、边框、文字和图标颜色；不位移、不缩放、无左引导线、无 hover/selected 阴影；active/selected 与 attention 使用静态可读颜色。
2. `compact`/`contained` 只收窄布局，不引入 transform 或额外装饰；focus-visible 由组件自身负责。
3. 项目主行保留生命周期文案和 active 状态；菜单按钮位于外层并阻止选择事件传播。collapsed 继续使用原图标按钮。
4. Artifact drawer 保留图标、摘要和状态，把 `active` 映射为 selected；桌面 rail 不改。

## 4. 风险与回退

- 风险：侧栏宽度不足导致内容溢出；通过 min-width、truncate 和外层 overflow 约束控制，不使用 transform。
- 风险：嵌套菜单点击触发选择；保留菜单独立 DOM 并显式 stopPropagation。
- 回退：只回退 M76 新组件、三处接入、CSS、合同测试和本阶段文档，不触及业务 API 或数据。

## 5. 成功标准

定向测试、`npx tsc --noEmit`、`VITEST_MAX_WORKERS=1 npm test`、`npm run build`、`git diff --check` 均 exit 0；浏览器桌面/窄屏由主代理另行检查。
