"""Independent FFmpeg verification. No Python packages required; set FFMPEG_PATH.

python3 tests/browser/previs/verifyRasterMedia.py FILE --frames 250 --ffmpeg /path/to/ffmpeg
Streams video diagnostics/PCM; retains neither decoded video frames nor a full audio mix.
"""
import argparse
from array import array
import json
import math
import os
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('file', type=Path)
parser.add_argument('--frames', type=int, required=True)
parser.add_argument('--ffmpeg', default=os.environ.get('FFMPEG_PATH', 'ffmpeg'))
args = parser.parse_args()
if not 1 <= args.frames <= 22500:
    parser.error('--frames must be 1–22500')

video = subprocess.Popen([
    args.ffmpeg, '-hide_banner', '-nostats', '-i', str(args.file), '-map', '0:v:0',
    '-vf', 'showinfo', '-fps_mode', 'passthrough', '-f', 'null', '-',
], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
count = 0
max_video_error = 0.0
metadata = []
try:
    for line in video.stderr:
        if 'Stream #0:' in line and len(metadata) < 10:
            metadata.append(line.strip())
        match = re.search(r'\bn:\s*(\d+)\s+pts:.*?pts_time:([\d.eE+-]+)', line)
        if not match:
            continue
        index = int(match.group(1))
        assert index == count, (index, count)
        max_video_error = max(max_video_error, abs(float(match.group(2)) - index / 25))
        count += 1
finally:
    video.stderr.close()
assert video.wait() == 0, 'FFmpeg video decode failed'
assert count == args.frames, (count, args.frames)
assert max_video_error <= 0.000001, max_video_error
assert any('Video: h264' in line and '1920x1080' in line and '25 fps' in line for line in metadata), metadata
assert any('Audio: aac' in line and '48000 Hz, mono' in line for line in metadata), metadata

# Scan one-second PCM blocks. Count threshold crossings against the known click
# fixture, including its first sample and its tail, rather than trusting timestamps.
audio = subprocess.Popen([
    args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-i', str(args.file),
    '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-',
], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
onsets = [None] * math.ceil(args.frames / 25)
sample_index = 0
try:
    while True:
        raw = audio.stdout.read(48000 * 4)
        if not raw:
            break
        values = array('f')
        values.frombytes(raw)
        for index, value in enumerate(values):
            if abs(value) < 0.03:
                continue
            time = (sample_index + index) / 48000
            second = int(math.floor(time + 0.5))
            if 0 <= second < len(onsets) and onsets[second] is None:
                onsets[second] = time
        sample_index += len(values)
finally:
    audio.stdout.close()
errors = audio.stderr.read().decode('utf-8', errors='replace')
audio.stderr.close()
assert audio.wait() == 0, errors
assert all(onset is not None for onset in onsets), 'Missing audio click'
audio_errors = [onset - second for second, onset in enumerate(onsets)]
assert max(abs(error) for error in audio_errors) <= 1 / 25, audio_errors[:10]
# AAC padding is permitted, but must stay below the same one-frame tolerance.
assert abs(sample_index / 48000 - args.frames / 25) <= 1 / 25, sample_index / 48000
report = {
    'file': str(args.file.resolve()), 'ffmpeg': args.ffmpeg, 'frames': count,
    'videoSeconds': count / 25, 'maxVideoTimestampErrorSeconds': max_video_error,
    'audioSamples': sample_index, 'audioSeconds': sample_index / 48000,
    'clickCount': len(onsets), 'audioOnsetErrorSeconds': {'min': min(audio_errors), 'max': max(audio_errors)},
    'metadata': metadata,
}
path = args.file.with_suffix('.ffmpeg.json')
path.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
print('PASS independent FFmpeg frame, timestamp, codec, dimension and audio-tolerance checks')
