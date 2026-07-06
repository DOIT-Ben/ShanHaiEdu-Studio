# ShanHaiEdu Studio

山海智教：基于智能体驱动的小学课件自动化生产系统。

## 当前项目

`ShanHaiEdu-Studio` 是 ShanHaiEdu Studio 的线性 AI 备课媒体工作台，目标是让小学数学公开课教师从一句话需求开始，逐步获得需求规格、教材证据、教案、PPT 方案、导入视频方案和最终交付包。

## 本地目录

总目录：

```powershell
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio
```

当前 5 个 worktree：

```powershell
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\backend-workflow-lite
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\frontend-api-backed-workbench
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\agent-runtime-adapter
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\e2e-verification
```

## 核心文档

- `REQUIREMENTS_DECISION_V1.md`：V1 需求决策基线。
- `原始需求记录_V1.md`：用户原始需求记录。
- `AGENTS.md`：项目长期工程准则。
- `docs\mvp-to-production-agent-architecture.md`：MVP 到生产架构方案。

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
