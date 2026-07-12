# V1 Stage 1C：生成结果原子提升与隔离测试计划

更新时间：2026-07-12
状态：verified；结果见 `local-real-v1-stage1c-atomic-promotion-closeout.md`

## 1. 测试原则

- 使用真实 SQLite 事务，不以 mock repository 证明原子性。
- 并发与 fence 测试使用两个独立 Prisma client。
- 故障注入使用 SQLite trigger 或明确的事务失败，不在生产代码加入测试开关。
- Provider 适配器可注入已验证结果，测试重点是结果提交边界；真实 Provider 能力沿用 Stage 0R 证据。

## 2. 权威用例

| ID | 场景 | 必须证明 |
|---|---|---|
| 1C-01 | 文件已写、staging 后原子提升失败 | slot 保持 `staged`；Artifact 数量不变；Node 未推进；Job 不显示 succeeded；storage refs 可对账 |
| 1C-02 | Artifact 创建后 Job 更新被数据库拒绝 | 整个事务回滚；移除故障后重试只创建一个 Artifact，版本只增加一次，Job/Node/slot 一致 |
| 1C-03 | PPTX、图片、视频三个入口 | 三条路由都调用统一 stage/promote 合同，不再直接 `saveArtifact + finishGenerationJob` |

## 3. 扩展安全用例

| ID | 场景 | 预期 |
|---|---|---|
| 1C-04 | Project intent epoch 在 Provider 执行期间递增 | slot 与 Job quarantined；Artifact 不创建；Node 不推进 |
| 1C-05 | 旧 worker stage 后新 fence 接管 | 旧 worker promote 被隔离；只有完全相同且仍有效的执行身份可由当前 fence 恢复，其他身份不得继承 |
| 1C-06 | 同一 Job 重复 promote | 两次返回同一 Artifact；Artifact 数量和版本不增加 |
| 1C-07 | 已 committed Job 再次进入路由 | 直接复用 result Artifact；Provider 不再次调用 |
| 1C-08 | 旧数据库执行升级脚本 | 新表、列、唯一索引存在；旧 Project/Artifact/GenerationJob 数据保持 |
| 1C-09 | staging 尚无结果 | 不允许 promote，不显示成功 |
| 1C-10 | staging structured content 含多个 storage ref | `storageRefsJson` 去重、只保存安全的相对 logical path |

## 4. 路由与对话回归

至少覆盖：

1. `coze-ppt` 路由返回 `{ artifact, job }` 且二者 ID 一致。
2. `image` 路由同上。
3. `video` 路由保留 providerTaskId 的 submit/poll 恢复行为。
4. 对话内 Provider 工具成功后通过统一 commit 返回 Artifact。
5. Provider 未通过验证时不创建 staging result 和 Artifact，Job 进入 failed/submission_unknown 既有状态。

## 5. 验证命令

```powershell
npx vitest run tests/generation-result-promotion.test.ts
npm test
npm run build
git diff --check
```

完成声明必须记录实际通过数量、构建 exit code 和未执行的真实外部 Provider 场景。禁止使用 Graphify 作为证据。
