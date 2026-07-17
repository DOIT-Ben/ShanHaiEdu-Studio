# 项目开发门禁制度化计划

日期：2026-07-17
状态：implemented-with-provider-capture-awaiting-clean-ci

## 目标

把整改后仍停留在人工约定层的五项防复发机制，收敛为项目唯一、可执行、失败关闭的开发门禁：SHA绑定验证manifest、阶段路径门、源码字符串合同清理、巨型模块拆分约束和真实Provider连续性证据门。

## 已知事实

- contract/executor层的本轮缺陷已经纠正并通过既有验证。
- 连续多轮Provider、唯一V1-9、教师签收和release仍未闭环。
- 仓库存在既存源码字符串合同与超限生产模块，不能用一次大拆分冒充门禁建设，也不能删除测试或提高阈值制造通过。
- 当前没有统一CI质量门或与候选SHA绑定的新鲜验证manifest。

## 范围

1. 建立版本化门禁政策、唯一活动阶段机器合同和变更预算。
2. 建立路径、政策单调性、源码合同债务和复杂度债务检查。
3. 建立Provider敏感路径影响判断与manifest/receipt完整性验证；当前真实连续性状态保持open。
4. P0-05A入场审计若证明运行时权威事实不足，只允许建立一次性、固定路径、固定到期日且始终`passed=false`的capture bootstrap；它不得签发receipt或在release模式生效。
5. 建立本地、CI和release唯一入口，生成不提交Git的SHA绑定验证manifest。
6. 更新项目准则、架构ADR、当前状态和测试。

capture bootstrap本身不修改生产业务逻辑；后续仅可在机器合同列出的六个生产文件和四个行为测试文件内增加脱敏调用事实采集。不得拆分无关巨型模块，不调用真实图片、视频、PPTX、ZIP或整包Provider，不创建V1-9 run，不push或部署。

初始新增行预算为4200。首次精确报告确认需要登记26个源码合同债务文件、31个复杂度债务文件，并覆盖Provider证据篡改失败路径；在未增加生产范围、文件数上限或允许路径的前提下，新增行预算一次性修订为5400，修订原因保存在机器合同中。

用户随后授权规划唯一下一阶段。当前阶段只增加P0-05A的roadmap候选spec、plan、test-plan及权威索引，不切换活动阶段、不创建runId、不修改生产代码或调用Provider；机器合同据此记录第二次纯文档预算修订。P0-05A只有在本阶段形成clean提交并由required CI生成`dirty=false` manifest后才能激活。

P0-05A入场审计随后确认：既有`provider-adapter-evidence.v1`属于健康探针/适配器测试证据，只记录聚合状态、错误分类与请求次数，不能证明每次真实调用的HTTP状态、timeout、correlation及run/task/turn绑定。机器合同据此记录第三次精确修订并切换到`provider-evidence-capture-bootstrap`；该bootstrap只在development生效、固定于2026-07-18到期、允许路径硬编码在门禁实现中，并始终返回`passed=false / deferred_capture_bootstrap`。

## 阶段

| 阶段 | 目标 | 修改范围 | 验收 |
|---|---|---|---|
| G1 合同 | 固化政策、角色和失败关闭语义 | AGENTS、ADR、合同、活动阶段 | 文档与JSON可解析，口径仍标记Provider为open |
| G2 红测试 | 对越界、债务增长、篡改和伪证据建立失败用例 | `tests/development-gates` | 测试在实现前能暴露缺失入口 |
| G3 实现 | 落地静态门、manifest和Provider receipt验证 | `config`、`scripts`、`package.json` | 定向测试与各子门通过 |
| G4 自动化 | 接入Windows CI与release入口 | `.github/workflows` | CI只调用仓内唯一入口，无跳过成功路径 |
| G5 收口 | 运行真实仓库验证并更新状态 | manifest、当前状态、阶段文档 | 记录真实通过、失败和未验证项，不上推证据层 |
| G6 连续性入场 | 证明既有事实源是否充分；不足时建立不可放宽的capture bootstrap | 活动阶段、Provider门禁、政策边界和门禁测试 | 精确路径可进入采集实现；越界、过期、release或伪通过全部失败 |

G6当前实现事实：`provider-call-trace.ts`使用显式development配置和AsyncLocalStorage形成单调用不可覆盖JSON；`openai-responses-adapter.ts`依据OpenAI SDK 6.46.0 `withResponse()`/`APIError`合同采集HTTP状态、哈希request ID、timeout、channel/model、usage和耗时；`conversation-turn-service.ts`绑定project、TaskBrief、teacher message和真实queued turn job。默认不写，内容正文、header、URL、凭据和错误原文不进入事实文件。

