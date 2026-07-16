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
4. `docs\mainlines\current-mainline-status.md`
5. `docs\stages\README.md`

当前状态：R5历史验收保留；V1-9尚未启动，先关闭主线状态中列出的4个Runner/installed-tree完整性缺口。V1发布前不新增390px真实黑盒，不重跑R5，也不以离线fixture冒充真实产品链路。

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
