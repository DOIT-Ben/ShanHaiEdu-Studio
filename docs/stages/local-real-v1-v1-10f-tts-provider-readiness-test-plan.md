# V1-10F TTS Provider 生产就绪测试计划

更新时间：2026-07-13

## 1. 自动化矩阵

| 编号 | 场景 | 通过标准 |
|---|---|---|
| 10F-01 | TTS主变量 | `MINIMAX_TTS_API_KEY`存在时`provider-tts`通过，来源为`minimax_tts` |
| 10F-02 | TTS兼容变量 | 仅`MINIMAX_API_KEY`存在时同样通过 |
| 10F-03 | TTS缺失 | 两种key均缺失时生产预检失败并只报告缺失变量名 |
| 10F-04 | 默认配置一致 | 未显式设置端点或模型时仍与 Runtime 的官方默认一致，不制造假缺口 |
| 10F-05 | 脱敏 | 预检序列化结果不包含TTS密钥、私有端点或响应内容 |
| 10F-06 | 全量回归 | 既有认证、SQLite、Artifact、Main Agent、Coze、图片和视频检查不回归 |

## 2. 目标服务器矩阵

| 编号 | 场景 | 通过标准 |
|---|---|---|
| 10F-07 | 配置安全 | staging env权限600，白名单字段存在，写入前备份存在 |
| 10F-08 | 生产预检 | 所有检查`ok=true`，包含`provider-tts`且无敏感值输出 |
| 10F-09 | 应用边界 | healthy、200/401/403、单容器、非root、loopback-only |
| 10F-10 | 重启持久性 | 重启后SQLite integrity=ok、管理员存在、数据库与Artifact哈希不变 |
| 10F-11 | 既有服务 | nginx、根站、3001和3010不受影响 |

## 3. 验证命令

```powershell
node --test tests\production-preflight.test.mjs
npm test
npm run build
git diff --check
```

完整测试继续使用项目内单 worker 限制。本阶段不执行真实 TTS smoke；真实音频和字幕只在教师关闭 HumanGate 后的唯一一次产品内 V1-9 E2E产生。
