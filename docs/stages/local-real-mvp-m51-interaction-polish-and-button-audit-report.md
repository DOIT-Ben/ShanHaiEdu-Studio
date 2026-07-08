# M51 对话产物展开与前端交互审计验收报告

日期：2026-07-08

## 结论

M51 已完成本轮用户截图反馈的前端交互收口：对话内产物卡可展开，AI 头像使用生成 logo，左侧课题搜索可聚焦输入，右侧产物侧栏拖拽不再带 width 动画，侧栏打开后顶部栏和阶段条进入紧凑态，明显未接能力不再表现成可点击假按钮。

本阶段不改变后端产物合同，不新增真实 provider，不宣称生产部署完成。

## 完成内容

- `ProjectSidebar`：把“搜索课题”改为真实 input，支持按项目标题、当前步骤和 meta 本地筛选；无结果显示低噪声空态。
- `ChatTranscript`：对话内生成产物卡增加展开/收起，展开后显示更多字段、正文片段和上游来源。
- `public/brand/`：新增 ShanHaiEdu AI logo 原图和 256px 前端使用图。
- `ArtifactSidePanel` / `ResizableHandle`：侧栏默认宽度降到 360px，最大宽度 460px；移除 width transition，拖拽柄提升到侧栏容器层并扩大命中区。
- `ConversationWorkbench` / `WorkbenchTopbar` / `StageProgress`：侧栏打开时启用 compact，顶部栏与阶段条收缩，避免挤压遮挡。
- 假按钮审计：回收站、协作、输入区重新生成、详情页查看全部改为禁用或非按钮状态；顶部保存状态从按钮改为状态展示。
- `ArtifactDetailSheet`：无交互的详情分区标签改为文本，避免伪装成可切换 tab。

## 验收记录

| 项目 | 结果 |
| --- | --- |
| `node --test tests/m51-interaction-polish-and-button-audit.test.mjs tests/m50-artifact-rail-markdown-preview.test.mjs tests/m49-chat-scroll-and-delight.test.mjs` | 通过；12/12 pass |
| `npm test` | 通过；Node TAP 117/117 pass；Vitest 25 files / 100 tests pass |
| `npm run build` | 通过；Next.js 编译、TypeScript、静态页面生成通过 |
| `git diff --check` | 通过；仅 Windows 行尾提示，无空白错误 |
| Playwright 浏览器验收 | 通过；桌面与移动关键交互 pass |

## 浏览器验收 JSON 摘要

```json
{
  "pass": true,
  "searchWorked": true,
  "recycleDisabled": true,
  "collabDisabled": true,
  "regenDisabled": true,
  "savedButtonCount": 0,
  "logoLoaded": true,
  "expandedHasContent": true,
  "compactState": {
    "topbar": "true",
    "stage": "true",
    "topbarFits": true,
    "stageFits": true
  },
  "handleHit": {
    "tag": "BUTTON",
    "aria": "调整产物预览宽度"
  },
  "draggingTransitionDisabled": true,
  "widthBefore": 360,
  "widthAfter": 452,
  "widthChanged": true,
  "mobileOverflow": false,
  "hasDrawer": true
}
```

## 截图证据

- `.tmp/m51-desktop-inline-expanded.png`
- `.tmp/m51-desktop-sidepanel-compact.png`
- `.tmp/m51-mobile-inline-drawer.png`

## 边界与后续

- 搜索课题是前端本地筛选，不新增后端搜索 API。
- logo 是阶段生成资产，可在正式品牌规范确定后替换同路径文件。
- M51 只处理前端交互和可用性审计，不推进真实部署。
- 后续进入“自动化跑完整交付”主线时，应继续用真实浏览器验证一命令交付和最终材料包下载。
