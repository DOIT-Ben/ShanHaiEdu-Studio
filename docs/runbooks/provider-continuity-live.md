# P0-05A Provider连续性运行手册

状态：离线readiness已接线，真实campaign未授权

## 当前可执行

```powershell
npm run gate:provider:impact
npm run gate:provider:verify -- --mode development
npm run gate:provider:live -- --mode development --preflight-only
npm run gate:provider:seal -- --campaign-root .tmp/provider-continuity/campaigns/<campaignId>
```

当前活动阶段固定`liveCallsAuthorized=false`且`liveAuthorization=null`。因此`gate:provider:live`命令当前只用于证明授权前失败，必须在创建Provider客户端、启动服务或创建campaign目录前退出，实际Provider请求数为0。真实driver、受保护环境验证器和ledger绑定验证器尚未接线；`gate:provider:seal`在没有完整capture/evidence或可信签名来源时必须失败，不能生成passed receipt。

## 隔离合同

每个campaign只能使用一个全新目录：

```text
.tmp/provider-continuity/campaigns/<campaignId>/
  database/
  artifacts/
  capture/
  evidence/
  logs/
```

目录必须物理位于仓库内，拒绝绝对路径、`..`、已有目标、符号链接、junction和reparse逃逸。默认SQLite、默认Artifact root和用户真实数据不得进入campaign。

## 授权前置

真实运行需要用户另行确认并写入活动阶段合同：

- Provider channel；
- model fingerprint；
- 总费用上限和最大调用次数；
- 费用授权摘要与有效期；
- 受保护环境标识；
- 预绑定的可信capture key ID与公钥摘要。

缺任一项都必须在创建客户端前失败。阶段批准值与运行请求必须逐字段一致，且受保护环境和Provider ledger必须由权威验证器返回通过；仅翻转`liveCallsAuthorized`无效。真实模型名、凭据和私钥不得写入仓库、日志或receipt；仓库只保存批准的逻辑channel、非敏感模型/授权/ledger/公钥指纹和key ID。

## 证据升级边界

v1 manifest/receipt只验证手工JSON自洽，不能证明来源，P0-05A已明确拒绝。campaign builder只接受活动阶段预绑定公钥验证通过的v2 source index；该index必须枚举capture目录全部文件并绑定scenario facts与逐调用SHA，遗漏失败attempt、额外文件、签名或公钥摘要不符都会失败。builder最多输出`source-verified`，不能输出passed。后续v2 receipt还必须绑定clean verification manifest、policy/stage SHA、Provider ledger、批准的逻辑channel/model fingerprint、费用授权、campaign/server身份和全部attempt。当前`trustedCaptureKeyIds=[]`且没有受保护capture signer，所以本阶段工作树不能生成`source-verified`证据或晋升任何receipt。

## 四场景

顺序固定为模糊讨论、单需求规格、需求规格加PPT结构候选、同一双Tool回合的Main Agent续轮。第四场景不得发送新教师消息，必须沿用第三场景的project/task、`teacherMessageId`和`turnJobId`，并绑定同一turn后续ordinal的真实`phase=post_tool`调用。harness只提交教师输入并观察产品事实，不选择Tool、不注入下一步、不重试Provider。

## 失败处理

任一5xx、timeout、失败attempt、服务重启、候选变化、范围外Tool、身份漂移或证据缺失都使campaign失败。先保存脱敏失败事实，再停止自有进程；修复产生新候选后连续计数从0开始。禁止删除失败attempt、挑选成功组、手改JSON或重封装旧run。
