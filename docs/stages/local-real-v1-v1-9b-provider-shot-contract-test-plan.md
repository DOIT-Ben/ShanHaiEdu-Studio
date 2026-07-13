# V1-9B 产品内单镜头 Provider 合同测试计划

更新时间：2026-07-13

| 编号 | 场景 | 预期 |
|---|---|---|
| V1-9B-01 | OpenAI storyboard 结构化输出 | `videoStoryboardManifest` 校验通过并持久化 |
| V1-9B-02 | 缺失/损坏 manifest | Runtime 或 Capability Gate 拒绝 |
| V1-9B-03 | `shotIds=[shot_02]` | 只解析第二镜头，Provider runner 只收到该镜头 |
| V1-9B-04 | 无 shotIds、多 shotIds、重复或越界 | submit=0，质量门禁失败 |
| V1-9B-05 | referencePolicy=required | 上传真实已批准资产，URL 与 hash 证据绑定当前镜头 |
| V1-9B-06 | 资产 hash 或适用镜头不匹配 | submit=0 |
| V1-9B-07 | Provider 成功 | Artifact 持久化 requestEvidence 与当前 shotId |
| V1-9B-08 | 镜头级返修 | 只重新生成 finding 指向的镜头，不自动扩大范围 |
| V1-9B-09 | 回归 | 既有 Agent、Tool Router、HumanGate、视频恢复和 V1-9A 时间线不回归 |

验证命令：

```powershell
npx vitest run tests/openai-runtime.test.ts tests/provider-tool-adapter.test.ts tests/tool-registry.test.ts tests/video-production-contract.test.ts tests/package-tool-adapter.test.ts --maxWorkers=1
npx tsc --noEmit
npm test
npm run build
git diff --check
```
