# V1-10B 隔离 Standalone 发布 Rehearsal 收尾

更新时间：2026-07-13

状态：`done / target server pending`

## 1. 结论

V1-10B 已把旧部署演示预检升级为隔离的 production-like standalone rehearsal。命令在系统临时 shared 根内初始化独立 SQLite 与 Artifact 目录，固定单实例密码认证拓扑，完成生产预检、生产构建、standalone 启动及认证边界检查，退出后清理本轮数据库、Artifact 和服务进程。

本结论只关闭本地发布 rehearsal，不表示目标服务器已经部署、共享卷已经重启、release 已回滚、生产备份已恢复、公网注册已复核或教师已签收。

## 2. 实现

- 每次运行创建唯一 `shanhai-deploy-demo-shared-*` 临时根，不使用当前开发数据库或 Artifact 根。
- 子进程固定 password 认证、trusted proxy、公开注册关闭和单应用实例；临时管理员密码随机生成且不回显。
- 隔离库依次执行 schema 初始化、管理员 bootstrap、production preflight 和 production build。
- `.next\standalone\server.js` 启动后检查 health 200、首页 200、未认证项目 API 401、注册 API 403。
- `finally` 统一停止 standalone 服务，并在严格路径边界检查后清理临时 shared 根。

## 3. 验证证据

- `node --test tests\deploy-demo-preflight.test.mjs`：1/1 通过。
- `npm run preflight:deploy-demo`：exit 0，JSON 报告 `ok=true`，8/8 检查通过。
- `npm test`：Node 267/267、Vitest 841/841，exit 0。
- production build：14/14 页面生成，exit 0；保留 5 条既有 Turbopack 动态文件匹配警告。
- 报告检查项：database-init、admin-bootstrap、production-preflight、production-build、http-health、http-root、http-project-list、http-registration 全部 PASS。
- 执行后系统临时目录中 rehearsal shared 根数量为 0；standalone rehearsal Node 进程数量为 0。
- 当前开发数据库最后写入时间早于 rehearsal 报告生成时间，关键快照为 Project 83、Artifact 121、ProjectMembership 76；rehearsal 未把隔离管理员或数据写入开发库。
- JSON 与 Markdown 报告未命中密钥、Bearer、临时 shared 路径、数据库变量、Artifact 变量或外部端点模式。

## 4. 安全与边界

- 本阶段不调用 OpenAI、PPT、图片或视频 Provider，不生成真实媒体，不替教师通过 HumanGate。
- 未修改当前 `.env`、开发账号、项目、产物或浏览器会话。
- 测试报告位于被忽略的 `test-results\`，不作为提交内容；收尾文档只记录脱敏结果。
- 本阶段没有数据库 Schema 迁移，代码可独立 revert。

## 5. 剩余发布门

1. 真实教师继续 V1-9 当前 `requirement_spec` HumanGate；外部 Codex 不代为确认。
2. 产品 Main Agent 自主完成真实 PPT、视频、独立 Critic、Quality Gate 和最终包。
3. 目标服务器执行单实例进程守护、release 外共享卷重启、release 回滚、备份恢复、公开注册关闭与公网健康检查。
4. 外部验收者只在产品成包后做黑盒审核；至少一名真实教师完成任务、局部返修、下载和可授课签收。
