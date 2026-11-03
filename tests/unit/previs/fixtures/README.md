`led-test-h264.mp4` is an explicit synthetic fixture, generated locally with
FFmpeg 7.1: ten seconds of 16×16 blue frames at 25 fps, H.264/yuv420p, no audio.
It substitutes for the welcome project's unavailable teacher-linked video;
tests hash its actual bytes and do not claim to verify that teacher file.

Generation command (a system FFmpeg executable is sufficient):

```sh
ffmpeg -f lavfi -i color=c=blue:s=16x16:r=25:d=10 -c:v libx264 -pix_fmt yuv420p -an -movflags +faststart led-test-h264.mp4
```
