# 真实 API 实验

## 目的

用相同课题、相同模型、相同三页范围，对比现行“四层设计提示”与 A+“传播任务 + 累计叙事 + PageSpec”提示。随后由独立 Critic 盲评，不把版本名称透露给审查提示。

## 文件

- `run-agent-brain-ab.ps1`：Agent Brain A/B 与盲评。
- `llm-baseline-output.txt`：基线输出。
- `llm-optimized-output.txt`：优化输出。
- `llm-blind-review-output.txt`：盲评结果。
- `images/`：同课题基线与优化视觉图。
- `video/`：优化 ShotSpec 的短视频 Provider 实验。
- `experiment-summary.md`：实验结论和边界。

## 安全

脚本只从项目 `.env` 在进程内读取配置，不打印、不复制、不写入 API key。输出 manifest 只记录模型和脱敏 host。
