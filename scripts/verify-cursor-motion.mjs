import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildSmoothCursorTrack,
  sampleSmoothCursorTrack,
} from '../studio/src/cursor-motion.ts';

const timelinePath = process.argv[2];
const timeline = timelinePath
  ? JSON.parse(await readFile(timelinePath, 'utf8'))
  : {
      durationMs: 4_800,
      source: { viewport: { width: 1440, height: 900 } },
      events: [
        { kind: 'page', tMs: 0, nx: .5, ny: .5 },
        { kind: 'move', tMs: 420, nx: .42, ny: .42 },
        { kind: 'move', tMs: 760, nx: .31, ny: .34 },
        { kind: 'click', tMs: 1_200, nx: .22, ny: .3 },
        { kind: 'move', tMs: 2_000, nx: .46, ny: .48 },
        { kind: 'move', tMs: 2_500, nx: .64, ny: .6 },
        { kind: 'click', tMs: 3_100, nx: .78, ny: .7 },
        { kind: 'move', tMs: 4_000, nx: .58, ny: .42 },
        { kind: 'click', tMs: 4_600, nx: .4, ny: .28 },
      ],
    };
const source = timeline.source?.viewport ?? { width: 1440, height: 900 };
const candidates = timeline.events
  .filter((event) => ['page', 'move', 'click'].includes(event.kind))
  .filter((event) => Number.isFinite(event.nx) && Number.isFinite(event.ny))
  .sort((a, b) => a.tMs - b.tMs);
const keyframes = candidates
  .filter((event, index, events) => {
    if (event.kind !== 'move') return true;
    const nextClick = events.slice(index + 1).find((candidate) => candidate.kind === 'click');
    if (!nextClick || nextClick.tMs - event.tMs > 700) return true;
    return Math.hypot(event.nx - nextClick.nx, event.ny - nextClick.ny) > .012;
  })
  .map((event) => ({
    time: event.tMs / 1000,
    x: event.nx,
    y: event.ny,
    kind: event.kind,
  }));

const track = buildSmoothCursorTrack(keyframes, {
  viewportWidth: source.width,
  viewportHeight: source.height,
});
const clicks = keyframes.filter((event) => event.kind === 'click');
assert(track.segments.length >= clicks.length, '每次有效点击前都应有一段完整鼠标手势');

for (const click of clicks) {
  const point = sampleSmoothCursorTrack(track, click.time);
  const expected = {
    x: Math.max(.02, Math.min(.98, click.x)),
    y: Math.max(.02, Math.min(.98, click.y)),
  };
  assert(point, '点击帧必须有光标位置');
  assert(
    Math.hypot(point.x - expected.x, point.y - expected.y) < .000001,
    `光标在 ${click.time.toFixed(3)} 秒没有准确落在点击位置`,
  );
}

const frameStep = 1 / 60;
const positions = [];
for (let time = 0; time <= timeline.durationMs / 1000; time += frameStep) {
  const point = sampleSmoothCursorTrack(track, time);
  if (point) positions.push(point);
}

const velocities = positions.slice(1).map((point, index) => ({
  x: (point.x - positions[index].x) * source.width / frameStep,
  y: (point.y - positions[index].y) * source.height / frameStep,
}));
const speeds = velocities.map(({ x, y }) => Math.hypot(x, y));
const accelerations = velocities.slice(1).map((velocity, index) => ({
  x: (velocity.x - velocities[index].x) / frameStep,
  y: (velocity.y - velocities[index].y) / frameStep,
}));
const accelerationMagnitudes = accelerations.map(({ x, y }) => Math.hypot(x, y));
const jerks = accelerations.slice(1).map((acceleration, index) => (
  Math.hypot(
    acceleration.x - accelerations[index].x,
    acceleration.y - accelerations[index].y,
  ) / frameStep
));
const percentile = (values, amount) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * amount)] ?? 0;
};

for (const segment of track.segments) {
  const duration = segment.endTime - segment.startTime;
  const internalSpeeds = [];
  for (
    let time = segment.startTime + duration * .15;
    time <= segment.endTime - duration * .15;
    time += frameStep
  ) {
    const from = sampleSmoothCursorTrack(track, time - frameStep / 2);
    const to = sampleSmoothCursorTrack(track, time + frameStep / 2);
    assert(from && to);
    internalSpeeds.push(
      Math.hypot(
        (to.x - from.x) * source.width,
        (to.y - from.y) * source.height,
      ) / frameStep,
    );
  }
  assert(
    Math.min(...internalSpeeds) > 15,
    `鼠标在 ${segment.startTime.toFixed(3)}–${segment.endTime.toFixed(3)} 秒的移动中途发生停顿`,
  );
}

const movingFrames = speeds.filter((speed) => speed > 5).length;
const maximumSpeed = Math.max(...speeds);
const accelerationP95 = percentile(accelerationMagnitudes, .95);
const jerkP95 = percentile(jerks, .95);
assert(movingFrames > 90, '时间轴应产生足够多的逐帧移动位置');
assert(maximumSpeed < 1_200, `鼠标峰值速度过快：${maximumSpeed.toFixed(1)}px/s`);
assert(accelerationP95 < 2500, `鼠标 95% 加速度过高：${accelerationP95.toFixed(1)}px/s²`);
assert(jerkP95 < 20_000, `鼠标 95% 加加速度过高：${jerkP95.toFixed(1)}px/s³`);

console.log(JSON.stringify({
  timeline: timelinePath ?? 'inline-production-fixture',
  sourceKeyframes: keyframes.length,
  gestures: track.segments.length,
  sampledFrames: positions.length,
  movingFrames,
  maximumSpeed: `${maximumSpeed.toFixed(1)}px/s`,
  accelerationP95: `${accelerationP95.toFixed(1)}px/s²`,
  jerkP95: `${jerkP95.toFixed(1)}px/s³`,
  clickAlignment: 'passed',
  internalStops: 0,
}, null, 2));
