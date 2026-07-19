# ShanHaiEdu 历史归档

本目录保存历史原文、旧阶段证据、规则备份和迁移记录。Archive默认不参与搜索、规划、开发或验收判断；仓库 `.rgignore` 已排除本目录。

使用规则：

- 只有追溯历史原因、验证旧证据或用户明确要求时定向读取。
- 不从archive恢复旧需求、固定Tool顺序、逐节点确认、fallback成功、旧run或旧Skill/Provider lock。
- 历史原文不批量改写；迁移必须以逐文件SHA-256证明字节不变。
- 使用 `rg --no-ignore <pattern> docs\archive\<明确子目录>` 进行定向审计，不对整个archive做日常宽泛搜索。

2026-07-16权威收敛入口：`2026-07-16-authority-convergence\README.md`。

2026-07-16 V1.0智能体重构权威切换入口：`2026-07-16-v1-agent-refactor-authority-switch\README.md`。该目录保存切换前活动权威、Streaming阶段和旧V1-9计划原文；只作审计证据，不得恢复为活动入口。

2026-07-17整改基线入口：`2026-07-17-remediation-baseline\README.md`。该目录保存整改前规则快照和已失效的阶段closeout；其中的“已关闭”结论不再控制当前开发。

2026-07-17原子Tool整改完成入口：`2026-07-17-agent-atomic-tool-remediation\README.md`。该目录保存五阶段完成计划、测试门和SHA-256 manifest；只作完成证据，不自动启动V1-9。

2026-07-17项目开发门禁制度化完成入口：`2026-07-17-project-development-gates\README.md`。该目录保存退出活动权威时的阶段合同、计划、测试计划、CI关闭证据和逐文件SHA-256迁移清单。

2026-07-19 Provider连续性暂停入口：`2026-07-19-provider-continuity-paused\README.md`。该目录按原字节保存退出活动权威的plan、test-plan和V1-9就绪矩阵；真实Provider工作必须从Roadmap重新规划。

2026-07-19离线重构例外前规则备份：`2026-07-19-project-rule-before-offline-refactor\README.md`。该目录保存项目准则修改前原始字节。

2026-07-20过期assistant-ui控制边界ADR归档：`2026-07-20-superseded-assistant-ui-control-boundary\README.md`。该目录按原字节保存已被Main Agent唯一编排决策覆盖的旧ADR。

既有archive内容和规则备份在本轮保持原位不变。
