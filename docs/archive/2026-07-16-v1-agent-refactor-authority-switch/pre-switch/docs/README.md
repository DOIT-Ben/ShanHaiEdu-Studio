# ShanHaiEdu 文档权威入口

更新时间：2026-07-16

本页是活动文档唯一导航。历史材料已集中到 `docs\archive\`，默认不参与搜索、规划和验收判断。

## 1. 必读顺序

1. `AGENTS.md`
2. `docs\product\current-requirements-baseline.md`
3. `docs\product\requirements-backlog.md`
4. `docs\mainlines\current-mainline-status.md`
5. `docs\architecture\README.md`
6. `docs\stages\README.md`
7. 当前阶段 plan 与 test-plan

## 2. 权威层级

```text
用户当前明确指令
> current-requirements-baseline
> current-mainline-status
> 当前已接受ADR
> 当前阶段plan / test-plan
> roadmap
> archive
```

低层测试通过不能上推为真实模型、产品E2E或发布完成。Archive中的旧计划、旧断言、旧run和旧Skill/Provider lock不能覆盖活动区。

## 3. 活动文档

| 区域 | 当前入口 | 职责 |
|---|---|---|
| 产品 | `product\current-requirements-baseline.md` | 产品不变量和质量门禁 |
| 总账 | `product\requirements-backlog.md` | 未完成、延期和未来需求 |
| 主线 | `mainlines\current-mainline-status.md` | 当前事实、五层状态、阻塞和下一动作 |
| 架构 | `architecture\README.md` | 当前架构不变量与已接受ADR |
| 阶段 | `stages\README.md` | 唯一活动阶段及Go/No-Go |
| Provider合同 | `contracts\provider-ledger-runtime-contract.md` | API台账到运行时的非敏感绑定边界 |
| 前端 | `ui\README.md` | assistant-ui工作台与视觉证据入口 |

## 4. 未来工作

已接受但不属于当前阶段的产品、架构、UI和发布工作统一从 `roadmap\README.md` 进入。Roadmap不自动取得执行权；进入主线前必须重新对照需求基线和当前状态。

## 5. 历史与证据

`archive\README.md`说明归档边界。2026-07-16权威收敛的逐文件旧路径、新路径、字节数、SHA-256、Git状态和引用来源记录在：

```text
archive\2026-07-16-authority-convergence\archive-manifest.json
```

归档原文字节保持不变。只有历史追溯或审计时才定向读取，不对archive执行批量口径修订。

## 6. 文档生命周期

```text
新需求 -> requirements-backlog
进入当前阶段 -> plan + test-plan
形成长期边界 -> ADR或baseline
完成或失效 -> 带manifest归档
未来已接受项 -> roadmap
```

活动入口不得保存阶段年表、旧测试计数、历史runId或聊天流水账。
