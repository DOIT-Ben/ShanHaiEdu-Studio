# Frontend API-backed Workbench Stage 4 Test Plan

日期：2026-07-07

## 1. 测试目标

集中验证 Stage 4 响应式与关键交互，不把源码检查当作 UI 验收。

## 2. 浏览器回归清单

### T1：桌面默认工作台

视口：`1440x900`

期望：

- 项目列表、对话区、产物 rail 可见。
- 右侧 rail 不抢占对话主视觉。
- `scrollWidth <= clientWidth + 1`。
- 页面文本不含工程词。

### T2：产物 hover 与详情层级

步骤：

1. hover 第一个产物节点。
2. 检查 `.artifact-preview-popover` 出现。
3. 点击该产物节点打开详情侧栏。
4. hover 另一个产物节点。

期望：

- 面板关闭时 hover 预览出现。
- 详情侧栏打开后 hover 预览不出现。
- 侧栏中复制、作为输入、详情查看入口可达。

### T3：详情、复制、作为输入、确认

步骤：

1. 打开可复用产物。
2. 点击复制。
3. 点击作为输入。
4. 点击确认。

期望：

- 复制有用户可见反馈。
- 作为输入后 prompt composer 显示引用或插入内容。
- 确认后出现 `已确认「导入」` 或同等用户可理解反馈。

### T4：发送、Enter、Shift+Enter

步骤：

1. 输入 `请继续生成 PPT 草稿`，点击发送。
2. 输入 `请继续优化导入视频`，按 Enter。
3. 输入 `第一行`，按 Shift+Enter，再输入 `第二行`。

期望：

- 点击发送后输入框清空或出现近场反馈。
- Enter 发送后输入框清空或出现近场反馈。
- Shift+Enter 在输入框中保留换行，不触发送出。

### T5：assistant 回复复制按钮

步骤：

1. 定位 `aria-label="复制回复"`。
2. 检查默认父容器透明。
3. hover assistant message。

期望：

- 默认不抢注意力。
- hover 后复制按钮可见。

### T6：窄屏入口与溢出

视口：`390x844`

期望：

- `项目`、`产物`入口可见。
- composer 可见。
- `scrollWidth <= clientWidth + 1`。
- 页面文本不含工程词。

## 3. 自动化命令

```powershell
npm test
npx tsc --noEmit
npm run build
npm run lint
rg -n "schema|manifest|provider|node_id|storage|API|debug|local path" src
git diff --check
```

`npm run lint` 若仍为 `next lint` 在 Next 16 下解析目录 `lint` 的失败，应记录为既有脚本债务；不得伪装通过。

## 4. 浏览器命令策略

优先使用 Codex bundled Playwright 与本机 Chrome：

```powershell
$node='C:\Users\HB\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$env:NODE_PATH='C:\Users\HB\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\HB\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
```

浏览器测试脚本不写入项目依赖，不污染 `package.json`。

## 5. 验收结论规则

- 任一 P0/P1 交互不可达：本阶段不通过，必须修复复测。
- 视觉 P2/P3 若不影响主线目标，可记录为后续 polish 风险。
- 若后端真实 route 未就绪，只能说明前端边界通过，不声明生产后端动作闭环完成。
