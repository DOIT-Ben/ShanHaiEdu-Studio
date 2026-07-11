# Local Real MVP M78 统一基础交互系统测试计划

更新时间：2026-07-11

## 自动化合同

`tests/m78-ui-system.test.mjs` 覆盖：列表无 transform/scale/before 左线/hover shadow；项目表面无重复 shadow/竖分隔；全局按钮无 active transform；Select 的 Popper、disabled、滚动和窄屏合同；源码无原生 select；Input 与 MenuItem 指定迁移及特殊输入保留；Dialog/Sheet 关闭标签；语义 CSS tokens。

同步更新 M75/M76/M77 测试，停止锁定已废弃的列表位移、左线和阴影行为。

## 工程验证

```text
node --test tests/m75-authenticated-welcome.test.mjs tests/m76-interactive-list-row.test.mjs tests/m77-select-polish.test.mjs tests/m78-ui-system.test.mjs
npx tsc --noEmit
$env:VITEST_MAX_WORKERS='1'; npm test
npm run build
git diff --check
```

浏览器桌面和窄屏由主代理执行，本阶段不代替浏览器声明通过。
