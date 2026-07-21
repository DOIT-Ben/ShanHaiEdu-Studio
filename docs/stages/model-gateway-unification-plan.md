# 统一模型网关迁移计划

更新时间：2026-07-20

## 目标

把 Agent、结构化文本、图片、视频和 TTS 的生产模型配置统一到服务端模型网关。运行时只从 `MODEL_GATEWAY_*` 与受控服务端环境文件读取凭据和模型；`API台账系统`仅保留历史合同与审计证据，不再作为生产凭据入口。

统一模型：

- Agent：`gpt-5.6`
- 结构化文本：`deepseek`
- 图片：`image-2`
- 视频：`video-grok`
- TTS：`speech-2.8-hd`

## 范围

- 新增服务端统一网关配置读取，支持环境变量、dotenv 指针和 `{_type,key,url}` JSON 凭据文件。
- Main Agent 与 Agent Tool 不得再从 Provider Ledger 选择模型或凭据。
- 图片使用 `/v1/images/generations`；视频使用 `/v1/videos` 与 `/v1/videos/:id`；TTS 使用 `/v1/audio/speech`。
- 生产能力可用性和生产 preflight 只接受统一网关配置。
- 远程 Coze PPT 路径关闭；本地受控 CLI 仅作为非模型成品生成路径保留。
- 历史 Provider Ledger 合同、证据和旧 fixture 不删除，不得恢复为生产凭据入口。

## 当前验证事实

- `/v1/models`：HTTP 200，列出 `gpt-5.6`、`deepseek`、`image-2`、`video-grok`、`speech-2.8-hd` 等模型。
- `/v1/responses` + `gpt-5.6`：HTTP 200，请求 ID 存在。
- `/v1/chat/completions` + `deepseek`：HTTP 200，请求 ID 存在。
- `/v1/audio/speech` + `speech-2.8-hd`：HTTP 200，返回真实 MP3，43,188 字节，SHA-256 已记录，请求 ID 存在。
- `/v1/images/generations` + `image-2`：HTTP 200，返回真实可解析图片，862,734 字节，SHA-256 已记录，请求 ID 存在。
- `/v1/videos` + `video-grok`：HTTP 200；`GET /v1/videos/:id` 返回完成态；`GET /v1/videos/:id/content` 下载真实有效 MP4，393,821 字节，SHA-256 已记录，请求 ID 存在。
- 旧 `/v1/image_generation`：HTTP 404；旧 `/v1/videos/generations`：HTTP 405，不能作为兼容回退。

更新后的同一网关凭据已完成五类真实 smoke；最终候选中图片单次成功，图片、MP3、MP4 均完成字节验真，receipt 与 development gate 已通过。当前状态为 `MODEL GATEWAY CONTRACT PASS / FULL REGRESSION PASS / LIVE RECEIPT PASS / RELEASE BLOCKED`；产品级 V1-9、教师签收和 release 仍需单独验收。

## 完成门槛

1. 同一服务端网关凭据对五类模型端点全部成功。
2. 图片返回真实可解析图片；视频提交、轮询和下载真实 MP4 全部成功。
3. 网关聚焦测试、全量测试、类型检查、零 warning Lint、构建和 development gate 通过。
4. 源码生产调用路径不再读取旧 Provider 凭据或台账运行时合同。
5. 通过独立审查后提交、合并到 `main`，再删除本次分支。

五类真实 smoke、全量回归和提交前审查未全部通过前，不得宣称统一完成，不得合并或发布。
