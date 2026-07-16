# ShanHaiEdu V1-5 四档生成强度测试计划

更新时间：2026-07-13

状态：`accepted before implementation`

## 1. 验收矩阵

| ID | 场景 | 通过标准 |
|---|---|---|
| T5-01 | 默认档 | 新项目为标准，Main Agent请求为Terra Medium |
| T5-02 | 四档映射 | 标准/增强/深度/极致映射准确 |
| T5-03 | 教师可见安全 | 页面、响应、错误不出现模型、effort或Provider名 |
| T5-04 | 项目持久化 | 刷新、重启后强度与版本恢复 |
| T5-05 | 任务快照 | 排队任务冻结提交时强度，后续改档不回写旧任务 |
| T5-06 | 普通改档 | 标准/增强/深度可受控写入当前项目 |
| T5-07 | 极致确认 | 未确认零写入，确认后一次写入，旧action不可重放 |
| T5-08 | 升级建议 | 可审计复杂度/失败信号触发下一档建议 |
| T5-09 | 无静默升级 | Main Agent文本不能直接改变服务端档位 |
| T5-10 | 建议去重 | 同IntentEpoch同问题只提示一次，拒绝后不循环 |
| T5-11 | 极致限制 | 极致不能首次自动建议，深度持续失败后才可建议 |
| T5-12 | 相对积分提示 | 无价格数据时只显示趋势，不虚构具体积分 |
| T5-13 | 双项目隔离 | 强度、版本、建议和确认互不串线 |
| T5-14 | UI交互 | 四停靠点、键盘、触摸、aria合同正确 |
| T5-15 | 响应式 | 1366×768与390px无溢出、遮挡和文本截断 |

## 2. 计划测试文件

- `tests\generation-intensity-policy.test.ts`
- `tests\generation-intensity-service.test.ts`
- `tests\model-main-conversation-agent.test.ts`
- `src\server\workbench\__tests__\stage60-conversation-turn-queue.test.ts`
- `tests\m54a-frontend-workbench-contract.test.ts`
- `tests\e2e\v1-generation-intensity.spec.ts`

## 3. 阶段验证

```text
npx vitest run tests/generation-intensity-policy.test.ts tests/generation-intensity-service.test.ts tests/model-main-conversation-agent.test.ts src/server/workbench/__tests__/stage60-conversation-turn-queue.test.ts tests/m54a-frontend-workbench-contract.test.ts --maxWorkers=1
npx tsc --noEmit --pretty false
npm test
npm run build
git diff --check
```

浏览器验收覆盖1366×768和390×844。SQLite使用独立`.tmp`数据库连续初始化2/2。不得调用真实媒体Provider。
