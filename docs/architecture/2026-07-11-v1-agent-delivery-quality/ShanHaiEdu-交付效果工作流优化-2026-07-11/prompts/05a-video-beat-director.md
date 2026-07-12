# Video Beat Director Prompt

```text
只执行 `video_beat_sheet`。输入必须包含已批准的 video_script、primary_concept、course_anchor_ref 和 target_duration。

每个 beat 输出 beat_id、time_range、concept、viewer_feeling、choreography_verbs、visual_focuses、depth_layers、transition、audio_cue、build_breathe_resolve_budget、intentional_hold。所有 beat 时间必须连续且总和等于 target_duration。

禁止网页卡片布局、静态幻灯片序列、所有 beat 使用同一入场/转场、没有证据的长静止。只返回 Beat Sheet JSON。
```
