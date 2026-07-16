# Local Real MVP M4 Intro Video Test Plan

日期：2026-07-07

## 1. 测试目标

M4 测试目标是验证导入视频方案文本闭环。测试必须证明系统生成的是可复用策划卡，不是假视频文件、假分镜成片或 provider 结果。

## 2. 集中验收命令

### M4-1：单元与合同测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- 新增 M4 后端编排测试通过。
- 导入视频方案包含独立主题、开场钩子、吸睛点、课程锚点、课堂落点问题。
- 既有 M0-M3 合同仍通过。
- 失败数为 0。

### M4-2：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma Client、Next.js 编译、TypeScript 和静态页面生成均通过。

### M4-3：浏览器真实闭环

命令：

```powershell
npm run test:e2e:stage2
```

通过标准：

- exit 0。
- 浏览器完成 M1 + M2 + M3 + M4 路径。
- 导入视频方案节点可见、可打开详情、可复制、可确认、可重做、可刷新恢复。
- 用户可见界面无工程词。
- 用户可见界面不出现“视频文件已生成”或“视频成片已生成”。

### M4-4：资源残留检查

命令：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'vitest|jest|playwright' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

通过标准：

- 不存在本轮遗留的 Vitest、Jest 或 Playwright worker。

### M4-5：提交前检查

命令：

```powershell
git diff --check
git status --short
```

通过标准：

- 无空白错误。
- 只包含 M4 授权范围内的文档、测试和必要实现。

## 3. 失败处理

- 若后端未生成导入视频方案，优先检查 `ppt_draft` approve 后推进。
- 若方案缺少“开场钩子”或“吸睛点”，优先修 deterministic 模板，不放宽测试。
- 若文案提前讲授知识点结论，优先修模板边界。
- 若出现视频已生成表述，优先修 runtime 文案或前端可见文案，不放宽测试。
- 若重做生成空白内容，优先修 regenerate payload。
