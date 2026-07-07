# Agent Runtime Stage 3 Test Plan

日期：2026-07-07

## 1. 测试目标

验证 runtime 输出不只是可用合同，还具备每个文本节点的教师可审结构和轻量自检清单。

## 2. 自动化测试

文件：`tests\agent-runtime\runtime-quality.test.ts`

断言：

- 所有 MVP 文本节点 deterministic markdown 都包含 `## 自检清单`。
- 教案包含教学重点、教学难点、学生活动、课堂总结。
- PPT 大纲包含建议页数、逐页脚本、主视觉需求。
- 导入视频包含课程锚点、课堂落点问题、分镜摘要、旁白建议。
- 最终交付清单明确未真实生成的 PPTX、图片文件、视频成片不能展示为完成。
- OpenAI request payload 包含任务级自检要求。

## 3. 集中验收命令

```powershell
$env:VITEST_MAX_WORKERS='2'; npm test -- --maxWorkers=2
npm run build
git diff --check
```

预期：

- 测试通过，失败数为 0。
- build exit 0。
- diff check exit 0。
