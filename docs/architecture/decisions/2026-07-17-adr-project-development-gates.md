# ADR：项目开发门禁与证据绑定

日期：2026-07-17
状态：accepted

## 背景

本轮整改已经修复contract/executor层的具体出口，但SHA绑定、阶段范围、源码字符串合同债务、巨型模块债务和真实Provider连续性仍依赖人工记忆。人工约定无法阻止后续阶段越界、债务回涨、历史证据冒充新鲜证据或Provider敏感改动绕过真实验证。

## 决策

1. 采用一个版本化政策`config/development-gates.json`和一个机器可读活动阶段合同`docs/stages/active-stage.json`。
2. 所有本地与CI检查从同一Node入口执行；CI不得复制或弱化政策。
3. 既存源码字符串合同和复杂度超限项使用精确、单调收缩的债务基线；新增和增长失败。
4. 运行验证manifest不提交Git，绑定候选HEAD、tree、工作树、政策、阶段合同和真实命令结果。
5. Provider连续性使用manifest/receipt双文件证据。敏感变更和release验证receipt；release在缺少真实证据时失败关闭。
6. 首次启用允许一个绑定既有基线SHA、到期日和精确路径的bootstrap阶段。该例外只允许创建门禁，不证明Provider稳定，后续阶段不得复制。

## 不采用的方案

- 不提交包含自身commit SHA的运行manifest。
- 不把当前巨型模块一次性拆分塞进门禁建设阶段。
- 不把源码字符串合同全部删除后降低测试覆盖。
- 不用fixture、Provider探针或成功重试覆盖原始5xx/timeout。
- 不建立第二套release脚本或仅在CI里存在的隐藏标准。

## 后果

- 日常开发需要先建立唯一阶段合同，范围扩大必须显式修改计划和预算并接受审查。
- 既存债务可暂时存在，但任何下降必须立即锁定，不能回涨。
- Provider连续性未取得新鲜receipt前，相关敏感变更和release会被有意阻塞。
- GitHub仍需仓库管理员把job设为required；仓内代码不能替代平台分支保护。

## 迁移与回退

本阶段先建立bootstrap合同、红测试和政策基线，再接入CI。启用后如门禁实现故障，只能修复实现或通过新ADR替代；不得保留绿色job同时删除验证。回退必须恢复本阶段前`AGENTS.md`备份并移除所有竞争入口。

## 验证

按`docs/stages/project-development-gates-test-plan.md`执行DG-01至DG-12，并保留实际失败项。没有真实Provider receipt时，`gate:release`预期失败。
