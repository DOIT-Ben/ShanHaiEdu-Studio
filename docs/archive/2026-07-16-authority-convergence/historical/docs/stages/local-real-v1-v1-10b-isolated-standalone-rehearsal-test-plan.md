# V1-10B 隔离 Standalone 发布 Rehearsal 测试计划

更新时间：2026-07-13

## 1. 自动化合同

| 编号 | 场景 | 通过标准 |
|---|---|---|
| 10B-01 | 隔离数据根 | 使用系统临时目录创建唯一shared根，数据库与Artifact目录均在release外 |
| 10B-02 | 生产变量 | 子进程固定password、trusted proxy、注册关闭、instance count=1 |
| 10B-03 | 当前环境隔离 | 不使用当前`DATABASE_URL`或`ARTIFACT_STORAGE_ROOT`作为rehearsal写目标 |
| 10B-04 | schema/admin/preflight | 隔离库初始化、管理员bootstrap、production preflight依次通过 |
| 10B-05 | standalone | 当前源码构建后由`.next/standalone/server.js`启动唯一进程 |
| 10B-06 | readiness | `/api/health`返回200且database/artifactStorage均为ok |
| 10B-07 | 认证边界 | 未认证项目API返回401；注册API返回403 |
| 10B-08 | 清理 | 正常或异常退出均停止子进程并清理本轮临时shared根 |
| 10B-09 | 脱敏 | report和stdout不包含临时绝对路径、密码、密钥或私有端点 |

## 2. 专项与真实命令

```powershell
node --test tests\deploy-demo-preflight.test.mjs
npm run preflight:deploy-demo
```

报告必须包含：database-init、admin-bootstrap、production-preflight、production-build、http-health、http-root、http-project-list、http-registration八项全部PASS。

## 3. 阶段验收

```powershell
npm test
npm run build
git diff --check
```

本阶段不运行媒体Provider smoke，不执行真实目标服务器操作。
