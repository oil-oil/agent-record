import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_STUDIO_DURATION_SECONDS,
  durationSecondsFromMedia,
  durationSecondsFromTimeline,
  finiteDurationSeconds,
  preferredDurationSeconds,
} from '../studio/src/media-duration.ts';
import { timelineDurationMs } from '../shared/timeline-duration.mjs';

test('时间轴明确时长是 Studio 的权威来源', () => {
  const timelineDuration = durationSecondsFromTimeline({
    durationMs: 115_530,
    events: [{ kind: 'recording-stop', tMs: 6_000 }],
  });
  assert.equal(timelineDuration, 115.53);
  assert.equal(preferredDurationSeconds(timelineDuration, 6), 115.53);
});

test('时间轴缺少 durationMs 时使用最后一个有效事件', () => {
  assert.equal(durationSecondsFromTimeline({
    events: [
      { kind: 'move', tMs: 1_200 },
      { kind: 'recording-stop', tMs: 8_450 },
    ],
  }), 8.45);
});

test('WebM 的 Infinity 时长不会覆盖时间轴或进入播放器', () => {
  assert.equal(finiteDurationSeconds(Infinity), undefined);
  assert.equal(durationSecondsFromMedia({
    duration: Infinity,
  }), undefined);
  assert.equal(preferredDurationSeconds(undefined, Infinity), DEFAULT_STUDIO_DURATION_SECONDS);
});

test('所有入口对无效显式时长采用相同的事件回退', () => {
  const events = [{ kind: 'recording-stop', tMs: 8_450 }];
  for (const durationMs of [undefined, 0, -1, Infinity, 'Infinity', '错误值']) {
    assert.equal(timelineDurationMs({ durationMs, events }), 8_450);
    assert.equal(durationSecondsFromTimeline({ durationMs, events }), 8.45);
  }
});
