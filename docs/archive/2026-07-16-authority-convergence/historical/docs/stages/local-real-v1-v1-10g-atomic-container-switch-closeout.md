# V1-10G 原子容器切换收尾

更新时间：2026-07-13

状态：`done / target isolated rehearsal verified`

## 1. 阶段结论

V1 目标服务器发布控制面已从人工 Docker 命令升级为仓库内可执行的单事务切换脚本。脚本在停止当前容器前执行候选镜像生产预检，使用 `flock` 阻断并发切换，并在同一事务内完成停止、改名、安全创建、Docker Health、HTTP 就绪和失败回退。

本阶段同时关闭 V1-9G 手工切换暴露的安全回归：正式 localhost staging 与 `v1-10f-098e651` 停止态回退容器均已恢复 `cap-drop ALL` 和 `no-new-privileges`。共享 SQLite 与 Artifact 没有恢复、覆盖或迁移。

## 2. 实现

- 新增 `deploy\switch-v1-container.sh`。
- 候选镜像预检失败时不停止当前容器。
- 当前已是目标镜像且 Docker/HTTP 均健康时幂等返回 `already_current`。
- 新容器固定非 root、loopback 端口、共享卷、单实例、安全参数和与 compose 一致的 Health 合同。
- Docker Health 与 `/api/health` HTTP 200 必须同时通过。
- 候选进入 `exited` 或 `dead` 时立即回退，不再等待满超时。
- trap 在停止当前容器前安装；改名前异常恢复原 current，改名后异常删除失败候选并恢复旧容器名称。
- 输出只含最小 JSON 状态和脱敏容器名，不打印 env、共享路径、密钥或容器日志。
- 发布 runbook 已改为统一调用该脚本，并明确 401 与资源隐藏型 404 的认证边界。

## 3. 测试与演练证据

| 门禁 | 结果 |
|---|---|
| 红灯 | 首轮合同测试 4/4 失败，证明脚本与 runbook 入口原先不存在；终止态快速回退与 stop 前 trap 也分别先红后绿 |
| 专项 | 发布切换与容器合同 5/5 通过 |
| Bash | 目标服务器 `bash -n` 通过；ShellCheck 未安装，因此没有 ShellCheck 证据 |
| 成功切换 | 隔离 3212、隔离 SQLite/Artifact 从 `v1-10f-098e651` 切到 V1-9G；新容器 healthy、安全参数齐全、旧容器停止保留 |
| 故障回退 | watcher 在新候选启动后将其停止；脚本返回非零并依次输出 `rollback_started`、`rollback_succeeded`，V1-9G 恢复为 current 且 healthy |
| 并发互斥 | 外部持有 lock 时第二次调用 exit 73、状态 `release_switch_locked`，current 没有变化 |
| 停止态恢复 | 停止的 current 通过同一脚本重新切换到目标镜像并 healthy，随后主动停止隔离容器，3212 无监听 |
| 数据边界 | 隔离数据库摘要 `0c4feb...b8cc5`、Artifact 摘要 `dc93ff...6e9c` 在成功切换和故障回退后保持一致 |
| 全量测试 | Node 275/275、Vitest 119 文件 849/849通过；TypeScript exit 0 |
| 生产构建 | 14/14 页面通过；保留 5 条既有 Turbopack 动态文件追踪性能警告 |
| 正式 staging | V1-9G 单容器、Docker healthy、`cap-drop ALL`、`no-new-privileges`、3210 loopback；health=200、项目隐藏=404、注册=403 |

## 4. 失败路径与修正

- 第一次手工切换遗漏 compose 安全参数。确认后立即用相同镜像、env、共享卷和 Health 合同串行重建正式与回退容器，数据摘要未变化。
- 首次故障注入观察发生在候选等待超时期间，一度看到 3212 关闭；原脚本最终在超时后正确回退。随后新增终止态检测，使 `exited/dead` 立即进入回退，并再次演练取得明确 JSON 证据。
- 代码审查发现 stop 与 trap 安装之间存在窄中断窗口。测试先红后将 trap 前移，并用 `previous_ready` 区分改名前恢复和改名后回退。

## 5. 边界与下一步

- 未调用 Main Agent、PPT、图片、视频或 TTS Provider，未越过教师 HumanGate。
- 未切 nginx、域名、证书或公网流量；localhost staging 不是正式上线。
- 隔离演练容器均已停止，3212 已释放；演练目录和停止态容器保留为证据，没有执行未经授权的删除。
- 真实项目仍停在 `requirement_spec` 的 19 步计划确认门。下一步仍必须由真实教师确认或自然语言修改，然后由产品 Main Agent 独立执行唯一一次 V1-9 真实交付 E2E。
