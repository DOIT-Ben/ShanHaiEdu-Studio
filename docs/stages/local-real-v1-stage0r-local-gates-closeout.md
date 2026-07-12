# ShanHaiEdu V1 Stage 0R 本地门禁收尾

更新时间：2026-07-12

状态：`Stage 0R completed / old-flow baseline ended in a verified delivery block`

## 1. 范围

本次只关闭 V1 接管后的两个本地验收差距，并校准正式计划：

1. M72 “只做视频脚本”缺少硬前置时不得进入无解确认循环。
2. M77/M78 真实项目 owner 的成员权限 Select 写路径必须完成桌面与 390px 验收。

本 closeout 初版形成时尚未执行真实 PPTX、图片、视频 Provider、最终包端到端或目标服务器操作。后续 Provider 与交付工具探测已经记录在 `docs\stages\local-real-v1-stage0r-provider-capability-report.md`；固定教师任务的旧流程真实基线已经记录在 `docs\stages\local-real-v1-stage0r-old-flow-baseline-report.md`。目标服务器操作仍属于发布阶段门禁。

## 2. 实现

- `src\server\capabilities\capability-availability.ts`：缺少批准前置时，从 CapabilityRegistry 生成具体成果名称，不再使用统一空泛文案。
- `video_script_generate`：专门说明可只做视频脚本、缺少导入创意主题、需要补充的年级/课题/导入情境，以及不会自动扩张到 PPT 或最终视频。
- `tests\capability-availability.test.ts`：新增视频脚本最小缺口合同，并验证普通能力点名真实前置成果。
- `tests\conversation-turn-service.test.ts`：更新服务层验收，要求返回具体 PPT 设计稿缺口，同时保持不创建 Job、不生成 Artifact。

## 3. 自动化证据

```text
npx vitest run tests/capability-availability.test.ts tests/conversation-control-resolver.test.ts tests/main-conversation-agent.test.ts tests/conversation-turn-service.test.ts
  Test Files 4 passed
  Tests 53 passed

npm test
  Node 259/259
  Vitest 67 files / 482 tests

npm run build
  exit 0

git diff --check
  exit 0
```

## 4. 浏览器证据

测试环境使用独立临时 SQLite 数据库、password auth、临时 owner 与教师账号；未读取或修改现有用户数据库。凭据未写入文档。

| 门禁 | 实际结果 | 证据 |
|---|---|---|
| M72 桌面 | “只做视频脚本”返回具体最小缺口，不调用视频 Provider，不扩张到 PPT/最终视频 | `.playwright-cli\page-2026-07-11T17-59-21-969Z.png` |
| M72 390px | 文案完整换行，无重叠和横向溢出 | `.playwright-cli\page-2026-07-11T17-59-35-400Z.png` |
| M77 新增成员 | 键盘把默认 viewer 改为 editor，POST 201 | Playwright 请求记录 30 |
| M77 修改成员 | 键盘把 editor 改为 viewer，PATCH 200；刷新后仍为 viewer | Playwright 请求记录 32；刷新后快照 |
| M77/M78 390px | Dialog 与 Select listbox 在视口内，选中勾选、移除按钮均可见 | `.playwright-cli\page-2026-07-11T18-01-49-316Z.png` |

## 5. 新发现

使用当前 `.env` 的 Agent Brain 做首轮真实浏览器复现时，请求等待约 60 秒后才回退。该现象与 M72 缺口文案是两个独立问题：后续最小 OpenAI-compatible smoke 已在 5.65 秒返回模型生成结果，证明 Provider 当前可达，但尚未解释应用内 60 秒回退；应用路径、通道选择、上层超时和请求负载仍需在旧流程基线中继续定位。

开发环境仍有 `favicon.ico` 404 和认证封面 `sizes` 性能提示，均为非阻塞观察。

## 6. 旧流程基线补充结论

固定教师任务已经运行到真实阻断点：PPTX 应用链路失败后成功改道，课堂视觉图真实生成；视频文本节点一路生成到资产说明，但上游课题丢失导致知识锚点、创意和脚本持续出现“待确认课题”。`asset_image_generate` 失败且没有进入 GenerationJob，随后片段计划因缺少真实资产图被阻止，视频 Provider 未调用，最终包未生成。

本轮共 19 个 ConversationTurnJob，15 成功、4 失败；12 次 Artifact approve；后台 Turn 累计 464.8 秒。详细节点、质量评分、Replan 和阻断证据见旧流程基线报告。

## 7. 下一步

Stage 0R 的本地门、Provider 能力探测和旧流程对照基线已经完成。完成的含义是“缺口已被真实证据封板”，不是“旧流程交付通过”。下一步进入 Stage 1A，优先实现执行身份、项目写租约、意图版本栅栏、幂等和 Provider Job 恢复；PPTX、资产图、视频、最终包、目标服务器和教师签收门继续保持未关闭。
