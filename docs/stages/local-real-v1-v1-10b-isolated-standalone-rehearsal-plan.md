# V1-10B 隔离 Standalone 发布 Rehearsal 计划

更新时间：2026-07-13

状态：`done / target server pending`

## 1. 背景

V1-10A 加强生产预检后，真实运行 `npm run preflight:deploy-demo` 在进入构建前失败。证据表明旧脚本直接使用当前开发 `.env` 和仓库内数据库，缺少生产客户端认证、可信代理、单实例、公开注册关闭等变量，也不满足release外数据目录要求。继续给当前开发 `.env` 补生产值会污染真实开发会话，不能作为可信发布rehearsal。

## 2. 目标

把一键部署演示门升级为隔离、可重复、无Provider副作用的本地生产式rehearsal：

- 每次运行创建release外临时shared根，内部包含SQLite和Artifact目录。
- 只在子进程环境注入密码认证、可信代理、公开注册关闭和单实例配置，不修改当前`.env`。
- 在隔离库执行schema初始化和管理员bootstrap，生产预检必须全部通过。
- 构建并启动`.next\standalone\server.js`，验证health=200、未认证项目API=401、注册API=403。
- 停止服务后清理本轮隔离shared根，不保留密码、数据库或Artifact副本。

## 3. 边界

- 不调用OpenAI、PPT、图片或视频Provider；preflight只检查配置类别存在。
- 不读取或输出Provider值，不把临时路径写入报告。
- 不修改当前开发数据库、Artifact根、用户账号或浏览器会话。
- 本地rehearsal不替代目标服务器进程守护、共享卷重启、release回滚、备份恢复和公网验收。

## 4. 实施

1. 扩展现有静态合同测试，要求隔离shared根、单实例变量、health/401/403和清理边界存在。
2. 重构`deploy-demo-preflight.mjs`的command env与生命周期。
3. HTTP smoke新增`/api/health`和`/api/auth/register`。
4. 实跑完整命令并核对脱敏JSON/Markdown报告。
5. 全量测试、构建、closeout和独立提交。

## 5. 退出标准

- `npm run preflight:deploy-demo` exit 0、report `ok=true`。
- production preflight全部通过，隔离数据库和Artifact根位于release外。
- standalone health=200、项目API=401、注册API=403。
- 运行前后当前开发数据库关键计数不变；临时shared根已清理。
- 报告和终端不包含密钥、私有端点、管理员密码或临时绝对路径。
