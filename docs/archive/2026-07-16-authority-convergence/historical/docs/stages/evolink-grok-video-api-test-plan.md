# Evolink Grok Video API 测试计划

日期：2026-07-09

## 1. 测试目标

验证 Evolink Grok Imagine Video API 在当前本机密钥下能完成最小真实视频生成闭环：提交、轮询、下载、artifact 校验。

## 2. 测试范围

| 项 | 范围 |
|---|---|
| Provider | Evolink AI |
| Base URL | `https://api.evolink.ai` |
| 模型 | `grok-imagine-text-to-video-beta` |
| 接口 | `POST /v1/videos/generations`、`GET /v1/tasks/{task_id}` |
| 参数 | `duration=6`、`quality=480p`、`mode=normal`、`aspect_ratio=16:9` |
| 产物 | MP4 下载到本地 QA 证据目录 |

不在本轮范围：

- 图生视频真实调用。
- 并发、重试、取消和 callback 测试。
- 业务后端 adapter 接线。
- 前端工作台可见能力切换。

## 3. 测试用例

### T1：创建任务

请求：

```json
{
  "model": "grok-imagine-text-to-video-beta",
  "prompt": "A calm classroom intro scene for a primary math lesson, warm sunlight, students counting colorful blocks on a desk, gentle camera movement",
  "duration": 6,
  "quality": "480p",
  "mode": "normal",
  "aspect_ratio": "16:9"
}
```

期望：

- HTTP 200。
- 返回 `id`，格式为任务 id。
- 返回 `status` 为 `pending` 或 `processing`。

### T2：轮询任务

步骤：

1. 每 15 秒查询 `GET /v1/tasks/{task_id}`。
2. 最多等待 8 分钟。
3. 若返回 `failed`，记录脱敏错误类型并停止。

期望：

- 最终 `status=completed`。
- `progress=100` 或接近完成。
- `results` 至少包含一个 URL。

### T3：下载和校验 MP4

步骤：

1. 下载 `results[0]` 到本地 QA 证据目录。
2. 检查文件大小大于 0。
3. 读取文件头，确认包含 MP4 `ftyp` 标识。
4. 若 `ffprobe` 可用，读取时长、分辨率、编码摘要。

期望：

- MP4 文件存在且非空。
- header 可识别。
- `ffprobe` 可读时记录 metadata；不可用时记录未验证原因。

## 4. 集中验收命令

```powershell
python scripts\validate_ledger.py
```

验收结论必须包含：

- 任务 id 的脱敏形式。
- HTTP 状态和最终任务状态。
- artifact 文件路径、大小、header 校验结果。
- 是否有 `ffprobe` metadata。
- 公开台账校验结果。
