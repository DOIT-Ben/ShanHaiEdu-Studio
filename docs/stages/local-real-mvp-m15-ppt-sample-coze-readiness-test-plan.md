# Local Real MVP M15 PPT Sample And Coze Readiness Test Plan

日期：2026-07-07

## 1. 测试目标

M15 测试目标是验证指定 PPT 提示词和教材 PDF 已被稳定纳入项目 fixture，manifest 可证明文件来源与完整性，并确认 Coze PPT env readiness 只报告 present/missing。

## 2. 集中验收命令

### M15-1：fixture 资产测试

命令：

```powershell
node --test tests\fixture-assets.test.mjs
```

通过标准：

- `fixtures\ppt\template-a1-original-visual-strategy.md` 存在且非空。
- `fixtures\textbooks\sujiao-grade6-percentage.pdf` 存在且非空。
- PDF 文件头为 `%PDF`。
- `fixtures\ppt-sample-manifest.json` 存在。
- manifest 记录的 size 和 sha256 与实际文件一致。
- manifest 不包含 token、key、secret 或私有 env 值。

### M15-2：Coze env readiness

命令：

```powershell
powershell -NoProfile -Command "$names=@('COZE_API_TOKEN','COZE_PPT_BOT_ID','COZE_PPT_RUN_URL'); foreach($name in $names){ [pscustomobject]@{ Name=$name; Present= -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name)) } }"
```

通过标准：

- 只输出变量名和 present/missing。
- 不输出任何 token、账号、私有端点或 `.env` 内容。

### M15-3：回归测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M15-4：提交前审查

命令：

```powershell
git diff --check
git status --short
```

通过标准：

- 无空白错误。
- `.env` 和私有台账目录没有进入 git diff。
- 本轮改动只包含 M15 文档、fixture、manifest、测试和必要审计文档。

## 3. 失败处理

- 如果 fixture 缺失或 hash 不匹配，重新复制源文件并更新 manifest。
- 如果 PDF 头不是 `%PDF`，说明复制或源文件错误，不能进入 Coze smoke。
- 如果 Coze env 缺失，记录 readiness blocker，不调用真实 API。
- 如果 manifest 出现密钥形态字符串，必须删除敏感内容并重写 manifest。
