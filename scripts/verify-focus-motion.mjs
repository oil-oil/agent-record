import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  cursorAt,
  pointOf,
  zoomAt,
  zoomSegments,
} from '../studio/src/visuals.ts';

const timelinePath = process.argv[2];
const timeline = timelinePath
  ? JSON.parse(await readFile(timelinePath, 'utf8'))
  : {
      durationMs: 6_000,
      events: [
        { kind: 'page', tMs: 0, nx: .5, ny: .5, viewportWidth: 1440, viewportHeight: 900 },
        { kind: 'move', tMs: 700, nx: .25, ny: .32, viewportWidth: 1440, viewportHeight: 900 },
        { kind: 'click', tMs: 1_000, nx: .25, ny: .32, viewportWidth: 1440, viewportHeight: 900 },
        { kind: 'move', tMs: 1_500, nx: .72, ny: .68, viewportWidth: 1440, viewportHeight: 900 },
        { kind: 'click', tMs: 1_900, nx: .72, ny: .68, viewportWidth: 1440, viewportHeight: 900 },
        { kind: 'move', tMs: 4_000, nx: .44, ny: .56, viewportWidth: 1440, viewportHeight: 900 },
        { kind: 'click', tMs: 4_300, nx: .44, ny: .56, viewportWidth: 1440, viewportHeight: 900 },
      ],
    };
const events = timeline.events;
const scale = 1.2;
const maximumAmount = scale - 1;
const segments = zoomSegments(events, timeline.durationMs / 1000);
const focusEvents = events.filter((event) => ['click', 'input'].includes(event.kind));
const inputs = events.filter((event) => event.kind === 'input').sort((a, b) => a.tMs - b.tMs);
const inputStarts = inputs.filter((input, index) => {
  const previous = inputs[index - 1];
  if (!previous || input.tMs - previous.tMs > 800) return true;
  const from = pointOf(previous);
  const to = pointOf(input);
  return !from || !to || Math.hypot(from.x - to.x, from.y - to.y) > .08;
});
const inputBursts = inputStarts.map((start, index) => {
  const nextStart = inputStarts[index + 1]?.tMs ?? Number.POSITIVE_INFINITY;
  return {
    start,
    end: inputs.filter((input) => input.tMs >= start.tMs && input.tMs < nextStart).at(-1) ?? start,
  };
});
assert(segments.length > 0, '时间轴必须产生聚焦镜头');

const focusedActions = [];
const focusedClicks = [];
const focusedInputs = [];
const inputDrivenClicks = [];
for (const segment of segments) {
  const click = focusEvents.find((event) => (
    event.kind === 'click'
    && Math.abs(event.tMs / 1000 - segment.start) < .000001
  ));
  const standaloneInput = inputStarts.find((event) => (
    Math.abs(event.tMs / 1000 - segment.start - .28) < .000001
  ));
  const anchor = click ?? standaloneInput;
  assert(anchor, `聚焦段 ${segment.start.toFixed(3)} 秒必须从真实点击或输入开始`);
  focusedActions.push(anchor);
  if (anchor.kind === 'click') focusedClicks.push(anchor);
  if (anchor.kind === 'input') focusedInputs.push(anchor);

  const triggerTime = anchor.tMs / 1000;
  const leadSeconds = triggerTime - segment.start;
  const expectedLead = anchor.kind === 'input' ? .28 : 0;
  assert(
    Math.abs(leadSeconds - expectedLead) < .000001,
    `聚焦提前量错误：${leadSeconds.toFixed(3)} 秒`,
  );
  const followingInput = anchor.kind === 'click'
    ? inputStarts.find((input) => input.tMs >= anchor.tMs && input.tMs - anchor.tMs <= 1_500)
    : undefined;
  if (followingInput) inputDrivenClicks.push(anchor);

  const atStart = zoomAt(events, segment.start, scale);
  const beforeStart = zoomAt(events, segment.start - 1 / 60, scale);
  const afterStart = zoomAt(events, segment.start + .12, scale);
  const midpoint = zoomAt(events, segment.start + .24, scale);
  const settled = zoomAt(events, segment.start + .48, scale);
  assert(Math.abs(beforeStart.amount) < .000001, '聚焦开始前必须保持原始倍率');
  assert(Math.abs(atStart.amount) < .000001, '聚焦首帧必须从原始倍率开始');
  assert(afterStart.amount > 0 && afterStart.amount < maximumAmount, '聚焦开始后应平滑进入');
  assert(Math.abs(midpoint.amount - maximumAmount / 2) < .000001, '进镜中点必须保持 ease-in-out 的半倍率');
  assert(Math.abs(settled.amount - maximumAmount) < .000001, '进入动画结束后必须达到目标倍率');
  if (anchor.kind === 'input') {
    assert(zoomAt(events, triggerTime, scale).amount > 0, '独立输入发生前必须已开始进镜');
  }

  const expectedPoint = pointOf(followingInput ?? anchor);
  const cameraPoint = pointOf(atStart.event);
  assert(expectedPoint && cameraPoint);
  assert(
    Math.hypot(cameraPoint.x - expectedPoint.x, cameraPoint.y - expectedPoint.y) < .000001,
    '聚焦首帧镜头目标必须使用最终输入或操作位置',
  );
  if (anchor.kind === 'click') {
    const clickPoint = pointOf(anchor);
    const cursorPoint = pointOf(cursorAt(events, triggerTime));
    assert(clickPoint);
    assert(cursorPoint);
    assert(
      Math.hypot(cursorPoint.x - clickPoint.x, cursorPoint.y - clickPoint.y) < .000001,
      '点击帧鼠标必须与点击位置完全一致',
    );
  }

  for (let time = segment.start; time <= segment.start + .48; time += 1 / 60) {
    const target = pointOf(zoomAt(events, time, scale).event);
    assert(target);
    assert(target.x >= .03 && target.x <= .97 && target.y >= .03 && target.y <= .97);
  }
}

