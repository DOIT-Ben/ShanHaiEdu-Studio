# V1-9G 最终包真实 Runtime 来源门测试计划

更新时间：2026-07-13

## 1. 测试矩阵

| 编号 | 场景 | 通过标准 |
|---|---|---|
| 9G-01 | 四类语义源真实 | 四者均为`model_generated/real/openai`时继续既有最终包校验 |
| 9G-02 | deterministic来源 | 任一源为`deterministic_draft`时阻断且不生成Artifact |
| 9G-03 | degraded来源 | `providerStatus`不是`real`时阻断 |
| 9G-04 | 非OpenAI来源 | `runtimeKind`不是`openai`时阻断 |
| 9G-05 | 缺来源证据 | 三字段任一缺失时fail-closed，不为旧工件放宽 |
| 9G-06 | 非语义真实资产 | PPTX、图片、视频继续走既有文件、digest与审查门，不误套语义来源字段 |
| 9G-07 | 回归 | 版本绑定、课程锚点、PPT审查、视频批准、ZIP反向验证不回归 |

## 2. 验证命令

```powershell
npx vitest run tests\package-tool-adapter.test.ts tests\versioned-final-package.test.ts
npm test
npm run build
git diff --check
```

本阶段只使用确定性夹具验证门禁，不生成真实媒体或最终交付包。
