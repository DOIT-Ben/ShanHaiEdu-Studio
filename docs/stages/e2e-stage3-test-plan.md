# E2E Verification Stage 3 Test Plan

日期：2026-07-07

## 1. 测试目标

Stage 3 验证多节点文本链路。测试必须证明一个项目能从已确认需求规格继续生成并保存后续教学文本产物，而不是只证明需求规格节点可用。

## 2. 前置检测

命令：

```powershell
npm run test:e2e:stage3:preflight
```

通过标准：

- Runtime 暴露 Stage 3 所需任务：教材证据、教案、PPT 大纲、导入视频方案、最终交付清单。
- 后端 workflow 节点与 runtime task 存在明确映射。
- 消息 API 或工作流 API 能根据上游确认状态推进到下一节点。
- 前端 API client 能展示多个真实后端 artifact，而不是只展示 Stage 2 的 `requirement_spec`。
- Stage 3 不依赖真实 OpenAI key。

## 3. Browser E2E 用例

preflight 通过后执行：

| 用例 | 目的 | 通过标准 |
| --- | --- | --- |
| 需求规格后继续生成教材证据 | 验证第二节点推进 | `textbook_evidence` artifact 出现在右侧节点并可打开 |
| 继续生成教案 | 验证已确认上游进入下游 | 教案 artifact 保存，刷新后仍存在 |
| 继续生成 PPT 大纲 | 验证 runtime/workflow key 映射 | 前端显示教师可理解的 PPT 大纲节点，不暴露 `ppt_draft` |
| 继续生成导入视频方案 | 验证视频方案文本节点 | 方案详情包含课程锚点，不伪装成视频成片 |
| 最终交付清单 | 验证汇总节点 | 最终清单明确标记未真实生成的 PPTX/图片/视频文件能力 |
| 红线扫描 | 验证教师界面纯净 | 可见文本不命中工程词 |

## 4. 集中验收命令

preflight 通过后执行：

```powershell
npm run build
npm run test:e2e:stage3
```

如果 preflight 未通过：

```powershell
npm run test:e2e:stage3:preflight
```

并写入 `docs\stages\e2e-stage3-blocker-report.md`。

## 5. 阻塞归因规则

- 缺多节点推进 API：Backend Workflow Lite。
- Runtime task 与 workflow node key 不一致且无映射：Backend Workflow Lite / Agent Runtime Adapter。
- 前端无法展示多个真实 artifact：Frontend API-backed Workbench。
- 浏览器选择器、红线扫描或报告无法定位：E2E Verification。
- 真实 provider 未配置：不阻塞 Stage 3，Stage 3 只验 deterministic 多节点。
