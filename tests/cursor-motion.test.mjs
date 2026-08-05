import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSmoothCursorTrack,
  sampleSmoothCursorTrack,
} from '../studio/src/cursor-motion.ts';

test('页面导航不把光标瞬间传送到新页面中心', () => {
  const track = buildSmoothCursorTrack([
    { kind: 'page', time: 0, x: .5, y: .5 },
    { kind: 'move', time: .6, x: .4, y: .4 },
    { kind: 'click', time: 1, x: .3, y: .3 },
    { kind: 'page', time: 2, x: .5, y: .5 },
    { kind: 'move', time: 2.5, x: .55, y: .45 },
    { kind: 'click', time: 3, x: .7, y: .5 },
  ], {
    viewportWidth: 1440,
    viewportHeight: 900,
  });

  const afterNavigation = sampleSmoothCursorTrack(track, 2);
  assert(afterNavigation);
  assert(Math.abs(afterNavigation.x - .3) < .000001);
  assert(Math.abs(afterNavigation.y - .3) < .000001);
  assert.equal(track.segments.length, 2);
});

test('靠近页面边缘的真实点击仍准确落点', () => {
  const track = buildSmoothCursorTrack([
    { kind: 'page', time: 0, x: .5, y: .5 },
    { kind: 'move', time: .8, x: .973, y: .031 },
    { kind: 'click', time: 1.2, x: .974, y: .031 },
  ], {
    viewportWidth: 1440,
    viewportHeight: 900,
  });

  const click = sampleSmoothCursorTrack(track, 1.2);
  assert(click);
  assert(Math.abs(click.x - .974) < .000001);
  assert(Math.abs(click.y - .031) < .000001);
});
