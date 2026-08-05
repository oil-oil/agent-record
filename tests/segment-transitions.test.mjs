import assert from 'node:assert/strict';
import test from 'node:test';
import {
  segmentAddressAt,
  segmentTransitionAt,
} from '../studio/src/segment-transitions.ts';

const segments = [
  {
    startMs: 0,
    durationMs: 5450,
    source: { url: 'https://github.com/dashboard' },
  },
  {
    startMs: 5450,
    durationMs: 6011,
    source: { url: 'https://www.wolf-cha.com/zh' },
  },
];

test('单段录制和远离切换点时不添加动画', () => {
  assert.deepEqual(segmentTransitionAt([], 1), {
    active: false,
    progress: 1,
    boundaryTime: null,
    originX: .5,
    originY: .5,
    opacity: 1,
    scale: 1,
    translateX: 0,
    addressOpacity: 1,
    addressTranslateX: 0,
  });
  assert.equal(segmentTransitionAt(segments, 3).active, false);
  assert.equal(segmentTransitionAt(segments, 6).active, false);
});

test('新页面从最近的点击位置展开，旧页面不闪白', () => {
  const events = [{ kind: 'click', tMs: 5200, nx: .8, ny: .2 }];
  const before = segmentTransitionAt(segments, 5.449, events);
  const boundary = segmentTransitionAt(segments, 5.45, events);
  const after = segmentTransitionAt(segments, 5.55, events);

  assert.equal(before.active, false);
  assert.deepEqual(boundary, {
    active: true,
    progress: 0,
    boundaryTime: 5.45,
    originX: .8,
    originY: .2,
    opacity: 1,
    scale: 1,
    translateX: 0,
    addressOpacity: 0,
    addressTranslateX: 8,
  });
  assert.equal(after.active, true);
  assert.ok(after.progress > boundary.progress);
  assert.equal(after.opacity, 1);
  assert.equal(after.originX, .8);
  assert.equal(after.originY, .2);
  assert.equal(segmentTransitionAt(segments, 5.8, events).active, false);
});

test('找不到近期点击时从画面中央展开', () => {
  const staleClick = [{ kind: 'click', tMs: 1000, nx: .8, ny: .2 }];
  const transition = segmentTransitionAt(segments, 5.45, staleClick);
  assert.equal(transition.originX, .5);
  assert.equal(transition.originY, .5);
});

test('地址栏在新片段开始时切换，首段保留用户填写的网址', () => {
  const fallback = 'https://github.com/oil-oil/wolfcha';
  assert.equal(segmentAddressAt(segments, 5.449, fallback), fallback);
  assert.equal(segmentAddressAt(segments, 5.45, fallback), 'https://www.wolf-cha.com/zh');
});

test('地址栏跟随同一片段内的真实页面导航', () => {
  const events = [
    { kind: 'page', tMs: 0, url: 'https://github.com/dashboard' },
    { kind: 'page', tMs: 3200, url: 'https://github.com/oil-oil/wolfcha' },
    { kind: 'page', tMs: 7000, url: 'https://www.wolf-cha.com/zh/room' },
  ];
  assert.equal(segmentAddressAt(segments, 2, 'https://example.com', events), 'https://github.com/dashboard');
  assert.equal(segmentAddressAt(segments, 4, 'https://example.com', events), 'https://github.com/oil-oil/wolfcha');
  assert.equal(segmentAddressAt(segments, 8, 'https://example.com', events), 'https://www.wolf-cha.com/zh/room');
});
