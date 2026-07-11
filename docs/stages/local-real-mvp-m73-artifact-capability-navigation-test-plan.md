# Local Real MVP M73 产物能力导航与安静抽屉测试计划

更新时间：2026-07-11

## 1. 自动化定向测试

1. 纯函数：全部 `ArtifactKind` 映射到五个能力组之一；分组顺序稳定；空组不生成 rail 入口。
2. 纯函数：状态聚合优先级为 `blocked > needs_review/stale > in_progress > approved > not_started`，并正确计算总数与需处理数。
3. 组件合同：桌面 rail 只遍历能力组，不按 `visibleItems` 全量绘制圆点；加“全部产物”后入口上限为 6。
4. 交互合同：组内单产物调用阅读回调，多产物调用 grouped drawer 回调；全部入口打开完整 drawer。
5. 可访问性：每个能力组和全部入口具备 tooltip、aria-label、可读数量/状态。
6. drawer：标题为“备课成果”，不含“线性产物”；chips 可筛选能力组；有空项目态和筛选无结果态；列表不使用时间线连接线或状态圆点。
7. 预览与动作：预览只有“打开阅读”主动作；复制、作为输入、下载仍存在于侧边阅读或完整详情；`ArtifactRail` 无无效 `onRegenerate` 接口。
8. 返回机制：drawer 打开详情时记录来源并显示“返回备课成果”；返回关闭详情、恢复原 drawer 分组；侧边阅读打开详情不显示该返回入口；右上角关闭不自动重开 drawer。

## 2. 工程验证

依次执行并要求 exit code 0：

```text
npx vitest run tests/artifact-capability-groups.test.ts --maxWorkers=2
node --test tests/m73-artifact-capability-navigation.test.mjs
npx tsc --noEmit
npm test
npm run build
git diff --check
```

## 3. 浏览器验收

- 桌面：使用超过 6 个产物的项目，确认 rail 最多 6 个入口；逐一检查 tooltip、数量、聚合状态、单项直开、多项抽屉、全部抽屉和侧边阅读连续性。
- 390px：确认顶部“产物”入口打开“备课成果”抽屉；chips、列表、空态、无结果态可用，无横向溢出。
- 层叠：hover 预览出现后打开阅读或抽屉，预览必须关闭；阅读区和详情操作不拥挤，下载/复制/作为输入仍调用真实回调。
- 若认证环境阻止进入工作台，只记录登录阻塞与替代自动化证据，不声明浏览器通过。
