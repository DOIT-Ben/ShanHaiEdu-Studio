# V1-10F TTS Provider 生产就绪收尾

更新时间：2026-07-13

状态：`done / target localhost staging verified`

## 1. 阶段结论

V1完整交付的生产 Provider 门已从四类修正为五类。V1-9C要求 `concat_only_assemble` 必须通过 MiniMax TTS 生成受控旁白与字幕；此前目标服务器没有TTS配置，`preflight:production` 也未覆盖，真实E2E会在成片组装处必然失败。本阶段已将TTS加入生产硬门并安全安装目标服务器配置。

本阶段没有调用真实TTS、图片、PPT或视频Provider。真实音频、字幕URL和最终音字同步仍只在真实教师关闭HumanGate后的唯一一次产品内V1-9 E2E验证。

## 2. 完成内容

- `preflight:production` 新增 `provider-tts`，与 `generateMiniMaxVideoNarration()` 共用配置口径：优先`MINIMAX_TTS_API_KEY`，兼容`MINIMAX_API_KEY`，端点和模型允许沿用Runtime默认。
- 新增主变量、兼容变量、双缺失fail-closed和敏感值不泄露回归测试。
- 权威发布runbook更新为Main Agent、PPT、图片、视频和TTS五类Provider。
- 从私有API台账流式安装MiniMax TTS白名单字段；未输出或提交密钥、私有端点和响应内容。
- 目标服务器以精确提交`098e651`构建镜像`sha256:5051324605ac2da0408c176bc3425a515653c4c7142983494d5fed34109690bd`并接管localhost staging。
- 上一`3d6bf0a`容器及更早回退容器均保留为停止状态，没有删除历史恢复点。

## 3. 验证证据

| 门禁 | 结果 |
|---|---|
| 红灯 | 新测试在实现前因缺少`provider-tts`检查失败 |
| 生产预检专项 | 12/12通过 |
| 完整测试 | Node 271/271、Vitest 119文件842/842通过 |
| 生产构建 | exit 0，14/14页面；保留5条既有动态文件追踪性能提示 |
| 目标镜像 | 构建exit 0，容器运行时预检全部通过 |
| 生产预检 | 15/15为`ok=true`，包含`provider-tts`且来源为`minimax_tts` |
| 应用边界 | health=200、未认证项目=401、公开注册=403；非root、loopback-only |
| 配置安全 | staging env权限600，写入前已创建时间戳备份，只传输TTS白名单字段 |
| 重启与数据 | 重启后healthy；SQLite integrity=ok、管理员=1；数据库和Artifact树哈希不变 |
| 既有服务 | nginx通过，根站和3001为200，3010继续监听 |

## 4. 审查结论

- 已关闭一个P0发布阻塞：生产预检不再允许“完整视频必需的TTS缺失但发布检查全绿”。
- 预检只证明配置存在，不冒充真实TTS可用；V1-9仍必须验证真实音频、真实字幕、时序、最终AAC和成片Critic证据。
- 未改变Main Agent、课程锚点、HumanGate、Quality Gate、视频脚本、FFmpeg组装或最终包合同。
- 未切nginx、域名、证书或公网流量，不能称为正式上线。

## 5. 下一恢复点

真实项目仍停在`requirement_spec`的19步计划HumanGate。下一步必须由真实教师在产品界面确认或修改计划；外部Codex不得代替确认。确认后由产品Main Agent独立执行一次真实PPTX、完整MP4和版本一致ZIP E2E，外部Codex只在成包后黑盒验收与责任归因。
