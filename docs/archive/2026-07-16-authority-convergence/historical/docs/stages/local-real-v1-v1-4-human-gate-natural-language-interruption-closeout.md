# ShanHaiEdu V1-4 HumanGate与自然语言打断收尾

更新时间：2026-07-13

状态：`done / local commit pending`

## 1. 结论

V1-4已经闭环按钮与自然语言共用的HumanGate控制合同。教师可以确认、暂停、恢复、取消、改道、修改上游内容或请求明确页级返修；隐藏actionId不再覆盖教师已经修改的真实文本，旧分支迟到结果和历史失败不会进入当前IntentEpoch的活动WorldState。

## 2. 完成内容

- 控制优先级改为先识别暂停、取消、修订和改道，再处理actionId确认。
- pending plan新增`paused`与`canceled`生命周期状态。
- 暂停创建`teacher_requested_pause` RunCheckpoint，不推进IntentEpoch。
- 恢复保留原始teacherRequest，废止旧action并签发新action。
- 取消、改道和修订推进IntentEpoch；旧action重放不能执行Tool。
- 高成本或Provider动作下模糊“继续”只回显待确认范围，不授权执行。
- 多个活动计划下模糊继续只提出一个具体消歧问题。
- 控制动作持久化结构化ImpactReport与稳定digest。
- 明确PPT页修改复用`analyzePptRevisionImpact()`，只失效目标页证据并保留未受影响Artifact。
- IntentEpoch改变后旧Observation仍留在历史消息，但不进入当前Main Agent WorldState。
- Queue路径验证编辑quick reply文本时旧action零授权。

## 3. 验证证据

| 门禁 | 结果 |
|---|---|
| V1-4专项 | 7个测试文件，96/96通过 |
| 核心复验 | 3个测试文件，69/69通过 |
| TypeScript | exit 0 |
| Node全量 | 259/259通过 |
| Vitest全量 | exit 0 |
| 生产构建 | exit 0，生成13个静态页面 |
| SQLite | `.tmp\v1-4-init.db`同库连续初始化2/2 |
| 差异检查 | `git diff --check` exit 0 |

构建仍保留3条基线已有的动态文件模式过宽警告。本阶段没有调用真实媒体Provider，也没有生成新真实交付包。

## 4. 边界

- 通用层只在有可信结构化PPT设计包和明确页号时给出精确页级影响；证据不足时请求补充，不伪造局部返修结论。
- 视频镜头、字幕、音轨和时间线影响分析仍属于V1-7领域闭环。
- V1-4证明控制与失效语义，不等于PPT/视频真实生产闭环。
- 四档强度、积分趋势、升级建议和Sol二次确认属于V1-5。

## 5. 下一阶段

进入V1-5生成强度：实现四档教师可见强度、默认标准档、复杂任务升级建议、用户确认后升级、积分消耗趋势和最高档独立提醒；不向教师暴露模型名称，不允许模型静默升级。

保持`v1`、`v1.1.0-alpha`和`v1.1.0-alpha.1`不动；本阶段只做独立本地提交，不push、不部署。
