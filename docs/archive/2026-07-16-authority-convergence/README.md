# 2026-07-16 文档权威收敛

本目录保存本次活动文档收敛的迁移证据。

## 结果

- 活动保留：18份。
- Roadmap：21份。
- 历史归档：610份，其中607份来自 `docs\`、3份来自仓库根。
- 移动文件：631份，执行后逐文件SHA-256一致。
- 待重写活动文档原文快照：15份。
- 既有 `docs\archive\`、私有API台账、审计MP4、代码、测试、数据库、Artifact、旧run和Skill系统未移动。

## 证据

- `archive-manifest.json`：移动前不可变清单，含旧/新路径、字节数、SHA-256、Git状态和引用来源。
- `archive-result.json`：执行结果、manifest摘要、验证文件数和总字节。
- `pre-convergence-snapshots\`：15份活动文档的改写前字节快照。
- `reference-rewrite-result.json`：9份活动/Roadmap文件的21处旧路径映射及改写前后摘要。
- `pre-reference-rewrite-snapshots\`：上述9份文件的改写前字节快照。
- `rule-backups\`：项目AGENTS时间戳备份。
- `historical\`：按原仓库相对路径保存的历史原文。

历史原文不参与当前执行。当前权威从 `..\..\README.md` 重新进入。
