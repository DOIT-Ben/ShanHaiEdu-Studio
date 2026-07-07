# Local Real MVP M2 Lesson Text Loop Test Plan

日期：2026-07-07

## 1. 测试目标

M2 测试目标是验证需求规格之后的文本材料闭环：教材证据包和公开课教案能够由已确认上游生成，并支持查看、复制、确认、重做和上游变更后的重审提示。

## 2. 测试范围

纳入范围：

- 后端 approve route 的下一节点编排。
- deterministic runtime 的 `textbook_evidence` 和 `lesson_plan` 产物保存。
- 前端 API client regenerate 合同。
- Chromium desktop 浏览器闭环。
- 用户可见工程词红线扫描。

不纳入范围：

- 真实教材 OCR 或教材 PDF 解析。
- 真实 OpenAI provider。
- 真实 PPTX、图片、视频。
- 多浏览器和窄屏。

## 3. 集中验收命令

### M2-1：单元与合同测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- 新增 M2 后端 route/orchestration 测试通过。
- 新增 API client regenerate 测试通过。
- 失败数为 0。

### M2-2：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma Client 生成、Next.js 编译、TypeScript 和静态页面生成均通过。

### M2-3：浏览器真实闭环

命令：

```powershell
npm run test:e2e:stage2
```

通过标准：

- exit 0。
- 浏览器完成 M1 + M2 路径：需求规格确认、教材证据生成与确认、教案生成与确认、教案重做、刷新恢复。
- 可见文本工程词扫描为空。
- 通过路径截图保存到 Playwright output。

### M2-4：资源残留检查

命令：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'vitest|jest|playwright' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

通过标准：

- 不存在本轮遗留的 Vitest、Jest 或 Playwright worker。

### M2-5：提交前检查

命令：

```powershell
git diff --check
git status --short
```

通过标准：

- 无空白错误。
- 只包含 M2 授权范围内的文档、测试和必要实现。

## 4. 失败处理

- 若下游未生成，优先检查 approve route 是否拿到已确认 artifact 和项目上下文。
- 若重复生成，优先加幂等检查，避免重复确认导致多份同节点草稿。
- 若教案没有使用已确认教材说明，优先检查 approved inputs 查询。
- 若重做生成空白内容，优先修 API client regenerate payload。
- 若红线扫描失败，优先修 mapper 或用户可见文案，不放宽红线。
