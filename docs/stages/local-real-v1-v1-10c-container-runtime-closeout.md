# V1-10C 单容器生产运行时收尾

更新时间：2026-07-13

状态：`done / target localhost staging verified`

## 1. 完成内容

- 精确提交 `75bf141` 已在目标服务器构建为镜像 `sha256:b5009cb97539d979e6749213f6a8bbfa48911fa10e1a2b57c3e2fb97471fd030`。
- 镜像固定 Node.js 22.23.1、FFmpeg/ffprobe、LibreOffice Impress、Poppler、curl、Noto CJK 字体与 tini。
- `better-sqlite3` 在镜像内真实加载通过；用于原生依赖回退编译的 `python3`、`make`、`g++` 已从最终运行镜像移除。
- staging 以单容器、单 Node 进程、`1000:1000`、capabilities 全移除和 `no-new-privileges` 运行。
- 端口仅绑定 `127.0.0.1:3210`；SQLite 与 Artifact 使用 release 外共享目录，未进入镜像或 release。
- 旧成功镜像保留回退标签 `shanhai-edu-studio:v1-10c-rollback-9bcec1b`，本阶段未执行正式 release 回滚。

## 2. 验证证据

| 门禁 | 结果 |
|---|---|
| 目标镜像构建 | exit 0，Next.js 14/14 页面构建完成 |
| 容器运行时预检 | Node engine、FFmpeg、ffprobe、soffice、pdfinfo、pdftoppm、curl、fontconfig、Noto CJK 全部通过 |
| 原生 SQLite | `better-sqlite3=ok` |
| 构建工具清理 | `python3=absent`、`make=absent`、`g++=absent` |
| 容器健康 | `healthy`，`GET /api/health=200` |
| 认证边界 | 未认证项目 API=401，公开注册 API=403 |
| 进程与端口 | 用户`1000:1000`，单 staging 容器，`127.0.0.1:3210` |
| SQLite 持久性 | 重启前后哈希一致，`integrity_check=ok`，既有管理员记录保留 |
| Artifact 持久性 | 重启前后探针哈希一致 |
| 既有服务保护 | nginx配置通过，根站与3001=200，3010仍监听 |

本地阶段证据继续有效：Node 268/268、Vitest 842/842、容器合同 1/1、图片跨平台专项 1/1、TypeScript、生产构建与 `git diff --check` 均已通过。

## 3. 已关闭问题

- 官方 Debian 源低速与代理 502 路径不再重试；构建通过可配置腾讯 Debian 镜像完成。
- `better-sqlite3` 预编译不可用时可回退本地编译，且编译工具不会留在最终运行镜像。
- FFmpeg 与 Poppler 探测参数已修正，避免把正常工具误判为不可用。

## 4. 残余风险与边界

- 本次是目标服务器 localhost-only staging，不是公网发布，没有修改 nginx、域名、证书或 80/443 流量。
- 尚未执行正式 release 回滚、备份恢复和恢复后业务验收。
- `npm ci` 报告 5 个 moderate 依赖风险；本阶段未使用破坏性 `npm audit fix --force`，正式发布前需单独分类生产依赖与开发依赖影响。
- 未调用真实 PPT、图片、视频 Provider，也未替代 V1-9 产品内 Main Agent E2E、真实教师 HumanGate 或教师签收。

## 5. 下一阶段

1. 执行 V1-10 release 回滚与备份恢复演练，保存恢复点、耗时和恢复后 200/401/403 证据。
2. 回收 V1-9 产品内需求确认门；必须由真实教师确认，外部 Codex 不代替点击或自然语言批准。
3. V1-9 成包后由外部 Codex 只做黑盒审核与责任层归因；通过后再进入正式 nginx/HTTPS 切流和邀请制教师签收。
