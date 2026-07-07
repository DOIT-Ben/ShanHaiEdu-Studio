# E2E Verification Stage 3 Blocker Report

日期：2026-07-07

## 1. 当前阶段

Stage 3：多节点文本链路。

目标是验证一个项目能从需求规格继续推进到教材证据、教案、PPT 大纲、导入视频方案、图片/分镜提示和最终交付清单，并在前端节点、详情、确认和刷新恢复中真实呈现。

## 2. 阻塞事实

`npm run test:e2e:stage3:preflight` 失败，结果：

- `runtime-stage3-tasks`：通过。`DeterministicRuntime` 已有 Stage 3 文本任务。
- `workflow-stage3-nodes`：通过。后端 workflow 默认节点已包含 Stage 3 所需节点。
- `frontend-multi-artifact-display`：通过。前端 API client 能归一化多 artifact snapshot。
- `runtime-workflow-key-mapping`：失败。缺少 `ppt_outline -> ppt_draft`、`final_delivery_checklist -> final_delivery` 等 server boundary 映射。
- `multi-node-progressor`：失败。消息 API 仍只生成 `requirement_spec`，没有根据已确认上游推进到教材证据、教案、PPT、视频或最终交付。

失败命令：

```powershell
npm run test:e2e:stage3:preflight
```

退出码：1。

## 3. 三轮阻塞审计

### Round 1：当前 E2E 分支

检查当前 `feature/mvp-e2e-verification`：

- Stage 2 单节点 deterministic 闭环已通过。
- `src\app\api\workbench\projects\[projectId]\messages\route.ts` 仍只运行 `task: "requirement_spec"`。
- 当前分支没有多节点 progressor 或任务到节点映射。

结论：阻塞存在。

### Round 2：远程 E2E 分支

执行 `git fetch origin` 后检查 `origin/feature/mvp-e2e-verification`：

- 远程分支与本地 Stage 2 推送点一致，为 `7a48dd7`。
- 没有新的远程 E2E 修复可合入。

结论：阻塞仍存在。

### Round 3：其他主线远程分支

检查：

- `origin/feature/mvp-agent-runtime-adapter`：已有 Stage 3 runtime tasks。
- `origin/feature/mvp-backend-workflow-lite`：已有 artifact versioning、stale propagation、approved inputs 等增强，但没有完成多节点生成 progressor，也没有解决 runtime task key 与 workflow node key 的映射合同。

结论：没有可直接合入并解除 Stage 3 preflight 的完成态；E2E 主线不能越界实现业务工作流推进。

## 4. 为什么不能绕过

- 用 Stage 2 的 `requirement_spec` 单节点重复点击，不能证明多节点链路。
- 直接在 E2E 测试里造多个 artifact，会把 mock/deterministic fixture 伪装成真实工作流。
- 在 E2E 主线内重写业务 progressor 会越过职责边界；该能力应由 Backend Workflow Lite / Agent Runtime Adapter 明确提供合同。

## 5. 需要其他主线提供的接口能力

Backend Workflow Lite / Agent Runtime Adapter 需要提供至少一种稳定合同：

1. `POST /api/workbench/projects/:projectId/messages` 能根据已确认节点自动推进下一节点；或
2. 新增明确的 workflow action，例如 `POST /api/workbench/projects/:projectId/nodes/:nodeKey/generate`；并
3. 明确 runtime task 与 workflow node 的映射：
   - `ppt_outline` 产物保存到 `ppt_draft` 或统一重命名。
   - `final_delivery_checklist` 产物保存到 `final_delivery` 或统一重命名。
   - `image_prompts` / `video_storyboard` 若不由 runtime 直接生成，应定义降级或跳过规则。

## 6. 阶段结论

Stage 3 当前为真实外部阻塞，不可通过。

本报告不是 Stage 3 通过证明；它是阻塞审计记录。解除阻塞后，应重新运行：

```powershell
npm run test:e2e:stage3:preflight
```

preflight 通过后再开发并运行 browser E2E。
