# V1 Stage 6：低年级《1～5 的认识》真实交付收尾

日期：2026-07-12

状态：PPT通过；视频创意锚点复盘失败；整包退回视频Concept Selection阶段

## 结论

低年级数概念任务的教材证据、12 页可编辑 PPTX、PDF和课时方案通过；现有18秒及60秒Grok视频只证明真实Provider与合成链路，独立创意和课程锚点失败。最终ZIP保留为历史验收候选，不再具有完整交付资格。所有阶段批准均为 `simulated_integration_approval`，`teacher_signoff=false`。

## 教材证据

- 课题：人教版一年级上册《1～5 的认识》。
- 官方数字教材：人民教育出版社官方数字教材入口。
- 本地证据：`.tmp\stage6-official-textbook-evidence\grade1-1to5-official-pages-20-30.pdf`。
- SHA-256：`1cab9f424728cc6acd10c04cae00d159912891cacb75f66978cd3a2a0c2f6bce`。
- 核心范围：数字页 20～25；数字页 22 用于数字 1～5 书写方向专项核对。

## PPT 交付

| 项目 | 结果 |
|---|---|
| PPTX | `.tmp\stage6-grade1-number-concepts\full-production\一年级数学-1到5的认识-12页正式课件.pptx` |
| PPTX SHA-256 | `97d151a077b44dee1bbf7826448f53aa150e0260e1be62b66ea94995d4d3e79d` |
| PDF | 12 页，SHA-256 `ea381c46fe96f9f7fa3c96e3053d0d145998ea3c3f37739f5dc441465c454ab3` |
| 教师备注 | 12/12 页 |
| `slides_test.py` | 通过，无越界 |
| 双渲染器 | Artifact Tool 与 LibreOffice/Poppler 均通过 |
| 来源门禁 | `validate_provenance.py` 通过 |
| 阶段门禁 | `validate_stage.py --target final_qa` 通过 |

第 10 页曾因通用方向符号不足以准确对应教材而被拒绝；返修后改为逐数字可编辑起笔说明，并再次完成 PPTX/PDF 全量渲染与越界检查。

## 视频交付

| 项目 | 结果 |
|---|---|
| Provider | Evolink Grok Imagine I2V |
| 参考资产 | 视频域独立 1920×1080 关键帧，三镜头均真实上传 |
| 镜头 | 3 段，每段约 6.04 秒 |
| 最终 MP4 | `.tmp\stage6-grade1-number-concepts-video\一年级数学-1到5的认识-课堂导入视频-v1.mp4` |
| 技术规格 | H.264，736×400，24fps；AAC 48kHz 双声道静音轨 |
| 时长 | 18.166 秒 |
| SHA-256 | `c55c3a98ff5bc9b351ab546b7d07ba5d1244bc41f8aaec70aa14496ae5f1114f` |

三镜头分别完成“发现空白标签—观察空牌与空槽—放下木牌并把问题交还课堂”。首、中、尾帧和镜头边界均通过；Provider 原始音轨已丢弃，避免随机英文或环境音进入课堂。

## 最终包

- ZIP：`.tmp\一年级数学-1到5的认识-V1-教师验收包.zip`。
- 字节数：35,733,473。
- SHA-256：`afad9698b6c650d15dfbd40a431284de40e586659d2ab54b46c093031e36fca0`。
- 条目：真实 PPTX、PDF、MP4、课时方案、PPT 来源清单、视频 timeline、视频 critic、PPT QA 与交付清单，共 9 项。
- 反向验包：8/8 权威交付文件哈希一致，ZIP 可正常打开，无私有 Provider 证据、失败候选或密钥文件。

## 剩余门禁

1. 真实教师需观看、下载并明确签收或提出返修意见。
2. 中年级几何/测量任务仍需补齐官方教材证据并完成同等 PPTX/MP4/ZIP。
3. 目标服务器恢复、公开注册关闭复核和外部故障实操仍未完成。