首次GitHub Windows clean checkout进入真实执行后，`policy-ratchet`在业务测试前失败。根因是绑定合同的声明哈希基于LF字节，而全新Windows checkout受`core.autocrlf=true`影响可能写成CRLF。修复只为三个绑定合同声明`eol=lf`并让政策门验证该属性；不对全仓强制换行，不规范化后再哈希，也不降低字节绑定强度。

第二次clean checkout越过政策门后在`typecheck`失败，证明本机已有`src/generated/prisma`掩盖了缺失前置条件。项目权威`typecheck`命令现先执行`prisma generate`再执行`tsc --noEmit`；workflow仍只执行`npm run verify:ci`，生成步骤不是CI私有旁路。

第三次clean checkout通过TypeScript与Lint后，Node测试暴露GitHub runner临时目录的上游reparse和一项CRLF派生fixture manifest。测试入口现在把`TEMP`、`TMP`和`TMPDIR`统一到`realpath`后的物理目录，安全测试仍拒绝该根内部的链接；PPT文字fixture的manifest改绑定仓库LF blob字节，不通过跳过或放宽路径检查制造通过。

第四次clean checkout通过全部Node测试后，Vitest暴露本机外部Provider台账和测试开关污染。Vitest现固定使用仓内无密钥Provider manifest，并在启动前删除manifest声明的继承Provider值；用例只能显式提供假值，clean CI和本机因此使用同一合同。精确增加两个fixture/测试路径，文件预算由48修订为50，生产范围不变。

第五次clean checkout通过Node测试并执行到Vitest后，暴露两个CI环境合同缺口：仓内`tts_minimax`无密钥fixture没有声明生产代码读取的voice ID，且GitHub Windows runner没有打包链路测试需要的真实FFmpeg与LibreOffice。fixture现声明`MINIMAX_TTS_VOICE_ID`，workflow使用Chocolatey安装真实`ffmpeg`、`ffprobe`和LibreOffice并把解析后的二进制路径写入job环境；接线测试同时约束这些前置步骤和唯一验证入口。该修复不调用Provider、不使用假媒体或fallback，也不把环境安装变成第二套验证逻辑。

仓库转为公开后，推送前审计发现当前权威文档和媒体二进制解析仍包含用户目录、工作区或本机工具绝对路径。公开仓库卫生修订把文档位置替换为仓库相对或环境中立说明，把媒体解析改为显式环境变量优先、标准PATH命令兜底，并按项目准则保存AGENTS原文备份；精确Git变更文件预算由50修订为55，本地忽略的备份不计入Git预算，不调用Provider或进入release范围。

第六次clean checkout确认真实FFmpeg与LibreOffice安装、解析成功，随后暴露三项更深的runner合同：PPT转图还依赖Poppler；TTS用例的显式ambient env没有携带仓内ledger root，本机真实台账曾掩盖该缺口；隔离health schema初始化在hosted runner上超过Vitest默认5秒。workflow现安装并显式解析真实Poppler，TTS用例固定仓内无密钥fixture，health真实集成用例单独使用15秒上限；精确文件预算由55修订为57，不减少任何行为断言。

第七次clean checkout确认Chocolatey Poppler安装成功，但该包不创建`pdfinfo.exe`/`pdftoppm.exe` shim。workflow现从受控的`ChocolateyInstall\lib\poppler\tools`解析实际二进制，要求两者同时存在，并把实际bin目录与显式路径传给后续验证；不绑定具体包版本或runner盘符。

SDK依据：OpenAI官方`openai-node` v6.46.0 [Request IDs](https://github.com/openai/openai-node/blob/v6.46.0/README.md#request-ids)、[Handling errors](https://github.com/openai/openai-node/blob/v6.46.0/README.md#handling-errors)与[Timeouts](https://github.com/openai/openai-node/blob/v6.46.0/README.md#timeouts)。当前生产客户端继续固定`maxRetries: 0`，避免SDK自动重试掩盖原始失败。

## 回退

门禁未进入共享分支前可整体撤回本阶段新增入口，并恢复本阶段开始前的`AGENTS.md`备份。进入共享分支后只能修复门禁或按ADR替代；不得保留CI绿灯同时删除失败关闭检查。
