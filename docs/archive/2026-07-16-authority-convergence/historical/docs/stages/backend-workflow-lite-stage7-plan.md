# Backend Workflow Lite Stage 7 Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

Stage 1-6 已经完成后端状态真源的主要行为，但前端、Runtime 和 E2E 主线不能靠阅读测试文件猜 API。Stage 7 的核心需求是把现有可用能力收束成稳定合同，并用 contract regression 测试证明主线能力完整。

本阶段必须回答：

- 前端应该调用哪些 endpoint。
- Runtime 写入 run/artifact 时应遵守哪些状态和冲突规则。
- snapshot 返回哪些真源字段。
- 哪些能力已经完成，哪些仍属于后续主线。
- 本主线能否作为 backend contract skeleton 合并候选。

## 2. 可复用方案调研

继续复用：

- 现有 Next.js Route Handlers 作为 API 合同真源。
- `src/server/workbench/types.ts` 作为 TypeScript shape 真源。
- Stage 1-6 service/route tests 作为行为证据。

参考：

- <https://nextjs.org/docs/app/api-reference/file-conventions/route>
- <https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409>

## 3. 复用、适配与必要自研

复用：

- 不新增业务模型。
- 不新增前端视觉。
- 不接 OpenAI 或真实 provider。

适配：

- 新增 `docs/contracts/backend-workflow-lite-api.md`，将 routes、request、response、错误状态和接入注意事项集中给前端/Runtime/E2E。
- 新增 Stage 7 contract regression test，覆盖主线关键 route envelope。
- 新增 Stage 7 closeout，给出可合并判断和剩余风险。

自研：

- 只自研合同文档和 contract regression，不扩大业务边界。

## 4. Stage 7 开发方案

### 文档

- `docs/contracts/backend-workflow-lite-api.md`
  - 数据字典。
  - Endpoint 清单。
  - Request / response 示例。
  - 错误码合同。
  - Runtime 接入顺序。
  - 前端接入边界。

### 测试

- `src/server/workbench/__tests__/stage7-mainline-contract.test.ts`
  - 创建项目。
  - 发送消息。
  - 保存 artifact。
  - approve。
  - approved-inputs。
  - regenerate with expected version。
  - stale regenerate 409。
  - start/finish run。
  - duplicate finish 409。
  - snapshot 恢复。

## 5. 风险与回退

| 风险 | 控制方式 | 回退方式 |
| --- | --- | --- |
| 合同文档与代码漂移 | Stage 7 contract regression 覆盖关键 envelope | 后续 API 变更必须同步文档和测试 |
| 误把未接入 provider 写成完成 | 文档明确本主线不接 OpenAI，不生成真实内容 | closeout 标注 |
| 前端误用工程字段直显 | 文档标注字段为 API/internal contract，用户态需映射 | 前端主线处理 |

## 6. Stage 7 验证标准

- `npm run test:stage7` 通过。
- `npm run test:stage1` 到 `npm run test:stage6` 回归通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- API contract 文档覆盖当前全部 workbench route。
- 自审完成，风险记录清楚。
- 提交并 push 到 `origin/feature/mvp-backend-workflow-lite`。
