# P0-05A Provider连续性运行手册

状态：首批离线readiness已通过clean CI；signer/v2 receipt离线实现已完成，真实campaign未授权

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

v1 manifest/receipt只验证手工JSON自洽，不能证明来源，P0-05A已明确拒绝。权威ledger服务必须自行从产品DB和只追加Provider ledger导出受保护环境、campaign nonce、server、run、全部facts/capture SHA、eventId和成本，并用独立ledger-authority key签发attestation；调用方不能自报这份事实。capture signer验证该attestation后才自行枚举campaign并生成确定性index，只对固定用途域下的精确字节执行第二个Ed25519签名；两类key ID和公钥摘要必须不同。调用者不得提交自制index，任何私钥不得进入仓库、命令参数、日志或receipt。v2 verifier重新验证两层签名、构建evidence，并绑定clean verification、policy/stage、授权channel/model/预算和精确`1..N` campaign；同一receipt内campaign nonce必须唯一，当前未宣称跨历史全局一次性消费。成功结果直接返回实际验签receipt字节SHA与subject。当前两个可信key列表均为空且受保护issuer未授权，所以仍不能生成真实`source-verified`证据或晋升receipt。

## 四场景

顺序固定为模糊讨论、单需求规格、需求规格加PPT结构候选、同一双Tool回合的Main Agent续轮。第四场景不得发送新教师消息，必须沿用第三场景的project/task、`teacherMessageId`和`turnJobId`，并绑定同一turn后续ordinal的真实`phase=post_tool`调用。harness只提交教师输入并观察产品事实，不选择Tool、不注入下一步、不重试Provider。

## 失败处理

任一5xx、timeout、失败attempt、服务重启、候选变化、范围外Tool、身份漂移或证据缺失都使campaign失败。先保存脱敏失败事实，再停止自有进程；修复产生新候选后连续计数从0开始。禁止删除失败attempt、挑选成功组、手改JSON或重封装旧run。
