# 02 Project & Actor System 项目与身份系统

## 1. 核心职责

定义“谁在什么项目里做什么”。所有记忆、产物、工具调用、审计日志都应绑定项目和 actor。

## 2. 核心对象

```text
Project
Workspace / Organization
Actor / User
Role
Permission
ProjectMembership
AuditSubject
```

## 3. 设计要点

- Project 是业务连续性的中心。
- Actor 是权限、确认、审计的中心。
- 组织级模板和用户级偏好不能混写。
- 项目归档不应删除审计和交付记录。

## 4. 参考机制

- SaaS workspace / project / member 模型。
- RBAC / ABAC 权限设计。
- 审计日志 actor-subject-action-resource 模型。

## 5. 适配问题

- 项目是否属于个人、团队还是组织？
- 哪些操作需要角色权限？
- 哪些确认必须记录到审计日志？
