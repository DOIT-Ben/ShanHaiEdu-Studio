# V1-10A 单实例发布拓扑与数据恢复测试计划

更新时间：2026-07-13

## 1. 自动化矩阵

| 编号 | 场景 | 通过标准 |
|---|---|---|
| 10A-01 | 单实例生产配置 | `SHANHAI_APP_INSTANCE_COUNT=1` 且无多worker覆盖时preflight通过 |
| 10A-02 | 多实例配置 | instance count、web concurrency或PM2实例任一大于1时preflight失败 |
| 10A-03 | 健康检查正常 | SQLite可执行只读探针、Artifact根可读写，返回200和脱敏检查名 |
| 10A-04 | 健康检查降级 | 数据库或Artifact根不可用时返回503，不包含绝对路径、SQL或异常堆栈 |
| 10A-05 | SQLite一致备份 | WAL中已提交数据进入快照，`PRAGMA integrity_check=ok` |
| 10A-06 | Artifact备份 | 普通文件按相对路径复制并逐项记录size与SHA-256 |
| 10A-07 | 备份校验 | 文件缺失、额外、hash变化或数据库损坏任一情况verify失败 |
| 10A-08 | 安全边界 | 符号链接、路径逃逸、release内数据目录和非空恢复目标稳定拒绝 |
| 10A-09 | 恢复到新目录 | 恢复后再次verify通过，数据库行与Artifact字节一致 |
| 10A-10 | 脱敏 | CLI结果、manifest、health响应不包含源/目标绝对路径、密钥或账号 |

## 2. 专项命令

```powershell
node --test tests\production-preflight.test.mjs tests\release-data-recovery.test.mjs
npx vitest run tests\health-readiness.test.ts tests\health-route.test.ts --maxWorkers=1
npx tsc --noEmit
```

## 3. 隔离恢复 rehearsal

测试创建独立 SQLite、Artifact 根、backup 根和restore根：

1. SQLite开启WAL并写入已提交记录，Artifact根写入多层普通文件。
2. 绑定当前release id，执行backup并verify。
3. 恢复到全新的数据库文件和Artifact目录。
4. 对恢复结果再次执行SQLite integrity、行数、文件集合与hash检查。
5. 篡改一个备份文件，确认verify稳定失败且不写恢复目标。

不得读取或写入当前 `.env` 指向的开发/发布数据库，不调用真实Provider，不执行远程部署。

## 4. 阶段验收

专项通过后执行：

```powershell
npm test
npm run build
git diff --check
```

真实目标服务器共享卷重启、release切换、备份恢复和公开注册复核必须在发布窗口另行执行；本地rehearsal不能替代这些证据。
