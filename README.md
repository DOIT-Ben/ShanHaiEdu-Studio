# ShanHaiEdu Studio

山海智教：基于智能体驱动的小学课件自动化生产系统。

## 当前项目

`ShanHaiEdu-Studio` 是由 Main Agent 自主编排的非固定 DAG 备课制作工作台。教师可以从一句话需求、已有材料或局部任务切入，系统在授权、费用、质量和副作用门禁内生成教案、PPT、导入视频及最终交付包。

## 本地目录

总目录：

```powershell
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio
```

当前活动 checkout：

```powershell
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main
```

历史并行主线已经合并或退场，不再以固定目录清单作为当前入口。需要核对本机有效 worktree 时运行：

```powershell
git worktree list
```

## 核心文档

- `AGENTS.md`：项目长期工程准则。
- `docs\README.md`：文档分类和权威入口。
- `docs\product\current-requirements-baseline.md`：当前需求与质量门禁最高口径。
- `docs\product\requirements-backlog.md`：已接受、延期和后续版本需求总账。
- `docs\mainlines\current-mainline-status.md`：当前主线状态和恢复入口。
- `docs\stages\README.md`：活动阶段、后续规划和历史阶段索引。
- `docs\private-api-ledger.md`：私有 API 台账位置、用途和安全边界。

历史原始需求和复盘材料继续保留在仓库根目录，仅作证据，不覆盖当前需求基线：

- `REQUIREMENTS_DECISION_V1.md`
- `原始需求记录_V1.md`
- `SHANHAIEDU_LEGACY_RETROSPECTIVE.md`

## 本地运行

```powershell
npm install
npm run dev
```

构建验证：

```powershell
npm run build
```

## 安全说明

私有 API 台账、密钥、provider 配置和本地凭据不得提交到仓库。仓库只保留可公开的代码、规划和脱敏文档。

本地 API 台账位于 `ShanHaiEdu-API-Ledger-Standalone-PRIVATE.zip`，用于查询各环节可用 API 和能力证据；使用前先读 `docs\private-api-ledger.md`。
