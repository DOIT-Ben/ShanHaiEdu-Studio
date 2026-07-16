# Agent Runtime Stage 3 Closeout

日期：2026-07-07

## 1. 阶段目标

Stage 3 已完成：

- 新增 `task-guidance.ts`，集中维护每个文本节点的必备字段和自检清单。
- deterministic 输出为每个节点追加 `## 自检清单`。
- 教案、PPT 大纲、导入视频、最终交付清单补齐教师可审字段。
- OpenAI request builder 发送任务级 guidance，要求真实模型输出同样包含自检清单。
- 保持不生成 PPTX、图片文件和视频成片，不伪装文件能力完成。

## 2. 交付文件

- `docs\stages\agent-runtime-stage3-plan.md`
- `docs\stages\agent-runtime-stage3-test-plan.md`
- `src\server\agent-runtime\task-guidance.ts`
- `src\server\agent-runtime\deterministic-runtime.ts`
- `src\server\agent-runtime\openai-runtime.ts`
- `src\server\agent-runtime\index.ts`
- `tests\agent-runtime\runtime-quality.test.ts`

## 3. 验收证据

已执行：

```powershell
$env:VITEST_MAX_WORKERS='2'; npm test -- --maxWorkers=2 tests/agent-runtime/runtime-quality.test.ts
```

结果：

- Test Files: 1 passed
- Tests: 11 passed

已执行：

```powershell
$env:VITEST_MAX_WORKERS='2'; npm test -- --maxWorkers=2
```

结果：

- Test Files: 4 passed
- Tests: 23 passed

已执行：

```powershell
npm run build
```

结果：

- Next.js production build compiled successfully
- TypeScript finished successfully
- Static pages generated successfully

已执行：

```powershell
git diff --check
```

结果：

- exit 0
- 仅提示后续 Git 触碰时 LF 会转 CRLF，不影响验收。

已执行前端 OpenAI 直连扫描：

```powershell
rg -n -i "openai|dangerouslyAllowBrowser" src\components src\app
```

结果：

- exit 1，无匹配。

## 4. 风险与后续

- Stage 3 仍未执行真实模型 smoke；这属于需要显式环境配置的验收。
- 节点质量规则目前是 V1 最小清单，后续可由真实教师样本继续调整。