const zoomSpeeds = [];
for (const segment of segments) {
  for (let time = segment.start + 1 / 60; time <= segment.end; time += 1 / 60) {
    const previous = zoomAt(events, time - 1 / 60, scale).amount;
    const current = zoomAt(events, time, scale).amount;
    zoomSpeeds.push(Math.abs(current - previous) * 60);
  }
}
const maximumZoomSpeed = Math.max(...zoomSpeeds);
assert(maximumZoomSpeed < .7, `进镜速度仍然过快：${maximumZoomSpeed.toFixed(3)}/s`);

for (const input of inputs) {
  const inputTime = input.tMs / 1000;
  assert(
    segments.some((segment) => inputTime >= segment.start && inputTime <= segment.end),
    `输入事件 ${inputTime.toFixed(3)} 秒没有被聚焦段覆盖`,
  );
  assert(zoomAt(events, inputTime + .12, scale).amount > 0, '输入开始后应处于聚焦动画或完整聚焦');
}

for (const input of inputStarts) {
  const inputTime = input.tMs / 1000;
  const inputPoint = pointOf(input);
  const settledPoint = pointOf(zoomAt(events, inputTime + .48, scale).event);
  assert(inputPoint && settledPoint);
  assert(
    Math.hypot(settledPoint.x - inputPoint.x, settledPoint.y - inputPoint.y) < .02,
    '输入开始 480ms 后镜头必须落在输入区域',
  );
}

for (const burst of inputBursts) {
  const inputPoint = pointOf(burst.start);
  const releaseTime = burst.end.tMs / 1000 + .32;
  const lockedPoint = pointOf(zoomAt(events, releaseTime - 1 / 60, scale).event);
  assert(inputPoint && lockedPoint);
  assert(
    Math.hypot(lockedPoint.x - inputPoint.x, lockedPoint.y - inputPoint.y) < .02,
    '输入结束后的镜头保持期不能追随鼠标',
  );

  const nextClick = events.find((event) => event.kind === 'click' && event.tMs > burst.end.tMs);
  if (!nextClick) continue;
  const targets = [];
  for (let time = releaseTime; time <= nextClick.tMs / 1000; time += 1 / 60) {
    const target = pointOf(zoomAt(events, time, scale).event);
    if (target) targets.push(target);
  }
  const maximumJump = Math.max(0, ...targets.slice(1).map((point, index) => (
    Math.hypot(point.x - targets[index].x, point.y - targets[index].y)
  )));
  assert(maximumJump < .03, `输入结束后的镜头发生闪跳：${maximumJump.toFixed(4)}`);
}

console.log(JSON.stringify({
  timeline: timelinePath ?? 'inline-production-fixture',
  focusSegments: segments.length,
  focusedActions: focusedActions.length,
  focusedClicks: focusedClicks.length,
  focusedInputs: focusedInputs.length,
  inputDrivenClicks: inputDrivenClicks.length,
  coveredInputs: inputs.length,
  inputBursts: inputStarts.length,
  inputRelease: 'passed',
  preRoll: 'click 0ms / standalone input 280ms',
  enterDuration: '480ms',
  maximumZoomSpeed: `${maximumZoomSpeed.toFixed(3)}/s`,
  clickFrameAlignment: 'passed',
  inputFocus: 'passed',
  cameraFollow: 'passed',
}, null, 2));
