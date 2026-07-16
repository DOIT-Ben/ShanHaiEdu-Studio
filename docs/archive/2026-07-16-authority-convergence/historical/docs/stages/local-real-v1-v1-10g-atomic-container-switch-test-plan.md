# V1-10G 原子容器切换测试计划

更新时间：2026-07-13

## 1. 自动化合同

| 编号 | 场景 | 通过标准 |
|---|---|---|
| 10G-01 | 参数与依赖 | 缺镜像、env、共享目录、Docker、curl 或 flock 时在修改当前容器前失败 |
| 10G-02 | 单事务互斥 | 同一容器锁被占用时第二个切换立即失败，Docker 变更次数为 0 |
| 10G-03 | 幂等目标 | 当前已是目标镜像且 Docker/HTTP 健康时返回 `already_current` |
| 10G-04 | 候选预检 | `production-preflight` 在停止当前容器之前执行；预检失败不停止当前容器 |
| 10G-05 | 安全创建 | 新容器固定非 root、`cap-drop ALL`、`no-new-privileges`、loopback、共享卷和 Docker Health |
| 10G-06 | 双健康门 | Docker healthy 与 HTTP 200 必须同时满足；只满足一个不得提交切换 |
| 10G-07 | 失败回退 | 新容器创建、启动或健康超时失败时，失败容器被移除，旧容器恢复原名并重新健康 |
| 10G-08 | 数据边界 | 切换和代码回退不执行数据库/Artifact restore，不打印 env、路径、密钥或容器日志 |
| 10G-09 | 成功保留 | 成功后旧容器保持停止态并返回其脱敏名称，当前容器运行目标镜像 |

## 2. 隔离目标服务器演练

使用独立容器名、独立 loopback 端口、复制后的隔离 SQLite 与 Artifact 目录，不连接公网、不调用 Provider：

1. 用上一成功镜像创建隔离 current，确认 healthy。
2. 调用脚本切换到 V1-9G 镜像，确认成功、旧容器停止保留、数据摘要不变。
3. 使用健康检查必然失败的测试镜像或受控参数触发失败路径，确认自动恢复旧 current。
4. 复核没有残留运行容器、端口或未回收锁。

## 3. 阶段验收命令

```powershell
node --test tests\release-container-switch.test.mjs tests\container-deployment.test.mjs
npm test
npm run build
git diff --check
```

目标服务器额外执行：

```text
bash -n deploy/switch-v1-container.sh
隔离成功切换演练
隔离失败回退演练
常驻 localhost staging 重启与 200/404/403 复验
```

本阶段不调用真实 Main Agent、PPT、图片、视频或 TTS Provider，不改变教师 HumanGate。
