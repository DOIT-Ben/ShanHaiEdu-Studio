# V1-10E 生产运行镜像最小化计划

更新时间：2026-07-13

状态：`accepted / in progress`

## 1. 背景

V1-10C/D 已证明单容器运行、回滚和恢复可用，但当前单阶段镜像保留完整源码和约827MB `node_modules`。生产依赖审计报告5个moderate，实际来自Next构建期PostCSS和Prisma CLI的Hono开发服务；两者都不属于应用请求运行时，却被完整依赖树带入镜像。

Next standalone当前约95MB，包含`better-sqlite3`、Next和Sharp，不包含Prisma CLI、`@prisma/dev`、Hono或PostCSS。因此本阶段改为builder/runtime多阶段镜像，减少非运行攻击面和镜像体积。

## 2. 目标

- builder阶段保留锁定依赖安装、原生依赖编译回退和Next构建。
- runtime阶段只安装FFmpeg、LibreOffice、Poppler、curl、中文字体与tini，不安装Python、make、G++。
- 最终镜像只复制Next standalone、public、static和必要运维脚本，不复制完整源码与完整`node_modules`。
- 保留SQLite初始化、管理员bootstrap、生产预检、容器预检和release数据恢复能力。
- 目标服务器重建精确提交镜像并复验health、401、403、重启、回滚和恢复CLI可用性。

## 3. 不变量

- 不改变Main Agent、Tool、HumanGate、Quality Gate、数据库Schema或Provider配置。
- 运行容器继续使用非root、单实例、loopback-only和release外共享数据。
- 不通过强制降级依赖消除审计提示；以真实运行依赖边界隔离构建工具。
- 不调用真实媒体Provider，不切公网流量。

## 4. 回退

保留`c7533ef`镜像与release作为回退点。新镜像启动、运维脚本或数据门任一失败时，重新挂载同一shared数据回滚旧镜像，不恢复旧数据。

## 5. 退出标准

- 静态合同证明多阶段、runtime无编译工具、无全量源码复制。
- 最终镜像中`prisma`、`@prisma/dev`、`@hono/node-server`、`postcss`目录不存在，`better-sqlite3`存在并可加载。
- 容器运行时工具、health=200、项目=401、注册=403、SQLite与Artifact持久性通过。
- recovery、production preflight、schema init和bootstrap脚本在镜像内存在并能加载依赖。
- 完整测试、构建、目标镜像构建与`git diff --check`通过。
