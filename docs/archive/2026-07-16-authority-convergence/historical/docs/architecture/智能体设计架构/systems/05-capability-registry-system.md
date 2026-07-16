# 05 Capability Registry System 能力注册系统

## 1. 核心职责

为 Agent 提供“系统会做什么”的产品级目录。

## 2. 核心对象

```text
Capability
CapabilityDescriptor
InputRequirement
OutputArtifactType
RiskLevel
RuntimeKind
ContractBinding
AvailabilityStatus
```

## 3. 设计要点

- Capability 是产品能力，不是底层工具。
- 一个 Capability 可以调用多个 Tool / Provider。
- Capability 应声明风险等级、所需输入、输出类型、依赖契约。
- Agent 选择 capability，Workflow 决定何时运行，Runtime 负责执行。

## 4. 参考机制

- OpenCode tool registry。
- 插件系统 capability descriptor。
- 企业平台能力目录。

## 5. 适配问题

- 业务用户认为系统有哪些“能力”？
- 能力之间是否有依赖顺序？
- 哪些能力可用、不可用、需要配置、需要授权？
