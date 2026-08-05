#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  addIdleGestureBridges,
  adjustedSegmentDurationMs,
  leadingBlackTrimMs,
  remapSegmentEvents,
  transitionEndMs,
} from './lib/recording-transitions.mjs';

function parseArgs(argv) {
  const options = { clips: [], timelines: [] };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`参数不完整：${key || ''}`);
    if (key === '--clip') options.clips.push(value);
    else if (key === '--timeline') options.timelines.push(value);
    else options[key.slice(2)] = value;
  }
  return options;
}

function numberOption(value, fallback, name) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${name} 必须是大于或等于 0 的数字`);
  }
  return number;
}

function run(command, args, { capture = false, captureStderr = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: capture || captureStderr
        ? ['ignore', capture ? 'pipe' : 'ignore', captureStderr ? 'pipe' : 'inherit']
        : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    if (capture) child.stdout.on('data', (chunk) => { stdout += chunk; });
    if (captureStderr) child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => (
      code === 0
        ? resolve(captureStderr ? stderr : stdout)
        : reject(new Error(`${command} 执行失败，退出码 ${code}`))
    ));
  });
}

const options = parseArgs(process.argv.slice(2));
if (!options.out || !options['timeline-out']) {
  throw new Error('必须提供 --out 和 --timeline-out');
}
if (options.clips.length < 2 || options.clips.length !== options.timelines.length) {
  throw new Error('--clip 与 --timeline 必须成对提供，且至少两组');
}

const clips = options.clips.map((file) => path.resolve(file));
const timelineFiles = options.timelines.map((file) => path.resolve(file));
const output = path.resolve(options.out);
const timelineOutput = path.resolve(options['timeline-out']);
const timelines = await Promise.all(
  timelineFiles.map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
);
for (const [index, timeline] of timelines.entries()) {
  if (!Array.isArray(timeline.events) || !Number.isFinite(Number(timeline.durationMs))) {
    throw new Error(`时间轴格式无效：${timelineFiles[index]}`);
  }
}

const probes = await Promise.all(clips.map(async (file) => {
  const result = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,width,height',
    '-of', 'json',
    file,
  ], { capture: true });
  return JSON.parse(result);
}));
const videos = probes.map((probe, index) => {
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  if (!video) throw new Error(`视频流不存在：${clips[index]}`);
  return video;
});
const width = Number(videos[0].width);
const height = Number(videos[0].height);
if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
  throw new Error('无法读取基准片段分辨率');
}
const preserveAudio = probes.every((probe) => (
  probe.streams?.some((stream) => stream.codec_type === 'audio')
));
const mediaDurationsMs = probes.map((probe, index) => {
  const probedDurationMs = Math.round(Number(probe.format?.duration) * 1000);
  const timelineDurationMs = Math.round(Number(timelines[index].durationMs));
  const durationMs = Number.isFinite(probedDurationMs) && probedDurationMs > 0
    ? probedDurationMs
    : timelineDurationMs;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error(`无法读取视频或时间轴时长：${clips[index]}`);
  }
  return {
    durationMs,
    source: Number.isFinite(probedDurationMs) && probedDurationMs > 0
      ? 'media'
      : 'timeline',
  };
});

const smartTransitions = options['smart-transitions'] !== 'false';
const trimLeadingBlack = options['trim-leading-black'] !== 'false';
const transitionHoldMs = numberOption(
  options['transition-hold-ms'],
  550,
  '--transition-hold-ms',
);
const maximumLeadingBlackMs = numberOption(
  options['maximum-leading-black-ms'],
  800,
  '--maximum-leading-black-ms',
);
const blackDetectLogs = await Promise.all(clips.map(async (file) => {
  if (!trimLeadingBlack) return '';
  return run('ffmpeg', [
    '-hide_banner',
    '-i', file,
    '-t', ((maximumLeadingBlackMs + 100) / 1000).toFixed(3),
    '-vf', 'blackdetect=d=0.05:pix_th=0.10',
    '-an',
    '-f', 'null',
    '-',
  ], { captureStderr: true });
}));
const trimPlans = timelines.map((timeline, index) => {
  const mediaDurationMs = mediaDurationsMs[index].durationMs;
  const timelineDurationMs = Math.max(0, Number(timeline.durationMs));
  const boundedTimeline = {
    ...timeline,
    durationMs: Math.min(timelineDurationMs, mediaDurationMs),
  };
  const trimStartMs = leadingBlackTrimMs(blackDetectLogs[index], {
    enabled: trimLeadingBlack,
    maximumMs: maximumLeadingBlackMs,
  });
  const trimEndMs = transitionEndMs(boundedTimeline, {
    isLast: index === timelines.length - 1,
    enabled: smartTransitions,
    holdMs: transitionHoldMs,
  });
  const durationMs = adjustedSegmentDurationMs(
    boundedTimeline,
    trimStartMs,
    trimEndMs,
  );
  if (durationMs < 250) {
    throw new Error(`智能裁剪后片段过短：${clips[index]}`);
  }
  return {
    trimStartMs,
    trimEndMs,
    durationMs,
    removedLeadingBlackMs: trimStartMs,
    removedTailMs: Math.max(0, Math.round(timelineDurationMs - trimEndMs)),
    mediaDurationMs,
    mediaDurationSource: mediaDurationsMs[index].source,
    timelineDurationMs,
  };
});

const preparedInputs = [];
const filters = [];
trimPlans.forEach((plan, index) => {
  const start = (plan.trimStartMs / 1000).toFixed(3);
  const end = (plan.trimEndMs / 1000).toFixed(3);
  filters.push(
    `[${index}:v:0]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,`
      + `scale=${width}:${height}:force_original_aspect_ratio=increase,`
      + `crop=${width}:${height},setsar=1[v${index}]`,
  );
  preparedInputs.push(`[v${index}]`);
  if (preserveAudio) {
    filters.push(
      `[${index}:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`,
    );
    preparedInputs.push(`[a${index}]`);
  }
});
filters.push(...(preserveAudio
  ? [
      `${preparedInputs.join('')}concat=n=${clips.length}:v=1:a=1[joinedv][outa]`,
      '[joinedv]fps=60,format=yuv420p[outv]',
    ]
  : [
      `${preparedInputs.join('')}concat=n=${clips.length}:v=1:a=0,fps=60,format=yuv420p[outv]`,
    ]
));

await mkdir(path.dirname(output), { recursive: true });
const ffmpegArgs = [
  '-y',
  ...clips.flatMap((file) => ['-i', file]),
  '-filter_complex', filters.join(';'),
  '-map', '[outv]',
];
if (preserveAudio) ffmpegArgs.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '192k');
else ffmpegArgs.push('-an');
ffmpegArgs.push(
  '-c:v', 'libx264',
  '-preset', 'medium',
  '-crf', '18',
  '-movflags', '+faststart',
  output,
);
await run('ffmpeg', ffmpegArgs);

let offsetMs = 0;
const events = [];
let lastPoint = null;
const continuousCursor = options['continuous-cursor'] === 'true';
timelines.forEach((timeline, timelineIndex) => {
  const plan = trimPlans[timelineIndex];
  const segmentEvents = remapSegmentEvents(timeline, {
    trimStartMs: plan.trimStartMs,
    trimEndMs: plan.trimEndMs,
    offsetMs,
    isFirst: timelineIndex === 0,
    isLast: timelineIndex === timelines.length - 1,
  });
  const pageEvent = segmentEvents.find((event) => event.kind === 'page');
  const firstPointerEvent = segmentEvents.find((event) => (
    ['move', 'click'].includes(event.kind)
    && Number(event.tMs) > Number(pageEvent?.tMs ?? 0)
  ));
  const bridgeDelayMs = Math.min(
    350,
    Math.max(
      0,
      Number(firstPointerEvent?.tMs ?? 0) - Number(pageEvent?.tMs ?? 0) - 180,
    ),
  );
  segmentEvents.forEach((event) => {
    const outputEvent = { ...event };
    if (continuousCursor && timelineIndex > 0 && event.kind === 'page' && lastPoint) {
      const viewport = timeline.source?.viewport;
      outputEvent.nx = lastPoint.nx;
      outputEvent.ny = lastPoint.ny;
      if (Number(viewport?.width) > 0) outputEvent.x = Math.round(lastPoint.nx * viewport.width);
      if (Number(viewport?.height) > 0) outputEvent.y = Math.round(lastPoint.ny * viewport.height);
    }
    events.push(outputEvent);
    if (
      continuousCursor
      && timelineIndex > 0
      && event.kind === 'page'
      && lastPoint
      && bridgeDelayMs >= 120
    ) {
      events.push({
        kind: 'move',
        tMs: outputEvent.tMs + bridgeDelayMs,
        nx: outputEvent.nx,
        ny: outputEvent.ny,
        x: outputEvent.x,
        y: outputEvent.y,
        synthetic: 'segment-bridge-hold',
      });
    }
    if (Number.isFinite(outputEvent.nx) && Number.isFinite(outputEvent.ny)) {
      lastPoint = { nx: outputEvent.nx, ny: outputEvent.ny };
    }
  });
  offsetMs += plan.durationMs;
});

const smoothedEvents = addIdleGestureBridges(events);
const mergedTimeline = {
  ...timelines[0],
  sessionId: `merged-${Date.now()}`,
  durationMs: offsetMs,
  events: smoothedEvents,
  sourceSegments: timelines.map((timeline, index) => ({
    startMs: trimPlans
      .slice(0, index)
      .reduce((sum, item) => sum + item.durationMs, 0),
    durationMs: trimPlans[index].durationMs,
    source: timeline.source,
  })),
  processingResult: {
    mode: 'concatenate',
    smartTransitions,
    transitionHoldMs,
    trimLeadingBlack,
    syntheticGestureBridges: smoothedEvents.filter(
      (event) => event.synthetic === 'idle-gesture-bridge',
    ).length,
    clips: clips.map((file, index) => ({
      file,
      timeline: timelineFiles[index],
      durationMs: trimPlans[index].durationMs,
      trimStartMs: trimPlans[index].trimStartMs,
      trimEndMs: trimPlans[index].trimEndMs,
      removedLeadingBlackMs: trimPlans[index].removedLeadingBlackMs,
      removedTailMs: trimPlans[index].removedTailMs,
      mediaDurationMs: trimPlans[index].mediaDurationMs,
      mediaDurationSource: trimPlans[index].mediaDurationSource,
      timelineDurationMs: trimPlans[index].timelineDurationMs,
    })),
  },
};
await mkdir(path.dirname(timelineOutput), { recursive: true });
await writeFile(timelineOutput, `${JSON.stringify(mergedTimeline, null, 2)}\n`);

console.log(`合并完成：${output}`);
console.log(`时间轴：${timelineOutput}`);
