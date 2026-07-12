# Video Segment Request Prompt

```text
只执行一个 `video_segment_generation:<shot_id>`。输入必须是一个通过 schema 的 ShotSpec、其 resolved video asset refs 和明确 Provider profile。

输出 provider request、shot_id、source_asset_ids、expected_duration、expected_stream_profile 和 acceptance_checks。不得把多个镜头放入一个请求；不得使用未解析路径、PPT 素材或模型自行猜测的参考图。只返回单个 Segment Request JSON。
```
