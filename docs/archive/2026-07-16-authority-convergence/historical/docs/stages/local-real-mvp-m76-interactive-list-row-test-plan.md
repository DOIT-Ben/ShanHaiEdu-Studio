# Local Real MVP M76 交互列表行统一测试计划

更新时间：2026-07-11

## 1. 定向合同

`tests/m76-interactive-list-row.test.mjs` 覆盖：

1. 组件存在且公开约定的 props/原生 button 语义存在。
2. hover 只含背景、边框、文字和图标颜色；源码无 translate、scale、before 左线及 hover/selected shadow；focus-visible 与 44px 触控目标存在。
3. active/selected、attention、disabled 静态合同存在，disabled 不响应 hover。
4. 组件不依赖 reduced-motion 修补，因为列表行本身没有 transform。
5. 欢迎页、项目主行、Artifact drawer 接入；collapsed rail 仍不迁移。
6. 项目菜单/重命名的独立操作保留，菜单点击阻止冒泡；成员、管理员、反馈和 ProfileMenu 不被机械迁移。

## 2. 工程验证

依次要求 exit code 0：

```text
node --test tests/m76-interactive-list-row.test.mjs
npx tsc --noEmit
$env:VITEST_MAX_WORKERS='1'; npm test
npm run build
git diff --check
```

## 3. 浏览器验收（主代理）

桌面和窄屏检查欢迎页、项目侧栏、成果抽屉的 hover/focus/selected/按下、菜单独立点击、无横向溢出；本执行代理不声明浏览器通过。
