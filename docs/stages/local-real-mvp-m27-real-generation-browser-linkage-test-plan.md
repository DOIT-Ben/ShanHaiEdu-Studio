# Local Real MVP M27 Real Generation Browser Linkage Test Plan

日期：2026-07-07

## 1. 测试目标

M27 测试目标是用真实浏览器验证 M26 教师真实生成入口和下载联动：按钮可见、点击请求正确 route、刷新后出现新 artifact、下载按钮可用、最终材料包包含已生成图片和视频资产。

## 2. 集中验收命令

### M27-1：浏览器专项 E2E

命令：

```powershell
node scripts\run-stage27-e2e.mjs
```

通过标准：

- Chromium desktop 单 worker 通过。
- PPT 大纲详情显示“生成真实 PPTX”和“生成课堂视觉图”。
- 导入视频方案详情显示“生成导入视频”。
- 点击三个按钮后分别请求 `coze-ppt`、`image`、`video` route。
- snapshot 刷新后可看到“真实 PPTX 文件”“真实课堂视觉图”“真实导入视频”。
- 对真实 PPTX artifact 可下载 `.pptx`，文件头为 `PK`。
- 对真实课堂视觉图 artifact 可下载 `.png`，文件头为 PNG 魔数。
- 对真实导入视频 artifact 可下载 `.mp4`，文件包含 `ftyp`。
- 最终材料包 ZIP 包含 `classroom-visual.png` 和 `intro-video.mp4`。
- 页面可见文本不包含工程词。

### M27-2：全量回归测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M27-3：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Next.js 编译和 TypeScript 通过。
- 如仍有 Turbopack output tracing warning，确认是否仍指向既有本地视频读取风险，并记录到报告。

### M27-4：提交前审查

命令：

```powershell
git diff --check
git check-ignore -v .env .tmp .tmp\stage27-e2e
rg -n --hidden -g "!node_modules" -g "!src/generated" -g "!*.pdf" "sk-[A-Za-z0-9]|token\s*=|api[_-]?key\s*=|Bearer\s+[A-Za-z0-9]|https://[^\s)]+sig=|task[_-]?id\s*[:=]" docs\stages tests\e2e scripts
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -like '*local-real-mvp-mainline*' -and $_.CommandLine -match 'vitest|jest|playwright|next dev' }
```

通过标准：

- 无空白错误。
- `.env`、`.tmp` 和测试素材不进入 git。
- 文档、测试和脚本不包含真实 key、token、私有端点、远程签名 URL 或任务标识。
- 当前 worktree 无残留测试/dev 进程。

## 3. 失败处理

- 如果按钮不可见，先确认产物详情是否打开到正确节点，不直接放宽 selector。
- 如果拦截 route 没命中，说明前端没有请求正确后端 route，应修前端 data source 或 action mapping。
- 如果下载 route 失败，优先检查测试 artifact 的 `storage` metadata 和 `.tmp` fixture，不绕过真实下载 route。
- 如果材料包缺图片或视频，优先检查 package route 的资产选择逻辑，不在 E2E 中伪造 ZIP。
