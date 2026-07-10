# M54-A0 前端聊天式工作台测试定义

日期：2026-07-08

状态：正式测试定义 / 部分覆盖 / 第一档收口前必须补齐浏览器验收。

上游规格：

- `docs/ui/frontend-workbench/local-real-mvp-m54a-frontend-workbench-roadmap.md`
- `docs/ui/frontend-workbench/local-real-mvp-m54a-frontend-workbench-deep-spec.md`
- `docs/ui/frontend-workbench/local-real-mvp-m54a-open-items.md`
- `docs/product/frontend-workbench-priority-requirements.md`

## 1. 目标

把用户给出的参考图和工作台体验要求转成可执行验收，防止 UI 开发偏成“泛泛美化”。

M54-A0 不要求一次完成所有视觉实现，但必须先锁住：

- 输入可靠。
- 回复后滚动到底。
- quick replies 只填输入框。
- generating 状态准确。
- 参考图诉求可被逐项验收。
- 未接能力不伪装完成。

## 2. 参考图验收矩阵

| 参考 | 验收场景 | 验收方式 |
| --- | --- | --- |
| R01 全部展开 | 桌面 1440px 下左栏、对话、右侧糖葫芦同时可见 | Playwright 截图和 locator |
| R02 左侧收起 | 点击左侧收起后主对话变宽，恢复入口可见 | Playwright |
| R03 头像菜单 | 点击左下角头像打开账号/设置/反馈菜单 | Playwright |
| R04 默认工作台 | 进入项目后不是空白或后台字段页 | Playwright 截图 |
| R05 模型与上传 | 输入框工具栏可打开模型和上传入口 | Playwright |
| R06 首次进入 | 首屏有品牌、欢迎语、高频任务入口 | Playwright |
| R07 反馈入口 | assistant 消息可点赞/点踩/反馈 | Playwright |
| R08 hover 操作 | assistant 消息 hover/focus 出现复制等低频操作 | Playwright |
| R09 回复生成 | 发送后出现 generating 状态，回复后消失 | Playwright |
| R10 快捷指令 | assistant 回复下出现 2-3 个 quick replies，点击只填输入框 | Node + Playwright |
| R11 精致等待态 | generating 不闪烁、不挤压布局 | Playwright 截图 |
| R12 自适应输入框 | 多行输入时 textarea 增高，到阈值后内部滚动 | Node pure test + Playwright |
| R13 拖拽附件 | 文件拖入输入区出现覆盖态，松手后附件卡 | Playwright |

## 3. 第一批自动化测试

### 3.1 Node 合同测试

新增：

```text
tests/m54a-frontend-workbench-contract.test.ts
```

断言：

- `getTextareaHeightPlan` 根据文本行数返回 min/max/overflow 状态。
- `normalizeQuickReplies` 保留后端返回的可用建议并把推荐项排在前面；UI 展示层按布局选择首批 2-3 条，不在 normalize 层静默丢弃其余建议。
- `applyQuickReplyToDraft` 只返回输入框草稿，不自动发送。
- `normalizeAttachmentStatus` 不把 pending/failed 附件显示为已理解。
- `getGeneratingLabel` 区分 `generating`、`streaming`、`saving_artifact`。

### 3.2 浏览器验收

新增或扩展 Playwright 场景：

```text
tests/e2e/m54a-frontend-workbench.spec.ts
```

第一批浏览器断言：

- Enter 发送，Shift+Enter 换行。
- 发送后输入框清空。
- assistant 回复后滚动到底部。
- quick reply 点击后输入框获得焦点且填入文案。
- 普通聊天不出现产物卡或需求确认卡。
- 明确需求出现确认卡，未确认不生成产物。

## 4. 红线扫描

浏览器页面文本不得出现：

```text
schema
provider
node_id
debug
storage
local path
Markdown key
上游来源
```

例外：

- 测试代码、开发文档、服务端日志不属于教师可见界面。

## 5. 阶段验收命令

基础：

```text
npx vitest run tests/m54a-frontend-workbench-contract.test.ts --maxWorkers=1
npm test
npm run build
git diff --check
```

浏览器：

```text
npm run test:e2e -- tests/e2e/m54a-frontend-workbench.spec.ts --project=chromium-desktop
```

如果浏览器测试暂未落地，必须提供手工 Playwright 截图和 DOM 检查记录。

## 6. 通过门

- 合同测试通过。
- 关键浏览器路径通过或有明确未完成原因。
- UI 未显示工程词。
- 未接真实附件解析时，附件状态不伪装成已理解。
- 未接真实 streaming 时，不显示“正在流式输出 token”。
