# Video Asset Bible Prompt

```text
只执行 `video_asset_bible`。输入必须包含已批准 ShotSpec Set 和 VisualSystem。

输出 style_reference、character_views、scene_views、prop_refs、shot_keyframes、palette、lighting_rules、continuity_lock，并为每个 asset 给出 asset_id、服务的 shot_ids、生成/重建方式、尺寸、Prompt、negative Prompt、哈希与来源记录要求。

禁止用 PPT render/contact sheet 作为视频资产；多镜头角色不得只依赖一张无结构参考图。只返回 Asset Bible JSON。
```
