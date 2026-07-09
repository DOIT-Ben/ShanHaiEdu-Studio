# 01 Workbench UX System 工作台体验系统

## 1. 核心职责

把 Agent 的复杂工作流翻译成业务用户能理解和操作的工作台。

## 2. 核心对象

```text
Project Sidebar
Conversation Thread
Node Progress Rail
Artifact Viewer
Evidence Drawer
Pending Action Panel
Download / Delivery Area
Admin Entry
```

## 3. 设计要点

- 以 Project 为中心，而不是以 chat 为中心。
- 主对话负责协作，节点栏负责状态，产物区负责阅读和下载。
- 用户可见文案必须业务化，避免 provider、schema、token、local path 等工程词。
- 待确认动作必须明确、可追踪、可撤销。

## 4. 参考机制

- Linear 的低噪声状态表达。
- Notion 的对象化页面和侧栏。
- OpenCode 的对话 + 工具上下文分离。

## 5. 适配问题

- 你的业务项目对象是什么？
- 用户最关心的节点状态有哪些？
- 产物是文档、表格、图片、视频、代码，还是组合包？
