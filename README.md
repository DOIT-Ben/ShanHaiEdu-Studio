# ShanHaiEdu Studio

山海智教是由产品 Main Agent 自主编排的教师备课与多媒体交付工作台。教师可以用自然语言提出完整任务或局部任务，系统在授权、预算、质量和副作用边界内生成教案、PPT、课堂视觉、独立创意导入短片和版本一致的材料包。

## 当前入口

当前唯一工程 checkout：

```powershell
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main
```

开始工作前按顺序读取：

1. `AGENTS.md`
2. `docs\README.md`
3. `docs\product\current-requirements-baseline.md`
4. `docs\product\requirements-backlog.md`
5. `docs\mainlines\current-mainline-status.md`
6. `docs\architecture\README.md`
7. `docs\architecture\V1.0 重构设计.md`
8. `docs\stages\README.md`
9. `docs\stages\README.md`；只有存在活动阶段时再读取对应plan/test-plan

当前状态：**REMEDIATION VERIFIED / CONTRACT GO / PRODUCT E2E PARTIAL / RELEASE NOT STARTED**。整改前基线为`b4ad3849f6ae0953f3dfe856ce000e0def292023`；8项P1、7项P2及五阶段本地整改门已通过，完成计划已归档。R5整体仍未关闭，连续多轮Provider稳定性、V1-9、教师签收和发布均未完成；本轮未运行390px，未调用图片、视频、PPTX、ZIP或整包Provider，也未把离线fixture上推为真实产品链路。

## 文档分区

```text
docs/product/       当前需求基线与未完成总账
docs/mainlines/     当前事实、阻塞与下一动作
docs/architecture/  当前架构入口与已接受ADR
docs/stages/        唯一活动阶段
docs/contracts/     当前生效合同
docs/ui/            当前前端与证据入口
docs/roadmap/       已接受但尚未启动的未来工作
docs/archive/       历史原文与迁移证据，默认不参与执行
```

## 本地验证

```powershell
npm install
npm run dev
npx tsc --noEmit
npm test
npm run build
```

测试必须按当前阶段文档限制worker和外部调用。没有明确阶段授权时，不调用真实媒体或整包Provider。

## 安全边界

密钥、私有API台账、SQLite、用户上传、Artifact和真实运行证据不属于文档治理范围。未经要求不commit、不push、不部署、不移动历史标签。
