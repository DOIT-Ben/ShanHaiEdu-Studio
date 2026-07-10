# M64-R ToolRouter 统一封装收尾

日期：2026-07-10

状态：工程完成

## 1. 完成内容

- CapabilityRegistry 与 ToolRegistry 已达到 17/17 唯一映射。
- 14 项工具可执行，3 项未接入能力继续明确 fail-closed：`intro_video`、`asset_image_generate`、`concat_only_assemble`。
- 新增 `generate_classroom_image` 与 `generate_video_segment` Provider ToolDefinition。
- PPTX、课堂图片和分镜视频的 CTS 与独立 POST Route 全部改为经过 ToolRouter。
- ToolRouter 的能力集合由 ToolRegistry 动态生成，不再手工维护遗漏列表。
- Provider Tool 只接受同项目、已批准且 ID/kind/nodeKey 匹配的服务端 resolved Artifact。
- Provider Adapter 不再把裸引用伪造成 `approved/version=1` Artifact，并保留真实版本。
- 同类已批准产物按传入顺序使用最新版本。
- Provider 成功必须包含真实 Artifact Truth 和通过的 Quality Gate；Router、CTS 和三个 POST Route 均有防御性阻断。
- 保存的 PPTX、图片、视频 metadata 与现有下载器的 `storage.cozePptx/imageAsset/videoAsset` 合同保持一致。
- 旧 M59/M60 源码架构测试已更新为验证 ToolRegistry/ToolRouter 新边界。

## 2. 验证证据

```text
npm test
  Node: 197 passed / 0 failed
  Vitest: 439 passed / 0 failed

npx tsc --noEmit
  exit 0

npm run build
  Next.js production build exit 0

git diff --check
  exit 0

graphify update .
  2647 nodes / 6515 edges / 203 communities
```

没有残留 Vitest、Jest 或 Playwright worker。

## 3. 未包含范围

- `asset_image_generate` 真实 Provider 尚未接入。
- `concat_only_assemble` 真实只拼接实现尚未接入。
- `final_package` Tool 当前仍生成交付清单，不等同于工具层真实 ZIP 打包。
- M66-R OpenAI native tool loop 仍未接入生产 Runtime Factory。
- MCP Client Adapter 仍未实现。
- 独立 Route 的失败事实保存在 GenerationJob；统一 ToolObservation 独立持久化仍需后续 ActionExecution 协调器承接。
- 本轮没有使用真实外部凭据执行 PPTX、图片和视频网络 smoke，因此不能据此宣称外部 Provider 当前在线。

## 4. 下一步

按用户当前优先级，下一阶段先完成真实智能体链路闭环：实现剩余阻断工具、接入真实最终包动作、完成 M68 自然语言执行一致性，并用一个真实教师任务跑通从输入到下载交付；之后再进入公开注册和多用户管理。
