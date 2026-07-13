# V1 非线性卡点登记册

> 2026-07-13主线说明：本文中“继续另外两套真实PPT/视频/ZIP”属于旧Stage 6口径，不再是当前恢复动作。V1-1至V1-8只做确定性编排、隔离和恢复验证；真实Provider整包统一延后到V1-9，由产品Main Agent独立生成一次，外部Codex只在成包后黑盒审核。

日期：2026-07-12

状态：`historical evidence / superseded for execution`

用途：按 V1 主计划允许独立阶段并行推进；本文件不改变任何 HumanGate、Quality Gate 或最终交付资格。

## B-01 MiniMax PPT 资产适配

- 状态：`closed for first real course / 2026-07-12`
- 关闭证据：真实 12 页可编辑 PPTX、12 页 PDF、真实资产、集成审查和页级修复均已完成，文件与哈希记录在 Stage 3C closeout。
- 当前边界：该首套课程只证明PPT生产工艺；旧“再做低年级和中年级两套真实交付”动作已经取消，由V1-9一次产品内真实E2E取代。

## B-02 Full Intro 视频参考资产

- 状态：`closed for first real course / 2026-07-12`
- 关闭证据：MiniMax 视频域关键帧、Evolink 本地参考图上传、Grok I2V、`shot_03` 定向重生成、18.125 秒 Full Intro、ffprobe 和时间线审查均已完成，证据记录在 Stage 4 closeout。
- 当前边界：该课程只证明视频Provider与合成技术链；旧“另外两套真实MP4”动作已经取消，课程锚点负例与产品内编排先在V1-2至V1-8关闭。

## B-03 目标服务器发布恢复

- 事实：本地生产预检正确拒绝缺少生产反代、关闭公开注册和绝对生产数据库的配置。
- 已验证：本地数据库初始化、管理员准备、artifact storage 可写、构建、全量测试、恢复和浏览器只读门检。
- 未通过：目标服务器共享卷重启、release 回滚、备份恢复与公网注册关闭复核。
- 当前可推进：不依赖服务器权限且不调用真实媒体Provider的V1-2至V1-8编排、隔离和恢复任务。
- 回收条件：获得目标服务器操作窗口后，在真实发布环境执行 runbook 并保存脱敏结果。

### 2026-07-13 V1-10C 回收进展

- 已知事实：目标服务器宿主机Node 16.9与定制Node 20.13均低于Prisma 7.8的Node 20.19/22.12门槛；Docker 26.1与Compose 2.27可用，单容器单Node进程是当前可行运行时。
- 已完成：新增Node 22容器、FFmpeg/LibreOffice/Poppler/中文字体运行时、非root单实例Compose、release外bind mount和Linux curl Executor；本地Node 268/268、Vitest 842/842、TypeScript与14页构建通过。
- 失败点一：Docker直连Debian源约26KB/s，297MB系统依赖预计耗时数小时，主动停止。
- 失败点二：host network加服务器本地代理后297MB在2分52秒下载完成，但4个Debian包被代理返回502，`apt-get` exit 100。
- 影响范围：目标服务器尚未形成V1镜像或容器，V1-10C不能closeout；V1-9本地产品HumanGate、P0审计和非服务器任务不受影响。
- 保护证据：无残留build/apt进程、无半成品镜像、无staging容器、3210未监听；nginx校验、根站、3001和3010既有服务保持原状。
- 恢复入口：使用已测速通过的腾讯Debian镜像完成同一精确提交`aed4d55`的镜像构建；不得再重复官方直连或当前代理路径。


## B-04 中年级教材权威输入

- 状态：`partially closed / low-grade closed / middle-grade active`
- 低年级关闭证据：已从人民教育出版社官方数字教材获取一年级上册数字页 20～30；以 20～25 为核心完成《1～5 的认识》教材分析、12 页 PPTX/PDF、真实 Grok MP4 和最终 ZIP，记录在 Stage 6 低年级 closeout。
- 低年级边界：当前为 `simulated_integration_approval`，`teacher_signoff=false`。
- 中年级未通过：几何/测量课题的官方教材版本、册次、页码和主题图/例题证据尚未锁定，因此不能进入正式课件生产并冒充验收。
- 当前处置：中年级真实课程任务不再作为V1前段恢复动作；V1-9选定真实任务时再按教材证据门确定课题。
- 回收条件：仅当V1-9真实E2E或后续产品需求明确选择中年级课题时恢复教材证据调查，不单独生成一套外部编排PPT/视频/ZIP。
