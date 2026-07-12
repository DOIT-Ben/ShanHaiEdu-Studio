# V1 非线性卡点登记册

日期：2026-07-12

状态：active

用途：按 V1 主计划允许独立阶段并行推进；本文件不改变任何 HumanGate、Quality Gate 或最终交付资格。

## B-01 MiniMax PPT 资产适配

- 状态：`closed for first real course / 2026-07-12`
- 关闭证据：真实 12 页可编辑 PPTX、12 页 PDF、真实资产、集成审查和页级修复均已完成，文件与哈希记录在 Stage 3C closeout。
- 边界：这里只关闭首套高年级百分数课程的技术与集成卡点；低年级和中年级两套真实交付仍属于 Stage 6 未完成工作。

## B-02 Full Intro 视频参考资产

- 状态：`closed for first real course / 2026-07-12`
- 关闭证据：MiniMax 视频域关键帧、Evolink 本地参考图上传、Grok I2V、`shot_03` 定向重生成、18.125 秒 Full Intro、ffprobe 和时间线审查均已完成，证据记录在 Stage 4 closeout。
- 边界：这里只关闭首套高年级百分数课程；另外两套课程仍需分别生成和验收真实 MP4。

## B-03 目标服务器发布恢复

- 事实：本地生产预检正确拒绝缺少生产反代、关闭公开注册和绝对生产数据库的配置。
- 已验证：本地数据库初始化、管理员准备、artifact storage 可写、构建、全量测试、恢复和浏览器只读门检。
- 未通过：目标服务器共享卷重启、release 回滚、备份恢复与公网注册关闭复核。
- 继续推进：不依赖服务器权限的真实 Provider、PPT、视频和最终包任务。
- 回收条件：获得目标服务器操作窗口后，在真实发布环境执行 runbook 并保存脱敏结果。

## B-04 中年级教材权威输入

- 状态：`partially closed / low-grade closed / middle-grade active`
- 低年级关闭证据：已从人民教育出版社官方数字教材获取一年级上册数字页 20～30；以 20～25 为核心完成《1～5 的认识》教材分析、12 页 PPTX/PDF、真实 Grok MP4 和最终 ZIP，记录在 Stage 6 低年级 closeout。
- 低年级边界：当前为 `simulated_integration_approval`，`teacher_signoff=false`。
- 中年级未通过：几何/测量课题的官方教材版本、册次、页码和主题图/例题证据尚未锁定，因此不能进入正式课件生产并冒充验收。
- 继续推进：优先从人民教育出版社官方数字教材定位三/四年级几何或测量课题；若某一课题官方证据受阻，记录并切换到同年段另一几何/测量课题。
- 回收条件：中年级官方教材证据、12 页 PPTX/PDF、真实 MP4 和版本一致 ZIP 均通过集成审查。
