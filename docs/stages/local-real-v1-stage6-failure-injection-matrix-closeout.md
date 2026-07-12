# ShanHaiEdu V1 Stage 6 故障注入矩阵

日期：2026-07-12

状态：`automation passed / live drills pending`

## 1. 结论

本机自动化故障恢复合同通过 6 个测试文件、90 个测试。它证明核心状态机在确定性故障下能拒绝脏提交和重复执行，但不替代真实断网、浏览器多标签页、进程强杀或目标服务器恢复演练。

## 2. 自动化矩阵

| 风险 | 自动化证据 | 当前结论 |
|---|---|---|
| 提交中进程退出 | staged 结果在提交失败后不可见，同一执行身份可精确恢复并只提升一次 | 通过 |
| 旧 worker 迟到回写 | 新 fence 接管后，旧结果进入 quarantine，不能成为当前 Artifact | 通过 |
| 重复提交与并发点击 | 同 key/同 hash 复用；不同 hash 冲突；两个独立客户端收敛到同一 job | 通过 |
| Provider 已接受但 taskId 未保存 | 转入 `submission_unknown`，禁止自动再次 start 或 poll | 通过 |
| Provider 失败或无效产物 | 映射为质量/可用性 observation，不创建可交付 Artifact，敏感错误不外泄 | 通过 |
| 连续失败与局部返修 | 两次相同失败后阻止第三次盲重试；page/shot locator 只返修目标单元 | 通过 |
| 反馈存储崩溃 | after-record/after-commit 崩溃可由租约协调器恢复，孤儿与失败可审计 | 通过 |

聚焦命令：

```text
npx vitest run tests/project-execution-lease.test.ts tests/generation-job-recovery.test.ts tests/generation-result-promotion.test.ts tests/provider-tool-adapter.test.ts tests/feedback-service.test.ts tests/react-observation-replan.test.ts --reporter=verbose
```

结果：`6 files passed / 90 tests passed / 0 failed`。

## 3. 尚需真实演练

| 实操 | 原因 | 完成标准 |
|---|---|---|
| Provider 请求中真实断网 | 自动化只验证状态机，不证明真实 SDK/HTTP 行为 | 不重复计费；有 taskId 只 poll；未知提交暂停人工对账 |
| 浏览器两个标签页同时提交 | 数据库并发已覆盖，仍需真实 UI 行为证据 | 只产生一个当前 job，两个页面状态最终一致 |
| worker 进程强杀与重启 | 事务失败已覆盖，仍需 OS 级进程恢复证据 | 重启后从 persisted task/job 恢复，不重复调用 Provider |
| 目标服务器共享卷重启 | 需要目标机操作窗口 | 数据库、Artifact 和下载链接重启后保持一致 |
| release 回滚与备份恢复 | 属于发布环境高风险操作 | 按 runbook 回滚/恢复并保存脱敏日志 |

## 4. 上线边界

在真实演练未完成前，6-02 只能标记为“自动化合同通过，实操待完成”；不得据此关闭 6-03 目标服务器门，也不得宣称 V1 已上线。
