# ShanHaiEdu V1 交付质量与邀请制上线测试计划

更新时间：2026-07-12

状态：`Accepted / Active`

关联计划：`docs\stages\local-real-v1-quality-release-mainline-plan.md`

## 1. 测试原则

- 自动化绿色只证明其覆盖范围，不等于 V1 上线通过。
- mock、deterministic draft、文件名、目标页数、数据库成功状态和生成者自评不能替代真实实物。
- 每项验收必须绑定权威证据：代码行为用测试和运行日志，页面行为用真实浏览器，交付质量用真实文件与 render，外部能力用脱敏真实请求，课堂可用性用教师签收。
- 任一硬门失败，产物不得进入 `final_eligible` 或最终包。

## 2. Stage 0R 测试

| 编号 | 验收 | 方法 | 通过标准 |
|---|---|---|---|
| 0R-01 | Git/文档基线 | 核对 HEAD、tag、ahead/behind、工作树和权威入口 | 三层基线记录一致；`v1` 未移动 |
| 0R-02 | 工程基线 | `npm test`、`npm run build`、`git diff --check` | 全部 exit 0，失败数 0 |
| 0R-03 | 视频脚本按需路径 | 真实浏览器输入“只做视频脚本” | 不进入无解确认循环；可执行时直达，缺硬前置时只说明最小缺口并给出可执行下一步 |
| 0R-04 | owner Select | 真实项目 owner 在桌面和 390px 打开成员权限 Select，键盘选择并保存 | 展开、焦点、选择、保存、刷新恢复和窄屏边界均通过 |
| 0R-05 | Provider/工具能力 | 对 PPT、图片、视频、OpenAI-compatible、渲染器、FFmpeg、存储逐项探测 | 记录真实可用、不可用、字段、成本/时长边界；不泄露凭据 |
| 0R-06 | 旧流程效果基线 | 选一个固定教师任务运行当前真实金路径 | 保存真实产物、耗时、成本、错误和质量评分，作为后续对照 |

## 3. 执行安全测试

| 编号 | 场景 | 必须证明 |
|---|---|---|
| 1A-01 | 缺 actor/停用 actor/会话撤销后的后台任务 | 所有写入 fail-closed，历史读取按权限处理 |
| 1A-02 | 两个独立 worker 竞争同项目 | 仅一个获得有效 lease；另一个稳定拒绝或排队 |
| 1A-03 | 两个项目并发 | 不被全局锁串行化，状态互不污染 |
| 1A-04 | lease 过期后旧 worker 返回 | 旧 fencing token 不能提交，结果 quarantined |
| 1B-01 | 同 idempotencyKey + 同 inputHash | 复用原 Job/Provider task，不产生第二次付费提交 |
| 1B-02 | 同 idempotencyKey + 不同 inputHash | 返回冲突并要求新意图标识 |
| 1B-03 | submit 后进程退出 | 已保存 taskId 时恢复 poll/download，不重提 |
| 1B-04 | Provider 接受但 taskId 落库未知 | 标记 submission_unknown，暂停自动重试并可人工对账 |
| 1B-05 | 教师在执行中修改大纲 | IntentEpoch 递增；旧结果不可提升为当前版本 |
| 1C-01 | 文件写成功、数据库提交失败 | 文件保持 staging/orphan，可恢复对账，不显示成功 |
| 1C-02 | Artifact 成功、Job finish 失败 | 恢复后只能完成一次原子提升，不产生双版本 |
| 1C-03 | PPT/图片/视频三个入口 | 全部经过相同租约、输入快照、校验和 fenced commit |

SQLite 并发测试至少使用两个独立 Prisma client 或独立 worker；单进程 Promise 竞争不能单独证明跨实例安全。

## 4. 合同、ReAct 与自然语言控制测试

