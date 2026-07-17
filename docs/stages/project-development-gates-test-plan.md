# 项目开发门禁制度化测试计划

日期：2026-07-17
状态：verified-local-awaiting-clean-ci

## 测试原则

- 测试门禁本身的失败路径，不用mock业务Provider或伪造成功结果证明产品稳定。
- 文件系统与Git场景使用隔离临时仓库；不读取或改写真实密钥、数据库、Artifact和Provider台账。
- 当前仓库存在的债务按精确基线登记，测试证明基线只能收缩，不能新增、增长或通过改阈值绕过。

## 必测合同

| ID | 场景 | 预期 |
|---|---|---|
| DG-01 | 无活动阶段修改生产路径 | 失败 |
| DG-02 | 活动阶段出现allowlist外路径、超预算、符号链接或非祖先基线 | 失败 |
| DG-03 | 修改archive且无精确例外 | 失败 |
| DG-04 | 新增源码读取字符串合同或提高既存命中数 | 失败 |
| DG-05 | 新增超500行文件、超150行函数或扩大既存债务 | 失败 |
| DG-06 | 降低债务但未同步收缩政策基线 | 失败并要求ratchet |
| DG-07 | 提高Lint上限、复杂度阈值、Provider证据时效或降低连续次数 | 失败 |
| DG-08 | manifest的HEAD、tree、工作树、政策SHA、阶段SHA或命令集合被篡改 | 失败 |
| DG-09 | 任一必跑命令失败或缺失 | 不生成成功manifest |
| DG-10 | Provider receipt缺失、过期、候选SHA不符、证据哈希不符或场景不足 | 失败 |
| DG-11 | Provider任一轮出现5xx、timeout、mock、fallback、degraded或placeholder | 失败 |
| DG-12 | 当前精确债务基线与仓库一致 | 静态开发门通过 |
| DG-13 | capture bootstrap命中固定生产路径、development模式且未过期 | 返回`passed=false / deferred_capture_bootstrap` |
| DG-14 | capture bootstrap扩大路径、延长到期日、进入release或冒充receipt | 失败 |
| DG-15 | 真实SDK transport envelope映射为逐调用事实 | 保留HTTP状态、哈希request ID、timeout、usage和业务身份，不保存敏感正文 |
| DG-16 | 没有活动turn context或未显式启用capture | 不写孤儿证据，不改变Provider结果 |
| DG-17 | 全新Windows checkout启用`core.autocrlf` | 三个绑定合同仍以LF落盘，声明SHA与实际字节一致；缺少`eol=lf`时政策门失败 |
| DG-18 | clean checkout没有本地Prisma生成目录 | 权威`typecheck`先生成Prisma client再运行TypeScript；workflow不增加私有旁路 |
| DG-19 | GitHub runner临时根存在上游reparse，文本fixture由LF checkout | 测试夹具写入`realpath`物理临时根且继续拒绝根内链接；manifest绑定LF Git blob字节 |
| DG-20 | 本机存在外部Provider台账和真实Provider环境值，clean CI不存在 | Vitest固定使用无密钥仓内manifest并删除继承Provider值；能力测试只接受显式假值 |
| DG-21 | clean GitHub Windows runner没有媒体工具，TTS fixture漏声明voice ID | CI安装并显式解析真实FFmpeg、FFprobe与LibreOffice；fixture声明全部被测TTS环境键；workflow仍只有`npm run verify:ci`一个验证入口 |
| DG-22 | 仓库由私有转公开后，当前权威文档和媒体解析包含本机绝对路径 | 当前开发入口只保留仓库相对或环境中立位置；媒体工具以显式环境变量或PATH解析；AGENTS修改前双份备份；历史敏感信息审计不回显候选值 |
| DG-23 | clean runner缺Poppler、显式TTS env未绑定fixture根、health初始化超过默认5秒 | 安装并解析真实`pdfinfo`/`pdftoppm`；TTS用例显式使用仓内无密钥ledger；health行为断言不变且仅该真实集成用例上限为15秒 |
| DG-24 | Chocolatey Poppler安装成功但没有命令shim | 从`ChocolateyInstall\lib\poppler\tools`解析并验证两项实际二进制，不绑定包版本或runner盘符，并写入job环境 |
| DG-25 | Chocolatey当前Poppler版本实际是源码包 | Poppler固定为已检查nupkg且含两项Windows二进制的`22.11.0.20240421`；FFmpeg与LibreOffice不随之降级；仍从受控包目录解析实际路径 |
| DG-26 | hosted runner暴露TTS分支漏绑fixture、第二组health 5秒假设和PPT命令黑盒 | TTS所有分支固定仓内ledger；health readiness三个真实集成用例各15秒；LibreOffice使用唯一profile，Office/Poppler错误映射稳定阶段码并有行为测试 |

## 实际命令

```powershell
node --test tests/development-gates/*.test.mjs
npm run gate:development
npm run typecheck
npm run lint -- --max-warnings 150
npm test
npm run build
npm run verify:local
npm run gate:manifest:verify
npm run gate:release
git diff --check
```

`gate:release`在没有当前候选真实Provider receipt时必须失败；该失败是门禁生效证据，不是release通过。
