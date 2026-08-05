import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clickCursorAt,
  pointOf,
  zoomAt,
  zoomSegments,
} from '../studio/src/visuals.ts';

const viewport = { viewportWidth: 1440, viewportHeight: 900 };

test('连续输入折叠为一个聚焦段，并保持到最后一次输入之后', () => {
  const events = [
    { kind: 'page', tMs: 0, nx: .5, ny: .5, ...viewport },
    { kind: 'input', tMs: 1_000, nx: .3, ny: .4, ...viewport },
    { kind: 'input', tMs: 1_220, nx: .3, ny: .4, ...viewport },
    { kind: 'input', tMs: 1_440, nx: .3, ny: .4, ...viewport },
  ];
  const segments = zoomSegments(events, 4);

  assert.equal(segments.length, 1);
  assert.equal(segments[0].start, .72);
  assert(Math.abs(segments[0].end - 3.16) < .000001);
  assert.equal(zoomAt(events, .719, 1.2).amount, 0);
  assert(zoomAt(events, .9, 1.2).amount > 0);
  assert(zoomAt(events, 1, 1.2).amount > 0);
  assert(Math.abs(zoomAt(events, 2.34, 1.2).amount - .2) < .000001);
});

test('点击后很快输入时以后续输入位置为准，并锁定到输入结束', () => {
  const events = [
    { kind: 'page', tMs: 0, nx: .5, ny: .5, ...viewport },
    { kind: 'click', tMs: 1_000, nx: .72, ny: .2, ...viewport },
    { kind: 'input', tMs: 1_600, nx: .35, ny: .42, ...viewport },
    { kind: 'input', tMs: 1_820, nx: .35, ny: .42, ...viewport },
    { kind: 'move', tMs: 2_000, nx: .8, ny: .7, ...viewport },
    { kind: 'click', tMs: 2_800, nx: .8, ny: .7, ...viewport },
  ];
  const segments = zoomSegments(events, 4);
  const atClick = pointOf(zoomAt(events, 1, 1.2).event);
  const atInput = pointOf(zoomAt(events, 1.6, 1.2).event);
  const duringInput = pointOf(zoomAt(events, 1.8, 1.2).event);
  const afterInput = pointOf(zoomAt(events, 2.1, 1.2).event);
  const releasing = pointOf(zoomAt(events, 2.3, 1.2).event);
  const atNextClick = pointOf(zoomAt(events, 2.8, 1.2).event);

  assert.equal(segments.length, 1);
  assert.deepEqual(atClick, { x: .35, y: .42 });
  assert.deepEqual(atInput, { x: .35, y: .42 });
  assert.deepEqual(duringInput, { x: .35, y: .42 });
  assert.deepEqual(afterInput, { x: .35, y: .42 });
  assert(releasing && releasing.x > .35 && releasing.x < .8);
  assert.deepEqual(atNextClick, { x: .8, y: .7 });
  assert.deepEqual(clickCursorAt(events, 1.65), { handAmount: 0, pressAmount: 0 });

  const targets = [];
  for (let time = 1.8; time <= 2.8; time += 1 / 60) {
    const point = pointOf(zoomAt(events, time, 1.2).event);
    if (point) targets.push(point);
  }
  const maximumJump = Math.max(...targets.slice(1).map((point, index) => (
    Math.hypot(point.x - targets[index].x, point.y - targets[index].y)
  )));
  assert(maximumJump < .03, `输入结束后的镜头发生闪跳：${maximumJump}`);
});
