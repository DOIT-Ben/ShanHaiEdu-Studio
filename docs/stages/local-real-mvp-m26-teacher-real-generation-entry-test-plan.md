# Local Real MVP M26 Teacher Real Generation Entry Test Plan

日期：2026-07-07

## 1. 测试目标

M26 测试目标是验证教师界面具备受控真实生成入口：前端 data source 能调用既有后端 route 并刷新项目 snapshot；UI action helper 能为正确产物提供教师可理解按钮，并避免工程词进入教师可见文案。

## 2. 集中验收命令

### M26-1：API client 与 action helper 目标测试

命令：

```powershell
node --test tests\workbench-api.test.mjs
```

通过标准：

- `generateRealAsset(projectId, artifactId, "pptx")` 调用 `/coze-ppt` 并刷新 `/snapshot`。
- `generateRealAsset(projectId, artifactId, "image")` 调用 `/image` 并刷新 `/snapshot`。
- `generateRealAsset(projectId, artifactId, "video")` 调用 `/video` 并刷新 `/snapshot`。
- PPT 大纲产物返回“生成真实 PPTX”和“生成课堂视觉图”两个 action。
- 导入视频方案返回“生成导入视频” action。
- 非对应产物不返回真实生成 action。
- action label 和 success 文案不包含工程词。

### M26-2：全量回归测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M26-3：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Next.js 编译和 TypeScript 通过。
- 如仍有 Turbopack output tracing warning，确认是否仍指向既有本地视频读取风险，并记录到报告。

### M26-4：前端文案与安全审查

命令：

```powershell
rg -n "schema|manifest|provider|node_id|storage|API|debug|local path" src\components src\hooks src\lib
rg -n --hidden -g "!node_modules" -g "!src/generated" "sk-[A-Za-z0-9]|token\s*=|api[_-]?key\s*=|Bearer\s+[A-Za-z0-9]|https://[^\s)]+sig=|task[_-]?id\s*[:=]" docs\stages src\components src\hooks src\lib tests\workbench-api.test.mjs
git diff --check
git check-ignore -v .env .tmp
```

通过标准：

- 新增教师可见文案不包含工程词。
- 新增前端代码不包含真实 key、token、私有端点、远程签名 URL 或任务标识。
- `.env`、`.tmp` 仍被 ignore。
- 无空白错误。

## 3. 失败处理

- 如果 API client 测试通过但 UI action helper 文案含工程词，先改 helper 文案，不在组件里补丁过滤。
- 如果真实 route 失败，不在前端吞掉细节后宣称真实生成成功；只能显示失败并保留原产物。
- 如果 build warning 仍出现，只记录既有生产存储风险，不为消 warning 改动后端文件读取能力。
