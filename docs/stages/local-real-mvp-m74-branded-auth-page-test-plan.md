# Local Real MVP M74 品牌化认证入口测试计划

更新时间：2026-07-11

## 1. 自动化定向测试

1. 品牌资产：组件使用 `next/image`，包含山海教育 Logo 与认证封面路径；封面为 `fill`、`object-cover`。
2. 品牌内容：包含“把一节课，准备得更从容。”、小学教师 AI 备课定位，以及教材证据、教案、PPT、课堂视频的具体连续工作说明。
3. 动态模式：登录标题为“欢迎回来”，注册标题为“创建你的教师账号”；副文案明确回到自己的备课项目。
4. 注册门禁：创建账号切换和显示名字段仅在 `registrationEnabled` 开启且处于注册模式时有效；有效模式用于标题、提交和密码自动填充。
5. 字段合同：字段源码顺序保持账号、显示名、密码；账号自动聚焦并使用 `username`，密码按模式使用 `current-password` / `new-password`。
6. 可访问性与状态：切换按钮包含 `aria-pressed`，提交按钮和输入控件具备至少 44px 高，保留错误、loading 与 disabled。
7. 响应式：桌面存在 `lg` 双栏和约 54/46 列宽；大封面仅桌面显示；移动图头在 `lg` 以下显示且高度处于 140-180px；容器防止横向溢出。
8. 可信文案：包含项目与材料仅对本人及受邀协作者可见的说明；不包含云端加密、学校认证或类似虚假背书。
9. 范围：认证服务/API 合同不变，无新增依赖。

## 2. 工程验证

依次执行并要求 exit code 0：

```text
node --test tests/m74-branded-auth-page.test.mjs
node --test tests/password-auth-client.test.mjs tests/password-auth-routes.test.mjs tests/password-auth.test.mjs tests/auth-security-hardening.test.mjs
npx tsc --noEmit
$env:VITEST_MAX_WORKERS='1'; npm test
npm run build
git diff --check
```

## 3. 浏览器验收（由主代理执行）

- 1366×768：认证页无需滚动；左侧约 54%、右侧约 46%，封面裁切和底部文案清晰，表单不是悬浮卡片。
- 高分屏：认证内容最大宽度合理，不因右栏增宽而松散。
- 390px 与 `lg` 以下：只显示横向品牌图头，不显示桌面大封面；表单首屏可用、无横向溢出、按钮触控舒适。
- 注册开/关：生产关闭注册时无创建账号入口；开启时切换、标题、字段、提交态和错误态可用。
- 本执行代理不声明浏览器通过；须以主代理真实浏览器证据为准。
