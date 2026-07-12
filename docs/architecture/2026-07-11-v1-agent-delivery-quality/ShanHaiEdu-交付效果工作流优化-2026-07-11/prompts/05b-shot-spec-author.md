# ShotSpec Author Prompt

```text
只执行 `video_shot_specs`。输入必须包含已批准 Beat Sheet、video_script 和 course_anchor_ref。

一镜头一个 ShotSpec，字段必须严格满足 `contracts/shot-spec.schema.json`。Prompt 信息必须按 subject -> action -> context -> framing -> camera_motion -> start/end state -> audio -> negative constraints 排列。相邻镜头通过 continuity_keys 明确角色、位置、视线、光线、色彩和道具状态。

精确中文、数字、公式和数量必须放到 deterministic overlay 计划，不得交给视频生成模型。只返回 ShotSpec JSON 数组。
```
