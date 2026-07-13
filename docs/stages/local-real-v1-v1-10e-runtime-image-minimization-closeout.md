# V1-10E 生产运行镜像最小化收尾

更新时间：2026-07-13

状态：`done / target localhost staging verified`

## 1. 完成内容

- 将生产镜像从单阶段完整依赖树改为 builder/runtime 多阶段镜像，最终运行镜像约 1.16GB，较约 2.64GB 的上一镜像缩减约 56%。
- 最终镜像只保留 Next standalone、静态资源、运行所需系统工具和白名单运维脚本；Prisma CLI、`@prisma/dev`、Hono、PostCSS及编译工具不进入运行镜像。
- 修正生产预检与真实 Runtime 的配置合同漂移：图片通道沿用 Runtime 的 `gpt-image-2` 默认模型；视频通道正式识别 Evolink 环境别名和默认端点。
- 从本机私有 API 台账安全安装 Main Agent、Coze PPT、图片主通道和 Evolink 视频配置到目标服务器受限 env；未把密钥、私有端点或响应体写入日志、文档和提交。
- 目标服务器以精确提交 `3d6bf0a` 构建镜像 `sha256:59d86173b29ec4ff7e9d256e6fa28336e91103a15f4d6d260e99bd3fb49e5f8f`，接管 localhost staging；上一 `f106d1c` 容器和旧成功镜像保留为回退点。

## 2. 验证证据

| 门禁 | 结果 |
|---|---|
| 生产预检专项 | 11/11 通过，含图片默认模型和 Evolink 别名回归 |
| 完整测试 | Node 270/270、Vitest 119文件842/842通过 |
| 生产构建 | exit 0，14/14页面；保留5条既有动态文件追踪性能提示 |
| 目标镜像构建 | exit 0，容器运行时预检全部通过 |
| 运行依赖边界 | `better-sqlite3`、Next、Sharp存在；Prisma CLI、Hono、PostCSS和编译工具不存在 |
| 生产预检 | 14/14为`ok=true`；密码认证、可信代理、单实例、关闭注册、外置SQLite/Artifact及四类Provider配置全部通过 |
| Main Agent真实连通 | Responses协议、`gpt-5.6-terra`、`medium`最小文本请求返回HTTP 200 |
| 应用边界 | health=200、未认证项目=401、公开注册=403；单容器、非root、3210仅loopback |
| 重启与数据 | 重启后healthy；SQLite integrity=ok、管理员=1；数据库和Artifact树哈希不变 |
| 既有服务保护 | nginx配置通过，根站和3001为200，3010继续监听 |
| 配置安全 | staging env权限600；写入前已保留时间戳备份；检查只输出字段存在性和Provider来源 |

## 3. 失败路径与修正

- 首次目标镜像构建误用了HTTPS Debian镜像。基础 slim 镜像尚未安装CA证书，`apt-get update`因证书链不可用失败，未生成目标镜像、未修改当前容器。
- 通过既有成功镜像的 Docker history 反查到已验证参数为腾讯 Debian HTTP镜像；按相同参数重建后一次通过。没有继续猜测其他镜像源。
- Main Agent首次最小 smoke 直接从 standalone 根目录 `require("openai")` 失败，因为 SDK只存在于Next服务端bundle而非顶层运行依赖。随后使用与产品相同的Responses HTTP协议原生请求，返回200；该失败不属于Provider故障。

## 4. 安全与回退

- 当前仍是目标服务器 `127.0.0.1:3210` staging，没有修改nginx、域名、证书或公网80/443流量。
- 旧容器已停止并改名保留；新容器启动脚本在健康失败时会自动移除失败容器并恢复旧容器。
- 共享SQLite和Artifact目录未迁移、未覆盖；代码回退不得自动恢复旧数据。
- 未调用真实图片、PPT或视频生成，未越过真实教师HumanGate。

## 5. 剩余上线门

1. 真实教师在产品内确认当前19步计划，外部Codex不得代替批准。
2. 产品Main Agent独立完成唯一一次真实PPTX、完整MP4和版本一致ZIP E2E，并留下Critic、HumanGate、Quality Gate和返修证据。
3. 成包后由外部Codex做黑盒验收与责任层归因，不介入包内编排。
4. E2E通过后再执行nginx/HTTPS正式切流，复核公开注册403、登录、项目、产物、反馈和回滚入口。
5. 至少一名真实教师完成下载、可授课性检查和签收。
