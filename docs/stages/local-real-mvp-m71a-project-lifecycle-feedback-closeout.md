# M71A 项目生命周期与工作台反馈收尾记录

日期：2026-07-11

状态：done

## 完成内容

- 反馈类型、快速补充和影响程度补齐 selected、focus、必填语义和提交按钮状态。
- 主对话 Agent 对轻量问候限制为自然的一到两句追问，不启动工具计划或完整材料链路。
- Project 增加 `archivedAt`、`deletedAt`、`lifecycleVersion`；旧 SQLite 数据库可重复升级。
- 完成项目重命名、归档、软删除、回收站和恢复；删除不删除关系、消息、产物或本地文件。
- 生命周期变更使用版本条件更新、项目忙碌检查、30 分钟 stale job 对账、审计记录和成员角色权限。
- active、已归档、回收站列表隔离；已归档或回收站项目拒绝业务写入。
- 交付受控回退脚本：默认 dry-run，导出只含 ID/状态/版本；apply 需要固定确认短语与备份确认环境标记。

## 验证证据

- `npm test`：Node `218/218`、Vitest `467/467`，失败数为 0。
- `npm run build`：exit 0。
- `node --test tests/project-lifecycle-sqlite-upgrade.test.mjs`：legacy SQLite 连续两次升级通过。
- `node --test tests/m71a-project-lifecycle-rollback.test.mjs`：dry-run、导出、拒绝未确认 apply、受控恢复和幂等复跑通过。
- `npx vitest run src/server/workbench/__tests__/stage71-project-lifecycle.test.ts --maxWorkers=1`：归档/恢复、版本冲突、busy 拒绝、stale 对账和回收站写入拒绝通过。
- 浏览器实测 `http://127.0.0.1:3218`：创建项目、铅笔重命名、归档、已归档恢复、回收站恢复均完成；390px 项目 Sheet 显示项目操作、已归档与回收站入口。
- 截图：`output\playwright\m71a-project-lifecycle-desktop.png`、`output\playwright\m71a-project-lifecycle-mobile-390.png`。
- `graphify update .`：`3047` nodes、`7703` edges、`277` communities。

## 保留边界与风险

- 本阶段不提供永久物理删除、自动过期清理或本地产物清理。
- 真实用户开放仍受 M67 共享卷重启、release 回滚、备份恢复和外部 Provider smoke 门禁约束。
- 轻量问候已由模型请求合同和 fallback 单测验证；本阶段未额外消耗真实 Provider 调用进行问候内容验收。
- `docs\architecture\**` 未纳入 M71A 修改范围。
