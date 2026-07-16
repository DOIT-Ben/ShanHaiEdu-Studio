# 互动课件规格基础切片计划

## 目标

交付不依赖真实 Provider 的互动课件规格合同、校验器和项目内 Artifact 保存入口。

## 复用

- `Project`、项目授权和 Artifact 版本化。
- `SaveArtifactInput` 与 WorkbenchService 保存边界。
- 后续 Capability/ToolRouter/Quality Gate 接入方式，不复制 Runtime。

## 实施顺序

1. 定义活动与课件 TypeScript 合同及校验结果。
2. 先写合同测试：有效单选规格通过；重复 ID、不可判定答案和缺失目标映射失败。
3. 实现确定性校验器与统一 locator。
4. 扩展 Workbench Artifact 联合类型，新增受控保存方法；不开放通用客户端任意写入。
5. 运行定向测试、类型检查和现有 Workbench 回归。

## 风险

当前工作树中 Conversation Runtime 文件已有其他改动。本切片不修改这些文件、Prisma schema 或 Provider adapter；仅在独立 `activities` 模块和清洁的 Workbench 类型/服务边界落地。

## 回退

移除未注册的规格保存入口即可停止新写入；现有 Artifact 数据不删除。
