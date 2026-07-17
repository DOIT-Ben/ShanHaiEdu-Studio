# 项目开发质量门合同

状态：active
生效日期：2026-07-17

## 唯一入口

- `npm run gate:development`：阶段路径、政策单调性、源码合同、复杂度和Provider影响门。
- `npm run verify:local`：运行开发门、TypeScript、Lint、测试和构建，并生成绑定当前工作树的验证manifest。
- `npm run verify:ci`：与本地使用同一执行器，但要求工作树clean并绑定CI候选SHA。
- `npm run gate:release`：验证clean候选、新鲜验证manifest和真实Provider连续性receipt；缺一项即失败。

## 证据模型

Git只保存`config\development-gates.json`政策和`docs\stages\active-stage.json`阶段合同。验证manifest写入`.tmp\verification\`并由CI作为artifact保存；它不进入Git，因此不存在把包含自身SHA的文件提交到自身commit的循环。

Provider证据采用两文件模型：manifest描述候选、场景和期望，receipt绑定manifest SHA、候选SHA、源码bundle摘要和每个原始证据文件SHA。receipt不得包含凭据、完整URL、token或原始环境变量。

## 失败关闭

- 缺字段、未知schema、路径逃逸、符号链接、重复路径、哈希不符、证据外文件、过期证据或漏跑命令一律失败。
- 任何门不得用warning忽略、mock、fallback、fixture、历史run、人工勾选或硬编码成功替代当前事实。
- 普通CI没有Provider密钥时不得执行伪探针；它应等待受保护环境产生的receipt，release保持阻塞。

## 债务基线

源码字符串合同、超限文件、超限函数和Lint warning保存精确当前值。当前值小于政策时必须同步降低政策；大于政策或新增条目失败。政策相对阶段`baselineSha`也必须单调收紧，不能通过同一变更提高债务值获得绿灯。

## Provider连续性最低场景

同一隔离task依次验证：模糊讨论零Tool且IntentEpoch不变；单Tool需求规格恰好一次Tool和一个Artifact；双Tool需求规格加PPT结构候选仅调用允许的两个Tool；Main Agent续轮无重复、无扩张且终态可恢复。开发敏感变更至少连续3组，release至少5组；任一实际5xx或timeout即使重试后成功也判该组失败。

## 外部仓库设置

`.github\workflows\quality-gates.yml`只提供可执行job。仓库管理员必须在受保护分支把`quality-gates`设为required check，并让Provider receipt job只在受保护环境持有凭据；否则GitHub设置层仍可绕过仓内门禁。
