# V1-10E 生产运行镜像最小化测试计划

更新时间：2026-07-13

## 1. 测试矩阵

| 编号 | 场景 | 通过标准 |
|---|---|---|
| 10E-01 | 多阶段合同 | Dockerfile有builder/runtime，runtime不含Python、make、G++ |
| 10E-02 | 文件边界 | runtime只复制standalone、public、static和白名单运维脚本，不`COPY . .` |
| 10E-03 | 运行依赖 | `better-sqlite3`、Next、Sharp存在并可加载 |
| 10E-04 | 非运行依赖 | Prisma CLI、`@prisma/dev`、Hono、PostCSS不存在 |
| 10E-05 | 系统工具 | FFmpeg、ffprobe、soffice、pdfinfo、pdftoppm、curl和中文字体通过 |
| 10E-06 | 运维脚本 | init、bootstrap、production/container preflight、recovery及sqlite-url helper存在 |
| 10E-07 | 应用门 | localhost staging healthy，200/401/403，非root、单实例 |
| 10E-08 | 数据门 | 重启后SQLite integrity、管理员记录和Artifact探针保持 |
| 10E-09 | 回退 | 保留上一镜像和release，不覆盖shared数据 |

## 2. 验证

```powershell
node --test tests\container-deployment.test.mjs
npm test
npm run build
git diff --check
```

目标服务器构建后还需对最终镜像执行包目录、二进制、`better-sqlite3`、运维脚本和实际容器门检查。本阶段不以本地静态合同替代远端运行证据。
