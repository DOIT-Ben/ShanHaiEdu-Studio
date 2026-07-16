# V1-10F TTS Provider 生产就绪计划

更新时间：2026-07-13

状态：`accepted / in progress`

## 1. 背景

V1-9C 已把 MiniMax TTS 设为完整导入视频的硬依赖：`concat_only_assemble` 必须生成受控旁白与字幕，替换视频 Provider 原始音轨，并从最终 MP4 反向形成 AAC、SRT 和成片审查证据。目标服务器 V1-10E staging 已配置 Main Agent、Coze PPT、图片和视频四类 Provider，但没有任何 MiniMax TTS 配置；现有 `preflight:production` 也未检查 TTS，因此会在真实 E2E 必然失败的状态下错误返回全绿。

私有 API 台账已有 MiniMax TTS 密钥、端点、模型和音色字段。本阶段只关闭生产就绪合同与安全配置缺口，不提前调用真实 TTS 或其他媒体 Provider。

## 2. 目标

- `preflight:production` 增加 `provider-tts` 硬门，判定与 `generateMiniMaxVideoNarration()` 的真实配置读取一致。
- 支持 Runtime 已有别名：`MINIMAX_TTS_API_KEY` 优先，`MINIMAX_API_KEY`兼容；端点和模型继续沿用 Runtime 的安全默认。
- 预检输出只包含检查结果、缺失变量名和通道来源，不输出密钥、私有端点、音色或响应内容。
- 从私有台账安全安装 TTS 所需字段到目标服务器受限 staging env，保留配置备份并维持权限600。
- 以精确提交重建最小运行镜像，生产预检、应用边界、重启和数据持久性全部复验。

## 3. 复用与适配

- 复用 `src\server\video-generation\video-narration-provider.ts` 的配置选择规则，不另建第二套 TTS 配置模型。
- 复用 `scripts\production-preflight.mjs`、`tests\production-preflight.test.mjs` 和 V1-10E 的最小镜像/回退路径。
- 复用 `API台账系统\PRIVATE-LOCAL-SECRETS\apps-api\.env` 作为本机私有权威源；只流式传输白名单字段，不复制整个私有 env。
- 不修改旁白合同、字幕解析、FFmpeg 组装、课程锚点、HumanGate、Quality Gate 或 Main Agent编排。

## 4. 风险与回退

- 风险：仅检查配置存在不等于真实 TTS 可用。处理：本阶段明确只关闭部署配置门；真实音频、字幕 URL 和音字同步仍在唯一一次 V1-9 E2E验证。
- 风险：预检与 Runtime 再次漂移。处理：回归测试直接覆盖 Runtime接受的主变量和兼容别名，并验证缺失时 fail-closed。
- 风险：配置写入泄密。处理：命令与输出不包含值；远端使用600权限、时间戳备份和原子替换。
- 回退：保留当前 `af0e1dc/3d6bf0a` 镜像、容器和配置备份；新容器不健康或预检失败时恢复旧容器，不恢复旧数据。

## 5. 退出标准

- 缺少两种 TTS key 时 `provider-tts` 为失败，完整配置时通过。
- 测试证明结果序列化不泄露 TTS密钥和私有端点。
- 专项、完整 Node、完整 Vitest、生产构建与 `git diff --check` 全部通过。
- 目标服务器 production preflight 全部通过并明确包含 `provider-tts`。
- health=200、未认证项目=401、公开注册=403，重启后 SQLite/Artifact 哈希不变。
- 未调用真实 TTS、图片、PPT或视频 Provider，未越过真实教师 HumanGate。
