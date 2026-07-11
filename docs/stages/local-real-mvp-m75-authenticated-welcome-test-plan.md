# Local Real MVP M75 登录后欢迎首页测试计划

更新时间：2026-07-11

## 1. 自动化定向测试

1. 初始化：只调用 `listProjects("active")`，不读取 active 项目 localStorage，不调用 `getProjectSnapshot`，并以空 active/messages/artifacts/jobs 和 `ready` 收口。
2. 条件渲染：active project 为空时显示 `AuthenticatedWelcome`；对话、侧边阅读和 rail 只在 active project 存在时显示。
3. 主动进入：欢迎页点击项目调用 `onSelectProject`，新建按钮调用 `onCreateProject`；项目列表最多取 4 项。
4. 内容：显示“欢迎回来，{displayName}”“今天想准备哪一节课？”和经确认的真实能力说明；项目行包含标题、meta/currentStep 和更新时间。
5. 空态：没有 active 项目时不显示最近项目列表，只保留清晰的新建入口。
6. 生命周期：active/archived/trash 视图切换不读取本地记录、不自动选择项目。
7. 失败状态：create 失败不调用 snapshot 应用、不产生 active project；加载/error 不显示旧对话。
8. 动画：欢迎页仅一次性低幅度淡入，CSS 含 `prefers-reduced-motion: reduce` 且无 infinite。

## 2. 工程验证

依次执行并要求 exit code 0：

```text
node --test tests/m75-authenticated-welcome.test.mjs
npx tsc --noEmit
$env:VITEST_MAX_WORKERS='1'; npm test
npm run build
git diff --check
```

## 3. 浏览器验收（由主代理执行）

- 登录与刷新：先见欢迎首页，左侧不高亮旧项目，不出现旧消息或产物 rail。
- 桌面：欢迎页居中安静，右侧不留产物空白占位；选择/新建后恢复三栏工作台。
- 390px：项目抽屉、欢迎文案、新建和最近项目均可操作，无横向溢出。
- 项目生命周期：归档/回收站不自动进入项目，返回 active 后仍由教师主动选择。
- 新建失败：停留欢迎页并保留真实错误状态，不显示空对话。
- 本执行代理不声明浏览器通过；须以主代理真实浏览器证据为准。
