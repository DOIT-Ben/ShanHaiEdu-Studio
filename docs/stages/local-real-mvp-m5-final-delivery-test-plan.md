# Local Real MVP M5 Final Delivery Test Plan

日期：2026-07-07

## 1. 测试目标

M5 测试目标是验证最终交付包 Markdown 闭环。测试必须证明系统只汇总已确认文本产物，并明确未真实生成的 PPTX、图片和视频文件能力，不能包装成已完成文件。

## 2. 集中验收命令

### M5-1：单元与合同测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- 新增 M5 后端编排测试通过。
- 最终交付清单保存到 `final_delivery` 节点。
- 最终交付清单包含需求规格、公开课教案、PPT 大纲与逐页脚本、导入视频方案。
- 最终交付清单明确标记未生成的 PPTX、图片文件和视频成片为待生成。
- 既有 M0-M4 合同仍通过。
- 失败数为 0。

### M5-2：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma Client、Next.js 编译、TypeScript 和静态页面生成均通过。

### M5-3：浏览器真实闭环

命令：

```powershell
npm run test:e2e:stage2
```

通过标准：

- exit 0。
- 浏览器完成 M1 + M2 + M3 + M4 + M5 路径。
- 最终交付清单节点可见、可打开详情、可复制、可确认、可重做、可刷新恢复。
- 用户可见界面无工程词。
- 用户可见界面不出现“PPTX 文件已生成”“图片文件已生成”“视频成片已生成”。

### M5-4：资源残留检查

命令：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'vitest|jest|playwright' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

通过标准：

- 不存在本轮遗留的 Vitest、Jest 或 Playwright worker。

### M5-5：提交前检查

命令：

```powershell
git diff --check
git status --short
```

通过标准：

- 无空白错误。
- 只包含 M5 授权范围内的文档、测试和必要实现。

## 3. 失败处理

- 若后端未生成最终交付清单，优先检查 `intro_video_plan` approve 后推进。
- 若保存到 `final_delivery_checklist` 而不是 `final_delivery`，优先修 runtime/workflow key 映射。
- 若最终交付缺少上游已确认产物，优先检查 `final_delivery` 上游配置。
- 若出现已生成 PPTX、图片文件或视频成片表述，优先修 runtime 文案，不放宽测试。
- 若重做生成空白内容，优先修 regenerate payload。
