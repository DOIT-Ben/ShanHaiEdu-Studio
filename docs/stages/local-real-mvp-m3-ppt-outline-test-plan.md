# Local Real MVP M3 PPT Outline Test Plan

日期：2026-07-07

## 1. 测试目标

M3 测试目标是验证已确认教案之后的 PPT 大纲与逐页脚本文本闭环。测试必须证明系统生成的是文本大纲，不是假 PPTX 文件。

## 2. 集中验收命令

### M3-1：单元与合同测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- 新增 M3 后端编排测试通过。
- 既有 workflow key 合同仍通过。
- 失败数为 0。

### M3-2：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma Client、Next.js 编译、TypeScript 和静态页面生成均通过。

### M3-3：浏览器真实闭环

命令：

```powershell
npm run test:e2e:stage2
```

通过标准：

- exit 0。
- 浏览器完成 M1 + M2 + M3 路径。
- PPT 大纲节点可见、可打开详情、可复制、可确认、可重做、可刷新恢复。
- 用户可见界面无工程词。
- 用户可见界面不出现“PPTX 已生成”。

### M3-4：资源残留检查

命令：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'vitest|jest|playwright' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

通过标准：

- 不存在本轮遗留的 Vitest、Jest 或 Playwright worker。

### M3-5：提交前检查

命令：

```powershell
git diff --check
git status --short
```

通过标准：

- 无空白错误。
- 只包含 M3 授权范围内的文档、测试和必要实现。

## 3. 失败处理

- 若后端未生成 PPT 大纲，优先检查 approve 后推进和 `ppt_outline -> ppt_draft` 映射。
- 若前端显示“PPT 草稿”，优先修教师可见标题映射。
- 若出现 PPTX 已完成表述，优先修 runtime 文案或 mapper，不放宽测试。
- 若重做生成空白内容，优先修 regenerate payload。
