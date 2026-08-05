import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addIdleGestureBridges,
  adjustedSegmentDurationMs,
  leadingBlackTrimMs,
  remapSegmentEvents,
  transitionEndMs,
} from '../scripts/lib/recording-transitions.mjs';

test('中间片段只保留点击后的短过渡，不携带录制停止前的静止尾帧', () => {
  const timeline = {
    durationMs: 7448,
    events: [
      { kind: 'click', tMs: 3085 },
      { kind: 'click', tMs: 4898 },
      { kind: 'recording-stop', tMs: 7448 },
    ],
  };

  assert.equal(transitionEndMs(timeline), 5448);
  assert.equal(transitionEndMs(timeline, { isLast: true }), 7448);
  assert.equal(
    transitionEndMs(timeline, { enabled: false }),
    7448,
  );
});

test('新片段开头的短黑帧按 60fps 多裁一帧，长黑场不误删', () => {
  const shortBlack = [
    'black_start:0 black_end:0.133333 black_duration:0.133333',
  ].join('\n');
  const longBlack = [
    'black_start:0 black_end:1.2 black_duration:1.2',
  ].join('\n');

  assert.equal(leadingBlackTrimMs(shortBlack), 150);
  assert.equal(leadingBlackTrimMs(longBlack), 0);
  assert.equal(leadingBlackTrimMs(shortBlack, { enabled: false }), 0);
});

test('裁剪后的时间轴保留页面锚点并重映射操作时间', () => {
  const timeline = {
    durationMs: 6161,
    events: [
      { kind: 'recording-start', tMs: 0 },
      { kind: 'page', tMs: 10, nx: .66, ny: .53 },
      { kind: 'move', tMs: 100, nx: .64, ny: .5 },
      { kind: 'move', tMs: 1000, nx: .6, ny: .4 },
      { kind: 'click', tMs: 1509, nx: .51, ny: .5 },
      { kind: 'recording-stop', tMs: 6161 },
    ],
  };

  const events = remapSegmentEvents(timeline, {
    trimStartMs: 150,
    trimEndMs: 6161,
    offsetMs: 5450,
    isLast: true,
  });

  assert.deepEqual(
    events.map(({ kind, tMs }) => ({ kind, tMs })),
    [
      { kind: 'page', tMs: 5450 },
      { kind: 'move', tMs: 6300 },
      { kind: 'click', tMs: 6809 },
      { kind: 'recording-stop', tMs: 11461 },
    ],
  );
  assert.equal(adjustedSegmentDurationMs(timeline, 150, 6161), 6011);
});

test('片段内部导航保留真实时间，不被挤到片段开头', () => {
  const timeline = {
    durationMs: 8_000,
    events: [
      { kind: 'page', tMs: 5, url: 'https://example.com/start' },
      { kind: 'click', tMs: 2_000, nx: .5, ny: .5 },
      { kind: 'page', tMs: 3_200, url: 'https://example.com/result' },
      { kind: 'click', tMs: 5_000, nx: .7, ny: .5 },
    ],
  };

  const events = remapSegmentEvents(timeline, {
    trimStartMs: 0,
    trimEndMs: 6_000,
    offsetMs: 1_000,
  });

  assert.deepEqual(
    events.filter((event) => event.kind === 'page').map(({ tMs, url }) => ({ tMs, url })),
    [
      { tMs: 1_005, url: 'https://example.com/start' },
      { tMs: 4_200, url: 'https://example.com/result' },
    ],
  );
});

test('长等待后的下一次手势自动获得平滑起步桥接点', () => {
  const events = [
    { kind: 'page', tMs: 0, nx: .5, ny: .5 },
    { kind: 'move', tMs: 300, nx: .45, ny: .48 },
    { kind: 'click', tMs: 500, nx: .4, ny: .45 },
    { kind: 'move', tMs: 2100, nx: .42, ny: .5 },
    { kind: 'click', tMs: 2500, nx: .5, ny: .65 },
  ];

  const bridged = addIdleGestureBridges(events);
  const synthetic = bridged.filter(
    (event) => event.synthetic === 'idle-gesture-bridge',
  );
  assert.equal(synthetic.length, 1);
  assert.deepEqual(
    { tMs: synthetic[0].tMs, nx: synthetic[0].nx, ny: synthetic[0].ny },
    { tMs: 1300, nx: .4, ny: .45 },
  );
});