| 编号 | 场景 | 通过标准 |
|---|---|---|
| 2-01 | 缺字段、错版本、错血缘、preview 输入 | pre-contract 稳定拒绝并返回类型化 locator |
| 2-02 | Tool 产出结构错误或真实文件不符 | post-contract 失败，不创建当前有效 Artifact |
| 2-03 | Critic 高分但 Validator 失败 | QualityDecision 必须失败，不能被模型覆盖 |
| 2-04 | 样张阶段修改叙事大纲 | 影响分析只失效受影响下游，Main Agent Replan |
| 2-05 | PageSpec、镜头或时间线局部修改 | 只返修目标 unit 和必要关联 unit，不整链重跑 |
| 2-06 | 暂停、取消、改道和恢复 | 状态可持久恢复；旧 ActionOffer 失效；历史仍可审计 |
| 2-07 | 达到步骤/费用/重试/时间预算 | 自动暂停并给教师明确选择，不无限循环 |
| 2-08 | 新任务默认生成强度 | RQ-027实施后默认选择“标准”，内部调用为 Terra Medium；当前Terra High事实在迁移closeout前不得伪装成已切换 |
| 2-09 | 复杂任务持续未解决 | 服务端根据同一质量定位连续失败、重试预算或约束冲突提出一次升级建议，不静默升级 |
| 2-10 | 用户确认或拒绝升级 | 确认后仅后续调用升级并记录actionId；拒绝后保持当前档且不循环打扰 |
| 2-11 | 极致档保护 | Sol High不能作为第一次自动建议；进入前明确提示更高积分消耗并要求独立确认 |
| 2-12 | 两用户强度隔离 | 两个账号的档位、建议、确认和后续调用映射互不污染 |

生成强度前端验收：四个稳定停靠点；默认“标准”；拖动时提示“强度越高，消耗的积分越快”；桌面与390px支持鼠标、触摸、键盘和辅助技术；任何教师可见位置不得暴露模型ID或Provider名称。

## 5. PPT Quality 测试

| 类别 | 必测证据 |
|---|---|
| 教材与叙事 | 教材主张 sourceRef；目标、活动和页面节奏一致；无越界知识 |
| 逐页设计 | 每页独立 PageSpec；不存在范围合并页；高风险页有样张 |
| 视觉与资产 | 视觉系统一致；批准资产按 assetId 实际嵌入；文字与数学信息可编辑 |
| 实物 | 至少一套真实 12 页 PPTX；ZIP 结构、presentation.xml、真实 slideCount 通过 |
| 渲染 | PPTX、PDF、逐页 PNG、contact sheet 页数一致；无溢出、遮挡、断字和不可读投影文字 |
| 返修 | 指定 pageId/assetId 返修后，未受影响页 hash/版本保持不变 |
| 兼容性 | 冻结一个主验收渲染器，并在第二环境抽检关键页 |

## 6. 视频 Full Intro 测试

| 类别 | 必测证据 |
|---|---|
| 创意与课程 | 独立创意成立；课程锚点真实回接；不提前泄露答案 |
| 分镜 | ShotSpec 包含时长、画面、动作、镜头、旁白/字幕、资产和连续性要求 |
| 资产实传 | required/recommended/none 策略正确；required 镜头能证明 assetId/hash 真正进入 Provider 请求 |
| Job 恢复 | 每镜头 taskId 可恢复；失败镜头不导致已通过镜头重提 |
| 后期 | 画面、音轨、字幕、overlay 可独立返修；音量、编码和分辨率归一 |
| 成片 | FFmpeg 真实合成；ffprobe 与 TimelineManifest 的时长、顺序、codec/fps/音轨一致 |
| 安全 | 儿童安全、隐私、版权、品牌、字幕事实和课堂适龄硬门通过 |

## 7. 最终包与真实上线测试

| 编号 | 验收 | 通过标准 |
|---|---|---|
| 5-01 | ClassroomRunSpec | 视频结束、PPT 页、教师动作、互动和答案揭示顺序一致 |
| 5-02 | FinalDeliveryGate preflight | stale、preview、degraded、缺失、错版本或未批准来源全部拒绝 |
| 5-03 | 打包期间来源变化 | postvalidate 返回输入变化错误，不发布旧包 |
| 5-04 | ZIP 真实性 | ZIP、manifest、hash、数据库记录和真实目录逐项一致 |
| 6-01 | 三个固定教师任务 | 三套真实 PPTX/图片/MP4/最终包完成；至少一套 12 页；P0=0 |
| 6-02 | 故障注入 | 进程退出、迟到回写、Provider 失败、断网、重复点击和跨标签页可恢复且不重复计费 |
| 6-03 | 目标服务器 | 共享卷重启、release 回滚、备份恢复和公开注册关闭复核通过 |
| 6-04 | 教师演练 | 至少一名真实教师完成首次任务、局部返修和下载并签收可授课 |

## 8. 阶段完成记录

每个阶段 closeout 必须记录：实际 SHA、变更范围、测试命令与计数、浏览器/实物/API 证据、未验证项、回退点和下一阶段门。没有证据的项目保持 pending，不能因计划存在或自动化通过而写成 done。
