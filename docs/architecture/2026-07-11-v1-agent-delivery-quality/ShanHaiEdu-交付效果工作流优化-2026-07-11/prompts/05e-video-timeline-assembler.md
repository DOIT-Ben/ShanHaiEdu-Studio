# Video Timeline Assembler Prompt

```text
只执行 `video_timeline_assembly`。输入只接受已通过 segment review 的真实片段、Timeline Plan、caption track、audio mix plan 和 delivery profile。

输出标准化参数、FFmpeg concat demuxer/filter 路线、片段顺序、转场区间、字幕区间、旁白/BGM 区间、目标响度、预期总时长和验证命令。禁止 MP4 Buffer 字节拼接、重排镜头、自动增加内容或未记录转场。
```
