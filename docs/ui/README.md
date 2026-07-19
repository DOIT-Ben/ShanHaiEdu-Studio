# ShanHaiEdu 当前UI入口

更新时间：2026-07-16

当前教师工作台以 `assistant-ui` 为唯一目标对话Runtime，项目自有 `MessagePart` 和 `AgentEventEnvelope` 是消息与事件合同。前端只展示服务端事实，不取得Tool编排、Artifact、HumanGate或Quality Gate控制权。

## 当前入口

- `frontend-workbench\README.md`：当前工作台边界与验证入口。
- `frontend-workbench\assets\references\README.md`：脱敏视觉参考与浏览器证据规则。
- `..\architecture\README.md`：当前消息、assistant-ui和Main Agent控制面边界。

## 固定体验边界

- 三栏工作台：左侧项目，中间对话，右侧按需成果阅读；中间对话是主视觉。
- 安静、纯白、工作导向，不做营销Hero、卡片套卡片、无意义渐变或炫技动效。
- 文本、活动、计划、Tool状态、Artifact、HumanGate和错误均由类型化Part渲染。
- 教师界面不得出现schema、provider、node_id、storage、debug、local path、token或内部推理。
- V1发布前真实浏览器只验桌面视口；不新增390px黑盒，除非用户明确要求。

已接受但未进入当前阶段的Demo设计吸收位于 `..\roadmap\ui\README.md`。历史UI路线、规格和阶段报告位于archive，默认不读取。
