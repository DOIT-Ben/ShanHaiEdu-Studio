# 独立智能体审查报告

审查日期：2026-07-11
审查方式：只读检查交付目录、结构化契约、Prompt、真实 API 实验输出、图片、视频及 manifest；未修改 ShanHaiEdu-Studio 项目代码。

## 结论

**PASS_WITH_LIMITATIONS**

当前交付已经达到“可交给开发团队作为业务工作流与实现输入”的标准。此前发现的核心架构断点、Schema/Prompt 漂移、实验结论过度、无障碍字段缺失和交付清单缺项均已修复。最终复核未发现剩余 P0 或 P1。

该结论不表示工作流已在生产代码中实现，也不表示 PPTX、完整视频或真实课堂效果已经通过验收；这些属于后续实现与产品验证范围。

## 审查范围

- 根目录 `README.md` 与 `01` 至 `07` 设计文档。
- `contracts/node-contracts-v2.json`、全部 JSON Schema、示例和离线验证脚本。
- `prompts/` 中总控、PPT、视频分节点与最终审计 Prompt。
- LLM 文本 A/B、图片 A/B、视频单样本、盲评输出及 manifests。
- `baseline.png`、`optimized.png`、`contact-sheet.png` 和 `optimized-opening-hook.mp4`。

## 已修复项

1. **工作流图闭环**：契约已补齐 `course_anchor`、`visual_system`、`video_script`、PPT 资产生成/审查、视频片段生成/审查和时间轴装配等节点；当前共 22 个唯一节点，所有 `nextOnPass` 均指向已知节点或 `delivered`。
2. **分支汇合门**：PPT 资产审查要求 `approved_asset_ids == required_asset_ids`；视频片段审查要求 `approved_shot_ids == required_shot_ids`，避免部分资产或单个镜头通过后提前进入下游。
3. **Schema 与 Prompt 对齐**：ShotSpec 统一为 `start_seconds` / `duration_seconds`；PPT 与视频 Critic 的 Finding 字段统一到 `review-finding.schema.json`；PPT Director 增加整包响应 Schema 和有效示例。
4. **离线 Schema 解析**：`validate_json_schema.py` 建立本地 Schema registry，解决相对 `$ref` 被解析为网络地址的问题；Director 整包示例现可离线验证。
5. **无障碍契约**：PageSpec 已强制 `alt_text`、`reading_order`、`non_color_coding`、`media_accessibility`；PPTX 生成输出包含 `accessibility_mapping`，渲染审查门同步覆盖。
6. **实验真实性与结论边界**：图片和视频 manifests 已记录哈希、实际尺寸/流、音频指标和失败状态；README 与实验总结明确说明文本实验不等于真实 PPTX、视频只有 A+ 单样本且不是严格 A/B。
7. **交付完整性**：`experiments/experiment-summary.md` 已存在；本报告补齐 README 声明的 `review/` 独立审查记录。

## 验证证据

执行：

```powershell
& .\contracts\validate-contracts.ps1
```

结果：6 组实例/Schema 全部 `VALID`；`Contract ids: 22, unique: 22`；`Referential integrity: VALID`。

媒体与 manifest 复核：

- 图片 manifest 中 baseline/optimized 文件哈希和 Prompt 哈希均与当前文件匹配。
- 视频可完整解码，时长 6.041667 秒，主视频 H.264 752x416@24fps，音频 AAC 44.1kHz 双声道。
- 视频 manifest 正确记录并判失败：目标分辨率不符、额外 MJPEG attached-picture 流、模糊展签违反负面约束。
- 音轨实测约 -32.3 LUFS，manifest 与实验总结均明确标记为最终混音前必须修复的问题。

## Remaining P0/P1

- **P0：0**
- **P1：0**

## 限制与后续验收门

以下不是本设计包的 P0/P1，但在宣称产品效果提升或进入教师内测前必须完成：

- 当前 LLM A/B 是单课题、单次、同模型文本设计稿盲评；尚未生成并盲评真实 PPTX。
- 图片 A/B 证明构图职责差异，不证明教材准确性或完整课堂可用性。
- 视频仅有 A+ 单样本，且样本按自身质量门应判失败；需要同 Provider 基线、失败镜头返工和最终 profile 归一化。
- 需要按路线文档完成 3 个难度递增课题的真实 PPTX/MP4 回归，并由至少一名真实教师进行结构化可用性评审。

最终判断：**可以交开发团队落地实现；不能将本报告解释为生产完成或课堂效果已证实。**
