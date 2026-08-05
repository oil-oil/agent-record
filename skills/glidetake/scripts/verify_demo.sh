#!/usr/bin/env bash
set -euo pipefail

video_file="${1:-}"
expected_width="${2:-3840}"
expected_height="${3:-2160}"
expected_fps="${4:-60}"

if [[ -z "$video_file" || ! -s "$video_file" ]]; then
  echo "验收失败：视频不存在或为空：$video_file" >&2
  exit 1
fi

probe="$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=width,height,avg_frame_rate,nb_frames \
  -show_entries format=duration \
  -of default=noprint_wrappers=1 "$video_file")"

width="$(sed -n 's/^width=//p' <<<"$probe")"
height="$(sed -n 's/^height=//p' <<<"$probe")"
rate="$(sed -n 's/^avg_frame_rate=//p' <<<"$probe")"
duration="$(sed -n 's/^duration=//p' <<<"$probe")"
frames="$(sed -n 's/^nb_frames=//p' <<<"$probe")"
fps="$(awk -F/ 'NF==2 && $2!=0 {printf "%.3f", $1/$2}' <<<"$rate")"

[[ "$width" == "$expected_width" ]] || { echo "验收失败：宽度 ${width}，期望 ${expected_width}" >&2; exit 1; }
[[ "$height" == "$expected_height" ]] || { echo "验收失败：高度 ${height}，期望 ${expected_height}" >&2; exit 1; }
awk -v actual="$fps" -v expected="$expected_fps" 'BEGIN {d=actual-expected; if(d<0)d=-d; exit(d<=0.05?0:1)}' || {
  echo "验收失败：帧率 ${fps}，期望 ${expected_fps}" >&2
  exit 1
}

black_samples=0
sample_count=0
for ratio in 0.05 0.25 0.50 0.75 0.95; do
  timestamp="$(awk -v duration="$duration" -v ratio="$ratio" 'BEGIN {printf "%.3f", duration * ratio}')"
  stats="$(ffmpeg -hide_banner -loglevel info -ss "$timestamp" -i "$video_file" \
    -frames:v 1 -vf "signalstats,metadata=print,blackframe=amount=0:threshold=32" \
    -f null - 2>&1 || true)"
  yavg="$(sed -n 's/.*lavfi\.signalstats\.YAVG=//p' <<<"$stats" | tail -n 1)"
  ymax="$(sed -n 's/.*lavfi\.signalstats\.YMAX=//p' <<<"$stats" | tail -n 1)"
  pblack="$(sed -n 's/.*pblack:\([0-9][0-9]*\).*/\1/p' <<<"$stats" | tail -n 1)"

  if [[ -n "$yavg" && -n "$ymax" && -n "$pblack" ]]; then
    sample_count=$((sample_count + 1))
    if awk -v avg="$yavg" -v max="$ymax" -v black="$pblack" \
      'BEGIN {exit((avg <= 18 && max <= 24) || (black >= 99 && avg <= 25) ? 0 : 1)}'; then
      black_samples=$((black_samples + 1))
    fi
  fi
done

if (( sample_count < 3 )); then
  echo "验收失败：无法取得足够的视频画面样本" >&2
  exit 1
fi

if (( black_samples * 2 >= sample_count )); then
  echo "验收失败：${sample_count} 个画面样本中有 ${black_samples} 个为纯黑帧" >&2
  exit 1
fi

ffmpeg -v error -i "$video_file" -f null -
echo "验收通过：${width}x${height} / ${fps}fps / ${duration}s / ${frames} 帧 / 黑帧样本 ${black_samples}/${sample_count}"
