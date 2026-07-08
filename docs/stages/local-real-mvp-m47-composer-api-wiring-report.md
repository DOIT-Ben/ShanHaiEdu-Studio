# 本地真实 MVP M47 输入框与附件 API 接线验收报告

日期：2026-07-08

## 目标

修复工作台输入框、回车发送、引用资料和纸夹按钮的断链问题，避免教师看到“能输入但没有反应”的假交互。

## 修复内容

- `sendPrompt()` 在未选择项目时不再静默 return：
  - 自动创建项目。
  - 更新项目列表和当前项目。
  - 继续把首条消息发到真实 `/messages` API。
- `createWorkbenchApiClient.sendMessage()` 同时发送：
  - `content`
  - `reference`
  - `artifactRefs`
- `PromptComposer` 纸夹按钮接入隐藏 file input：
  - 支持 512KB 以内文本类文件。
  - 读取内容后作为本轮资料引用。
  - 发送时进入后端 `reference` 字段。
- `next.config.ts` 增加 `allowedDevOrigins: ["127.0.0.1"]`，减少本地 127 访问时的 Next dev HMR 噪音。

## 验证记录

| 验证项 | 结果 |
| --- | --- |
| `node --test tests/workbench-api.test.mjs tests/m47-composer-api-wiring.test.mjs` | 通过；15 tests passed |
| `node --test tests/auth-security-hardening.test.mjs` | 通过；6 tests passed |
| `npm test` | 通过；Node 101/101，Vitest 25 files / 100 tests |
| `npm run build` | 通过；Next.js 编译与 TypeScript 通过 |
| Playwright `http://127.0.0.1:3002/` | 通过；回车发送、自动建项目、附件引用发送均成功 |

## 浏览器验收摘要

Playwright 复验结果：

```json
{
  "ok": true,
  "attachedVisible": true,
  "messagePostCount": 2,
  "hasAttachmentPost": true,
  "hmrErrorCount": 0,
  "finalHasFirstMessage": true,
  "finalHasAttachmentMessage": true
}
```

截图证据：

```text
.tmp/m47-composer-127-verified.png
```

## 边界

- 本阶段接入的是文本类资料读取与消息引用，不是二进制文件持久化。
- PDF、Word、图片 OCR 仍未接入后端解析。
- 附件内容作为当前消息引用进入模型上下文，不作为正式教材证据包存储。

## 下一步

- M48 可继续做真实文件上传/教材证据包 API：
  - 文件表与存储边界。
  - PDF/图片解析。
  - 引用来源可追踪。
  - 教材证据节点自动消费上传资料。
