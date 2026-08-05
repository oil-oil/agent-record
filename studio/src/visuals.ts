import { staticFile } from 'remotion';
import type { BackgroundPreset, RecordedEvent, StudioStyle } from './types';
import { buildSmoothCursorTrack, sampleSmoothCursorTrack, type SmoothCursorTrack } from './cursor-motion.ts';

export type Wallpaper = {
  id: Exclude<BackgroundPreset, 'solid'>;
  name: string;
  category: string;
  src: string;
  previewSrc?: string;
  fallback: [string, string];
};

export const wallpapers: Wallpaper[] = [
  { id: 'apple-cream-blue', name: '银白折面', category: 'Luminous', src: '/wallpapers/refined-white-silver-fold.png', previewSrc: '/wallpapers/previews/refined-white-silver-fold.webp', fallback: ['#f8f9ff', '#cbd3e3'] },
  { id: 'apple-warm-silver', name: '暖橙光场', category: 'Luminous', src: '/wallpapers/refined-soft-amber.png', previewSrc: '/wallpapers/previews/refined-soft-amber.webp', fallback: ['#eef4ff', '#ff974e'] },
  { id: 'apple-coral-pink', name: '橙蓝光束', category: 'Luminous', src: '/wallpapers/refined-orange-rays.png', previewSrc: '/wallpapers/previews/refined-orange-rays.webp', fallback: ['#0a5dcb', '#ff936a'] },
  { id: 'apple-prismatic', name: '橙色雕塑', category: 'Abstract', src: '/wallpapers/refined-orange-sculpture.png', previewSrc: '/wallpapers/previews/refined-orange-sculpture.webp', fallback: ['#0c8ebc', '#ff8a24'] },
  { id: 'apple-coastal-blue', name: '薄荷折叠', category: 'Luminous', src: '/wallpapers/refined-aqua-fold.png', previewSrc: '/wallpapers/previews/refined-aqua-fold.webp', fallback: ['#a6d5d8', '#0f6d77'] },
  { id: 'glass-sunrise', name: '蓝色地平线', category: 'Desktop', src: '/wallpapers/refined-blue-horizon.png', previewSrc: '/wallpapers/previews/refined-blue-horizon.webp', fallback: ['#f6eccc', '#226ee1'] },
  { id: 'cosmic-orbit', name: '靛蓝褶皱', category: 'Abstract', src: '/wallpapers/refined-indigo-ridges.png', previewSrc: '/wallpapers/previews/refined-indigo-ridges.webp', fallback: ['#d5e2ff', '#070b32'] },
  { id: 'desktop-coast', name: '紫粉弧光', category: 'Luminous', src: '/wallpapers/refined-violet-arch.png', previewSrc: '/wallpapers/previews/refined-violet-arch.webp', fallback: ['#fff9fb', '#6450dc'] },
  { id: 'abstract-ribbon', name: '彩色缎带', category: 'Abstract', src: '/wallpapers/refined-prismatic-ribbon.png', previewSrc: '/wallpapers/previews/refined-prismatic-ribbon.webp', fallback: ['#0b1f66', '#ff4f35'] },
];
export const wallpaperById = Object.fromEntries(wallpapers.map((wallpaper) => [wallpaper.id, wallpaper])) as Record<Exclude<BackgroundPreset, 'solid'>, Wallpaper>;
export const getBackground = (style: StudioStyle) => {
  if (style.backgroundPreset === 'solid') return style.backgroundColor;
  const wallpaper = wallpaperById[style.backgroundPreset];
  return `url("${staticFile(wallpaper.src.replace(/^\//, ''))}") center / cover no-repeat, linear-gradient(135deg, ${wallpaper.fallback[0]}, ${wallpaper.fallback[1]}) center / cover no-repeat`;
};
export function pointOf(event?: RecordedEvent | null) { if (!event) return null; if (Number.isFinite(event.nx) && Number.isFinite(event.ny)) return { x: Math.max(.02, Math.min(.98, event.nx!)), y: Math.max(.02, Math.min(.98, event.ny!)) }; if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return null; return { x: Math.max(.02, Math.min(.98, event.x! / (event.viewportWidth || 1440))), y: Math.max(.02, Math.min(.98, event.y! / (event.viewportHeight || 900))) }; }
const cursorTrackCache = new WeakMap<RecordedEvent[], RecordedEvent[]>();
const cursorMotionCache = new WeakMap<RecordedEvent[], { events: RecordedEvent[]; track: SmoothCursorTrack }>();
type FocusAnchor = RecordedEvent & {
  focusUntilMs?: number;
  inputDriven?: boolean;
};
const clickAnchorCache = new WeakMap<RecordedEvent[], RecordedEvent[]>();
const focusAnchorCache = new WeakMap<RecordedEvent[], FocusAnchor[]>();
type CameraPoint = { x: number; y: number };
const cameraTrackCache = new WeakMap<RecordedEvent[], CameraPoint[]>();
type FocusCue = { start: number; settle: number; holdEnd: number; end: number; anchors: FocusAnchor[] };
const focusCueCache = new WeakMap<RecordedEvent[], FocusCue[]>();
// 聚焦必须从真实点击时刻开始，不能在点击前偷跑镜头。
const FOCUS_PRE_ROLL_SECONDS = 0;
const FOCUS_ENTER_SECONDS = .48;
const FOCUS_HOLD_SECONDS = .9;
const FOCUS_EXIT_SECONDS = .82;
const FOCUS_RESET_BUFFER_SECONDS = .65;
const MAX_FOCUS_CLICKS = 2;
const INPUT_BURST_GAP_MS = 800;
const INPUT_BURST_DISTANCE = .08;
const INPUT_FOCUS_LEAD_MS = 1_500;
const INPUT_FOCUS_PRE_ROLL_SECONDS = .28;
const INPUT_CAMERA_RELEASE_DELAY_SECONDS = .32;
const CAMERA_SAMPLE_RATE = 120;
const CAMERA_DELAY_SECONDS = .09;
const CAMERA_DEAD_ZONE = .015;
const CAMERA_SPRING_FREQUENCY = 14;
const CAMERA_MAX_SPEED = 1.5;
const CAMERA_MAX_ACCELERATION = 8;
const pointDistance = (from: RecordedEvent, to: RecordedEvent) => {
  const a = pointOf(from);
  const b = pointOf(to);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.hypot(a.x - b.x, a.y - b.y);
};
function cursorTrack(events: RecordedEvent[]) {
  const cached = cursorTrackCache.get(events); if (cached) return cached;
  const candidates = events
    .filter((event) => pointOf(event) && ['page', 'move', 'click'].includes(event.kind))
    .sort((a, b) => a.tMs - b.tMs);
  const nextClicks = new Array<RecordedEvent | null>(candidates.length).fill(null);
  let nextClick: RecordedEvent | null = null;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    nextClicks[index] = nextClick;
    if (candidates[index].kind === 'click') nextClick = candidates[index];
  }
  const track = candidates.filter((event, index) => {
    if (event.kind !== 'move') return true;

    // 自动化通常会在点击前多次上报同一个目标点。保留这些点会把原本可用的
    // 点击间隔切碎，造成光标停住后突然冲刺；由最终 click 统一承担到达锚点。
    const followingClick = nextClicks[index];
    if (followingClick && followingClick.tMs - event.tMs <= 700 && pointDistance(event, followingClick) <= .012) return false;

    // 旧版透明录制控制点位于页面极角，停止录制时不应让光标飞出正文。
    const rawX = Number.isFinite(event.nx) ? event.nx! : event.x! / (event.viewportWidth || 1440);
    const rawY = Number.isFinite(event.ny) ? event.ny! : event.y! / (event.viewportHeight || 900);
    return rawX >= .02 && rawX <= .98 && rawY >= .02 && rawY <= .98;
  });
  cursorTrackCache.set(events, track); return track;
}
function cursorMotion(events: RecordedEvent[]) {
  const cached = cursorMotionCache.get(events); if (cached) return cached;
  const cursorEvents = cursorTrack(events);
  const sourceEvent = cursorEvents.find((event) => Number(event.viewportWidth) > 0 && Number(event.viewportHeight) > 0);
  const track = buildSmoothCursorTrack(
    cursorEvents.map((event) => {
      const point = pointOf(event)!;
      return { time: event.tMs / 1000, x: point.x, y: point.y, kind: event.kind };
    }),
    {
      viewportWidth: sourceEvent?.viewportWidth,
      viewportHeight: sourceEvent?.viewportHeight,
    },
  );
  const motion = { events: cursorEvents, track };
  cursorMotionCache.set(events, motion);
  return motion;
}
function clickAnchors(events: RecordedEvent[]) {
  const cached = clickAnchorCache.get(events); if (cached) return cached;
  const anchors = events.filter((event) => event.kind === 'click' && Number.isFinite(event.tMs)).sort((a, b) => a.tMs - b.tMs);
  clickAnchorCache.set(events, anchors); return anchors;
}
function focusAnchors(events: RecordedEvent[]) {
  const cached = focusAnchorCache.get(events); if (cached) return cached;
  const inputs: FocusAnchor[] = [];
  events
    .filter((event) => event.kind === 'input' && Number.isFinite(event.tMs) && pointOf(event))
    .sort((a, b) => a.tMs - b.tMs)
    .forEach((event) => {
      const current = inputs.at(-1);
      if (
        current
        && event.tMs - (current.focusUntilMs ?? current.tMs) <= INPUT_BURST_GAP_MS
        && pointDistance(current, event) <= INPUT_BURST_DISTANCE
      ) {
        current.focusUntilMs = event.tMs;
        return;
      }
      inputs.push({ ...event, focusUntilMs: event.tMs });
    });
  const clicks: FocusAnchor[] = clickAnchors(events).map((event) => ({ ...event }));
  const standaloneInputs = inputs.filter((input) => {
    const click = [...clicks]
      .reverse()
      .find((candidate) => (
        candidate.tMs <= input.tMs
        && input.tMs - candidate.tMs <= INPUT_FOCUS_LEAD_MS
        && !candidate.inputDriven
      ));
    if (!click) return true;

    // 点击输入框后很快开始输入时，后续输入位置拥有镜头控制权。保留真实
    // 点击时间作为进镜起点，但从第一帧就朝输入区域进入，避免先右后左。
    click.nx = input.nx;
    click.ny = input.ny;
    click.x = input.x;
    click.y = input.y;
    click.viewportWidth = input.viewportWidth;
    click.viewportHeight = input.viewportHeight;
    click.focusUntilMs = input.focusUntilMs;
    click.inputDriven = true;
    return false;
  });
  const anchors: FocusAnchor[] = [...clicks, ...standaloneInputs].sort((a, b) => a.tMs - b.tMs);
  focusAnchorCache.set(events, anchors);
  return anchors;
}
function focusCues(events: RecordedEvent[]) {
  const cached = focusCueCache.get(events); if (cached) return cached;
  const groups: FocusAnchor[][] = [];
  const cueEndAfter = (anchor: FocusAnchor) => (anchor.focusUntilMs ?? anchor.tMs) / 1000
    + FOCUS_HOLD_SECONDS + FOCUS_EXIT_SECONDS;
  focusAnchors(events).forEach((anchor) => {
    const current = groups.at(-1);
    if (!current) {
      groups.push([anchor]);
      return;
    }
    const currentEnd = cueEndAfter(current.at(-1)!);
    const clickTime = anchor.tMs / 1000;

    // 输入和点击共用聚焦段。连续输入已折叠成一次动作；点击仍最多合并两次，
    // 防止密集操作让画面全程处于放大状态。
    if (clickTime <= currentEnd) {
      const clickCount = current.filter((item) => item.kind === 'click').length;
      if (anchor.kind === 'input' || clickCount < MAX_FOCUS_CLICKS) current.push(anchor);
      return;
    }

    // 一个聚焦段结束后保留短暂全屏，缓冲期内的过渡点击不另起镜头。
    if (clickTime < currentEnd + FOCUS_RESET_BUFFER_SECONDS && !anchor.inputDriven) return;
    groups.push([anchor]);
  });

  const cues = groups.map((anchors) => {
    const first = anchors[0].tMs / 1000;
    const last = Math.max(...anchors.map((anchor) => anchor.focusUntilMs ?? anchor.tMs)) / 1000;
    // 点击后使用 ease-in-out 进入目标；点击手型和按压反馈也从真实点击开始。
    const inputPreRoll = anchors[0].kind === 'input' ? INPUT_FOCUS_PRE_ROLL_SECONDS : 0;
    const start = Math.max(0, first - inputPreRoll - FOCUS_PRE_ROLL_SECONDS);
    const settle = start + FOCUS_ENTER_SECONDS;
    const holdEnd = last + FOCUS_HOLD_SECONDS;
    const end = holdEnd + FOCUS_EXIT_SECONDS;
    return { start, settle, holdEnd, end, anchors };
  });
  focusCueCache.set(events, cues);
  return cues;
}
const smootherstep = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * t * (t * (t * 6 - 15) + 10); };
const smoothstep = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
function cursorAtRaw(events: RecordedEvent[], time: number) {
  const motion = cursorMotion(events);
  const cursorEvents = motion.events;
  let lower = 0;
  let upper = cursorEvents.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (cursorEvents[middle].tMs / 1000 <= time) lower = middle + 1;
    else upper = middle;
  }
  const previousIndex = lower - 1;
  if (previousIndex < 0) return null;
  const previous = cursorEvents[previousIndex];
  const point = sampleSmoothCursorTrack(motion.track, time);
  return point ? { ...previous, nx: point.x, ny: point.y } : previous;
}
export function cursorAt(events: RecordedEvent[], time: number) {
  return cursorAtRaw(events, time);
}
export type ClickCursorVisual = {
  handAmount: number;
  pressAmount: number;
};
export function clickCursorAt(events: RecordedEvent[], time: number): ClickCursorVisual {
  const anchors = clickAnchors(events);
  let lower = 0;
  let upper = anchors.length;
  const timeMs = time * 1000;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (anchors[middle].tMs <= timeMs) lower = middle + 1;
    else upper = middle;
  }
  const nearest = lower > 0 ? anchors[lower - 1] : undefined;
  const nearestDelta = nearest ? time - nearest.tMs / 1000 : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(nearestDelta) || nearestDelta < 0 || nearestDelta > .36) {
    return { handAmount: 0, pressAmount: 0 };
  }

  // 所有点击反馈从真实点击时刻才开始，不再提前切换手型或放大光标。
  const handAmount = nearestDelta <= .06
    ? smootherstep(nearestDelta / .06)
    : nearestDelta <= .27
      ? 1
      : 1 - smootherstep((nearestDelta - .27) / .09);
  const pressAmount = nearestDelta <= .075
      ? smootherstep(nearestDelta / .075)
      : nearestDelta <= .24
        ? 1 - smootherstep((nearestDelta - .075) / .165)
        : 0;
  return { handAmount, pressAmount };
}
function limitVector(x: number, y: number, maximum: number) {
  const length = Math.hypot(x, y);
  if (length <= maximum || length === 0) return { x, y };
  const ratio = maximum / length;
  return { x: x * ratio, y: y * ratio };
}
function buildCameraTrack(events: RecordedEvent[]) {
  const cached = cameraTrackCache.get(events);
  if (cached) return cached;

  const first = cursorTrack(events).map(pointOf).find((point): point is CameraPoint => Boolean(point));
  if (!first) {
    cameraTrackCache.set(events, []);
    return [];
  }

  const duration = Math.max(0, ...events.map((event) => event.tMs / 1000)) + 1;
  const step = 1 / CAMERA_SAMPLE_RATE;
  const samples: CameraPoint[] = [];
  let position = { ...first };
  let intent = { ...first };
  let velocity = { x: 0, y: 0 };

  for (let time = 0; time <= duration + step; time += step) {
    const observed = pointOf(cursorAtRaw(events, Math.max(0, time - CAMERA_DELAY_SECONDS))) ?? intent;
    if (Math.hypot(observed.x - intent.x, observed.y - intent.y) >= CAMERA_DEAD_ZONE) {
      intent = observed;
    }

    // 连续聚焦期间不重启一段 easing。镜头保留当前速度，通过临界阻尼弹簧
    // 追随经过轻微延迟和静止区过滤后的鼠标意图，避免细小轨迹带动画面抖动。
    const acceleration = limitVector(
      CAMERA_SPRING_FREQUENCY ** 2 * (intent.x - position.x) - 2 * CAMERA_SPRING_FREQUENCY * velocity.x,
      CAMERA_SPRING_FREQUENCY ** 2 * (intent.y - position.y) - 2 * CAMERA_SPRING_FREQUENCY * velocity.y,
      CAMERA_MAX_ACCELERATION,
    );
    velocity = limitVector(
      velocity.x + acceleration.x * step,
      velocity.y + acceleration.y * step,
      CAMERA_MAX_SPEED,
    );
    position = {
      x: Math.max(.03, Math.min(.97, position.x + velocity.x * step)),
      y: Math.max(.03, Math.min(.97, position.y + velocity.y * step)),
    };
    samples.push(position);
  }

  cameraTrackCache.set(events, samples);
  return samples;
}
export function cameraAt(events: RecordedEvent[], time: number) {
  const samples = buildCameraTrack(events);
  if (!samples.length) return null;
  const sample = Math.max(0, time) * CAMERA_SAMPLE_RATE;
  const fromIndex = Math.min(samples.length - 1, Math.floor(sample));
  const toIndex = Math.min(samples.length - 1, fromIndex + 1);
  const progress = Math.max(0, Math.min(1, sample - fromIndex));
  const from = samples[fromIndex];
  const to = samples[toIndex];
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  };
}
function focusAt(events: RecordedEvent[], cue: FocusCue, time: number) {
  let current = cue.anchors[0];
  for (let index = 1; index < cue.anchors.length; index += 1) {
    const next = cue.anchors[index];
    const nextTime = next.tMs / 1000;
    if (next.kind === 'input') {
      const transitionEnd = nextTime + FOCUS_ENTER_SECONDS;
      if (time <= nextTime) return current;
      if (time < transitionEnd) {
        const from = pointOf(current);
        const to = pointOf(next);
        if (!from || !to) return current;
        const amount = smoothstep((time - nextTime) / FOCUS_ENTER_SECONDS);
        return {
          ...next,
          nx: from.x + (to.x - from.x) * amount,
          ny: from.y + (to.y - from.y) * amount,
        };
      }
      current = next;
      continue;
    }
    if (current.kind === 'input' || current.inputDriven) {
      const from = pointOf(current);
      const to = pointOf(next);
      const transitionStart = Math.min(
        nextTime,
        (current.focusUntilMs ?? current.tMs) / 1000 + INPUT_CAMERA_RELEASE_DELAY_SECONDS,
      );
      if (time < transitionStart) return current;
      if (time < nextTime && from && to) {
        const amount = smoothstep((time - transitionStart) / (nextTime - transitionStart));
        return {
          ...next,
          nx: from.x + (to.x - from.x) * amount,
          ny: from.y + (to.y - from.y) * amount,
        };
      }
      current = next;
      continue;
    }
    const gesture = cursorMotion(events).track.segments.find((segment) => (
      Math.abs(segment.endTime - nextTime) <= .02
    ));
    const transitionStart = Math.max(
      (current.focusUntilMs ?? current.tMs) / 1000,
      gesture?.startTime ?? nextTime - FOCUS_PRE_ROLL_SECONDS,
    );
    const transitionEnd = nextTime;
    if (time <= transitionStart) return current;
    if (time < transitionEnd) {
      const cursor = pointOf(cursorAtRaw(events, time));
      return cursor ? { ...next, nx: cursor.x, ny: cursor.y } : current;
    }
    current = next;
  }
  return current;
}
export function zoomAt(events: RecordedEvent[], time: number, scale: number) {
  const cue = focusCues(events).find((item) => time >= item.start && time <= item.end);
  if (!cue) return { event: null as RecordedEvent | null, amount: 0, cameraTime: time };
  const strength = time < cue.settle
    ? smoothstep((time - cue.start) / (cue.settle - cue.start))
    : time <= cue.holdEnd
      ? 1
      : 1 - smoothstep((time - cue.holdEnd) / (cue.end - cue.holdEnd));
  // 退镜时锁定最后一个完整聚焦帧的焦点，避免鼠标已经去往下一处时带着
  // 整个页面横向甩动；聚焦保持阶段仍然正常跟随鼠标。
  return { event: focusAt(events, cue, time), amount: strength * (scale - 1), cameraTime: Math.min(time, cue.holdEnd) };
}
export function zoomSegments(events: RecordedEvent[], duration: number) {
  return focusCues(events).map((cue) => ({ start: cue.start, end: Math.min(duration, cue.end) })).filter((cue) => cue.start < cue.end);
}
