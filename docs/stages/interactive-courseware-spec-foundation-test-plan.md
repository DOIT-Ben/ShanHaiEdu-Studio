# 互动课件规格基础切片测试计划

## 合同测试

1. 五类活动的最小有效规格通过。
2. 页面、活动和选项 ID 重复时失败并返回 locator。
3. 单选、多选、判断、填空和拖拽配对缺少可判定答案时失败。
4. 缺少教学目标映射、时长或结束条件时失败。
5. 有效规格保存为 `interactive_courseware_spec` Artifact；校验失败不写入 Artifact。

## 回归

- 运行新模块定向 Vitest，单 worker。
- 运行受影响 Workbench 服务测试，单 worker。
- 运行 TypeScript 与 `git diff --check`。

## 不在本阶段验证

不调用外部 Provider，不写入真实学生数据，不启动实时课堂会话。
